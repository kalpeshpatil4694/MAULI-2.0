// MAULI 2.0 — RUNTIME EVIDENCE STORE.
//
// The persisted side of production runtime acceptance. The engine (src/production-runtime.js)
// is pure; this module is the small adapter that records its structured verdict on the
// project and reads it back, so the pipeline gate, the delivery and the dashboard all judge
// the SAME evidence instead of each re-deriving one.
//
// Two fields are written together and mean different things:
//   * `runtimeAcceptance` — the structured run (spec item 15): status, environment,
//     deployment, testedAt, health/api/database/authentication/userJourney, per-requirement
//     runtime evidence, failures and the evidence rows. No secrets are ever recorded.
//   * `runtimeEvidence`  — the legacy projection keyed by the RUNTIME_EVIDENCE_KEYS
//     vocabulary, so every reader that existed before the acceptance run did keeps working.
// A third field, `runtimeAcceptanceReport`, is the ENGINE'S verdict over that run (the
// blocking code/reason, the critical pass/fail lists). The dashboard reads it so a founder
// sees "BLOCKED — no runtime acceptance run exists …" instead of a bare "QA Passed".

import { store } from './store.js';
import { listProjectArtifacts } from './artifacts.js';
import { analyzeGeneratedApp } from './generated-app-quality.js';
import {
  evaluateRuntimeAcceptance, isRuntimeAcceptanceReport, toRuntimeEvidenceProjection,
  describeRuntimeAcceptance, hasBackendEntryPoint, runtimeExecutorConfigured,
  dispatchRuntimeAcceptance
} from './production-runtime.js';

/** The project's stored acceptance run, when it is shaped like one. */
export function currentRuntimeAcceptance(project) {
  const raw = project?.runtimeAcceptance ?? null;
  return isRuntimeAcceptanceReport(raw) ? raw : null;
}

/**
 * The union of every code-workspace artifact for a project — the same bytes the pipeline
 * gate, the fidelity gate and the delivery judge, so the recorded verdict cannot be about a
 * different set of files than the one that was delivered.
 */
export function mergedProjectFiles(projectId) {
  if (!projectId) return [];
  const seen = new Set();
  const merged = [];
  for (const a of listProjectArtifacts(projectId).filter((x) => x?.type === 'code-workspace')) {
    for (const f of (a.content?.files ?? [])) {
      if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || seen.has(f.path)) continue;
      seen.add(f.path);
      merged.push({ path: f.path, content: f.content });
    }
  }
  return merged;
}

// Point 15: sensitive secrets are never persisted. The acceptance run is produced by an
// executor the founder may run anywhere, so the store redacts secret-shaped keys itself
// rather than trusting its caller. Test credentials invented for the generated app's own
// journey are not secrets and survive untouched — only keys that NAME a credential do not.
const SECRET_KEY_RE = /(authorization|cookie|set-cookie|api[-_]?key|apikey|secret|password|passwd|token|bearer|private[-_]?key|access[-_]?key|credential)/i;
function scrubSecrets(value, depth = 0) {
  if (value === null || value === undefined || depth > 8) return value;
  if (Array.isArray(value)) return value.map((entry) => scrubSecrets(entry, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? '[redacted]' : scrubSecrets(entry, depth + 1);
  }
  return out;
}

function credentialsFor(project) {
  return Object.fromEntries(
    (project?.requirementSpec?.externalServices ?? []).map((s) => [s.envVar, Boolean(project?.runtimeCredentials?.[s.envVar])])
  );
}

/**
 * Judge a project's stored acceptance run against its own files, specification and
 * architecture. Pure — reads nothing but what it is given, so a read route may call it.
 */
export function judgeRuntimeAcceptance(project, files = null) {
  if (!project) return null;
  const merged = Array.isArray(files) ? files : mergedProjectFiles(project.id);
  const fidelity = merged.length
    ? analyzeGeneratedApp(merged, { objective: project.objective ?? '', requirements: project.requirements ?? [] })
    : null;
  return evaluateRuntimeAcceptance({
    files: merged,
    architecture: project.architecture ?? null,
    spec: project.requirementSpec ?? null,
    requirements: project.requirementSpec?.requirements ?? [],
    acceptance: currentRuntimeAcceptance(project),
    fidelity,
    credentials: credentialsFor(project),
    hasBackend: hasBackendEntryPoint(merged)
  });
}

/**
 * Persist a completed acceptance run onto its project.
 * Throws on a report that is not shaped like an acceptance run — a partial or hand-written
 * object must never become the evidence a delivery is approved on.
 */
export function recordRuntimeAcceptance(projectId, acceptance, extra = {}) {
  const project = store.get('projects', projectId);
  if (!project) throw new Error(`Cannot record runtime acceptance: project ${projectId} does not exist`);
  if (!isRuntimeAcceptanceReport(acceptance)) throw new Error('Cannot record runtime acceptance: the report is not a valid acceptance run');
  const safe = scrubSecrets(acceptance);
  const files = mergedProjectFiles(projectId);
  return store.put('projects', {
    ...project,
    runtimeAcceptance: safe,
    runtimeEvidence: toRuntimeEvidenceProjection(safe),
    runtimeAcceptanceReport: judgeRuntimeAcceptance({ ...project, runtimeAcceptance: safe }, files),
    runtimeAcceptedAt: safe.testedAt ?? new Date().toISOString(),
    ...extra,
    id: projectId
  });
}

/**
 * The founder-facing projection of a project's runtime acceptance (point 16).
 * Returns the same shape for every project, including one that has never been run, so the
 * dashboard always has something honest to print: BLOCKED + the exact reason.
 */
export function runtimeAcceptanceSummary(projectOrId) {
  const project = typeof projectOrId === 'string' ? store.get('projects', projectOrId) : projectOrId;
  if (!project) return describeRuntimeAcceptance(null);
  const stored = project.runtimeAcceptanceReport && isRuntimeAcceptanceReport(project.runtimeAcceptance)
    ? project.runtimeAcceptanceReport
    : null;
  return describeRuntimeAcceptance(stored ?? judgeRuntimeAcceptance(project));
}

/**
 * Produce the evidence when a runner exists. The Worker deliberately does not execute
 * generated code (free-tier CPU budget + sandbox boundary), so MAULI_RUNTIME_EXECUTOR names
 * the Node/HTTP runner that does. With no runner configured this is an honest no-op: the
 * gate then reports BLOCKED with "no runtime acceptance run exists", never a fabricated PASS.
 */
export async function ensureRuntimeAcceptance(projectId, env = null) {
  const project = store.get('projects', projectId);
  if (!project) return { dispatched: false, recorded: false, reason: 'project not found' };
  if (currentRuntimeAcceptance(project)) return { dispatched: false, recorded: false, reason: 'acceptance already recorded' };
  if (!runtimeExecutorConfigured(env)) {
    return { dispatched: false, recorded: false, reason: 'no runtime executor configured (MAULI_RUNTIME_EXECUTOR)' };
  }
  const files = mergedProjectFiles(projectId);
  const out = await dispatchRuntimeAcceptance(env, {
    project,
    files,
    spec: project.requirementSpec ?? null,
    architecture: project.architecture ?? null,
    requirements: project.requirementSpec?.requirements ?? []
  });
  if (!out.acceptance) return { dispatched: out.dispatched, recorded: false, reason: out.reason ?? 'the runner returned no valid acceptance report' };
  recordRuntimeAcceptance(projectId, out.acceptance);
  return { dispatched: true, recorded: true, reason: null };
}

/**
 * Judge a project's runtime acceptance from the stored evidence.
 * `credentials` is a map of env-var NAME → boolean availability; a value is never read or
 * recorded, only whether the binding is present.
 */
export function runtimeAcceptanceFor({ project = null, files = [], hasBackend = false, fidelity = null, credentials = {} } = {}) {
  const acceptance = currentRuntimeAcceptance(project);
  const report = evaluateRuntimeAcceptance({
    files,
    architecture: project?.architecture ?? null,
    spec: project?.requirementSpec ?? null,
    requirements: project?.requirementSpec?.requirements ?? [],
    acceptance,
    fidelity,
    hasBackend,
    credentials
  });
  return { acceptance, report };
}

export default runtimeAcceptanceFor;
