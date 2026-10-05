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
  describeRuntimeAcceptance, describeStoredRuntimeAcceptance, hasBackendEntryPoint,
  runtimeExecutorConfigured, dispatchRuntimeAcceptance, RUNTIME_BLOCKING
} from './production-runtime.js';
import {
  DEPLOYMENT_STATUS, normalizeDeployment, assertRuntimeIdentity, deployExecutorConfigured,
  dispatchGeneratedDeployment, runtimeDeploymentKind
} from './generated-deployment.js';

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
 *
 * `options.env` is read for exactly two booleans — whether a runtime executor and a deploy
 * executor are configured — plus the control-plane URLs used by the identity check. No
 * value is ever recorded.
 */
export function judgeRuntimeAcceptance(project, files = null, { env = null, controlPlaneUrls = [] } = {}) {
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
    hasBackend: hasBackendEntryPoint(merged),
    deployment: project.runtimeDeployment ?? null,
    projectId: project.id ?? null,
    platform: project.platform ?? null,
    executorConfigured: runtimeExecutorConfigured(env),
    // The artifact the project has NOW. A run produced against an older artifact is stale
    // evidence after a repair, and the identity check refuses to honour it.
    currentArtifactId: latestCodeArtifactId(project.id),
    controlPlaneUrls: controlPlaneUrls.length ? controlPlaneUrls : [env?.MAULI_BASE].filter(Boolean)
  });
}

/**
 * Persist a completed acceptance run onto its project.
 * Throws on a report that is not shaped like an acceptance run — a partial or hand-written
 * object must never become the evidence a delivery is approved on.
 */
export function recordRuntimeAcceptance(projectId, acceptance, extra = {}, { env = null, controlPlaneUrls = [] } = {}) {
  const project = store.get('projects', projectId);
  if (!project) throw new Error(`Cannot record runtime acceptance: project ${projectId} does not exist`);
  if (!isRuntimeAcceptanceReport(acceptance)) throw new Error('Cannot record runtime acceptance: the report is not a valid acceptance run');
  // Identity, enforced at the WRITE, not only at judgement. A run produced for another
  // project is refused here so it can never become evidence for this one.
  if (acceptance.projectId && acceptance.projectId !== projectId) {
    throw new Error(`Cannot record runtime acceptance: this run was produced for project ${acceptance.projectId}, not ${projectId}`);
  }
  const safe = scrubSecrets(acceptance);
  const files = mergedProjectFiles(projectId);
  const deployment = deploymentFromRun(project, safe);
  return store.put('projects', {
    ...project,
    runtimeAcceptance: safe,
    runtimeDeployment: deployment,
    runtimeEvidence: toRuntimeEvidenceProjection(safe),
    runtimeAcceptanceReport: judgeRuntimeAcceptance({ ...project, runtimeAcceptance: safe, runtimeDeployment: deployment }, files, { env, controlPlaneUrls }),
    runtimeAcceptedAt: safe.testedAt ?? new Date().toISOString(),
    ...extra,
    id: projectId
  });
}

/**
 * Fold the deployment the run actually used into the project's deployment record.
 *
 * The run is the authority here: an executor that reports `deployed-http` against
 * https://x.workers.dev has just told us this project lives there. A DEPLOYED record with
 * no url (the executor ran the source in-process instead) is DOWNGRADED to NOT_DEPLOYED,
 * because "it ran somewhere" is not "it is deployed" — and point 4 exists precisely to stop
 * source-level execution being read as production acceptance.
 */
export function deploymentFromRun(project, acceptance) {
  const existing = normalizeDeployment(project?.runtimeDeployment);
  const kind = runtimeDeploymentKind({ architecture: project?.architecture ?? null, platform: project?.platform ?? null });
  if (kind !== 'backend') return existing;
  const runUrl = typeof acceptance?.deployment === 'string'
    ? acceptance.deployment
    : (acceptance?.deployment?.url ?? null);
  const realHttp = acceptance?.transport === 'deployed-http' && Boolean(runUrl && /^https?:\/\//i.test(runUrl));
  if (!realHttp) return existing;
  // A run may only CONFIRM this project's deployment, never redefine it. When the project
  // already has a deployment recorded and the run points somewhere else, the record stands
  // and the identity check refuses the run at judgement time.
  if (existing.url && existing.url !== runUrl) return existing;
  const identity = assertRuntimeIdentity({
    projectId: project?.id ?? null,
    deployment: normalizeDeployment({ ...existing, status: DEPLOYMENT_STATUS.DEPLOYED, url: runUrl, projectId: project?.id ?? null }),
    required: false
  });
  if (!identity.ok) return existing;
  return normalizeDeployment({
    ...existing,
    status: DEPLOYMENT_STATUS.DEPLOYED,
    url: runUrl,
    deploymentId: acceptance?.deployment?.deploymentId ?? existing.deploymentId ?? null,
    deployedAt: acceptance?.deployment?.deployedAt ?? acceptance?.testedAt ?? new Date().toISOString(),
    commit: acceptance?.deployment?.commit ?? existing.commit ?? null,
    environment: acceptance?.deployment?.environment ?? existing.environment ?? null,
    projectId: project?.id ?? null,
    artifactId: acceptance?.artifactId ?? existing.artifactId ?? null
  });
}

/**
 * Persist a deployment record produced by the deploy runner (or by a founder/CI reporting a
 * real `wrangler deploy`). Only ever a record of something that happened; the shape is
 * normalised and every error message is redacted before it is written.
 */
export function recordGeneratedDeployment(projectId, deployment) {
  const project = store.get('projects', projectId);
  if (!project) throw new Error(`Cannot record a deployment: project ${projectId} does not exist`);
  const record = normalizeDeployment({
    ...(deployment ?? {}),
    projectId: (deployment?.projectId ?? projectId)
  });
  return store.put('projects', { ...project, runtimeDeployment: record, runtimeDeployedAt: record.deployedAt ?? record.attemptedAt ?? new Date().toISOString(), id: projectId });
}

/**
 * Deploy the generated project through the configured deploy runner.
 * No runner → a NOT_DEPLOYED record naming the dependency. Never a silent success.
 */
export async function ensureGeneratedDeployment(projectId, env = null) {
  const project = store.get('projects', projectId);
  if (!project) return { deployed: false, reason: 'project not found' };
  const kind = runtimeDeploymentKind({ architecture: project.architecture ?? null, platform: project.platform ?? null });
  if (kind !== 'backend') return { deployed: false, skipped: true, reason: `${kind} architecture owes no Worker deployment` };
  const existing = normalizeDeployment(project.runtimeDeployment);
  if (existing.status === DEPLOYMENT_STATUS.DEPLOYED && existing.url) {
    return { deployed: true, deployment: existing, reason: 'already deployed' };
  }
  const out = await dispatchGeneratedDeployment(env, {
    project,
    files: mergedProjectFiles(projectId),
    architecture: project.architecture ?? null,
    artifactId: latestCodeArtifactId(projectId)
  });
  recordGeneratedDeployment(projectId, out.deployment);
  return { deployed: out.deployed, deployment: out.deployment, reason: out.reason };
}

/** The artifact whose bytes were deployed — the identity link between code and URL. */
export function latestCodeArtifactId(projectId) {
  const list = listProjectArtifacts(projectId)
    .filter((a) => a?.type === 'code-workspace' && Array.isArray(a.content?.files) && a.content.files.length)
    // Two artifacts written in the same millisecond must still order deterministically,
    // otherwise "the newest artifact" flips and a repair's evidence could look current.
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || String(b.id ?? '').localeCompare(String(a.id ?? '')));
  return list[0]?.id ?? null;
}

/**
 * The founder-facing projection of a project's runtime acceptance (point 16).
 * Returns the same shape for every project, including one that has never been run, so the
 * dashboard always has something honest to print: BLOCKED + the exact reason.
 */
export function runtimeAcceptanceSummary(projectOrId, { env = null } = {}) {
  const project = typeof projectOrId === 'string' ? store.get('projects', projectOrId) : projectOrId;
  if (!project) return describeRuntimeAcceptance(null);
  const stored = project.runtimeAcceptanceReport && isRuntimeAcceptanceReport(project.runtimeAcceptance)
    ? project.runtimeAcceptanceReport
    : null;
  // Re-judged on read, not served from the cached verdict. A cached PASS would go on
  // reporting PASS after a repair regenerated the code or moved the deployment — which is
  // exactly the stale-evidence bug point 18 forbids. The stored report stays as a fallback.
  let report = null;
  try { report = judgeRuntimeAcceptance(project, null, { env }); } catch (_) { report = null; }
  // A browser-only (local-runnable) project owes no server and therefore no acceptance RUN.
  // Its verdict is the LOCAL one the production-runtime gate already derives from the
  // delivered source, and /api/state's list projection already printed it. Judging it here
  // produced BLOCKED for the SAME project the list called LOCAL, so the live command card
  // read "Production Runtime: BLOCKED" for an app that needs no server at all. Only the
  // no-run-yet case is redirected; a static no-false-PASS failure still shows as FAILED.
  if (
    !currentRuntimeAcceptance(project) &&
    runtimeDeploymentKind({ architecture: project.architecture ?? null, platform: project.platform ?? null }) === 'browser' &&
    (!report || report.blockingCode === RUNTIME_BLOCKING.EVIDENCE_MISSING)
  ) {
    return describeStoredRuntimeAcceptance(project);
  }
  return describeRuntimeAcceptance(report ?? stored);
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
    // Point 13: for a project that owes a deployed backend this is a BLOCKED dependency,
    // reported as such so it can never read as a silent skip.
    const kind = runtimeDeploymentKind({ architecture: project.architecture ?? null, platform: project.platform ?? null });
    return {
      dispatched: false, recorded: false, blocked: kind !== 'browser',
      reason: 'no runtime executor configured (MAULI_RUNTIME_EXECUTOR) — production runtime acceptance is BLOCKED for this project, not skipped'
    };
  }
  // Deploy first when the project owes a deployment: the acceptance run must be told WHICH
  // URL to hit, and running the source in-process is a local fixture, not production proof.
  const deployment = normalizeDeployment(project.runtimeDeployment);
  let target = deployment;
  if (deployment.status !== DEPLOYMENT_STATUS.DEPLOYED) {
    const deployed = await ensureGeneratedDeployment(projectId, env);
    target = normalizeDeployment(deployed?.deployment ?? deployment);
  }
  const files = mergedProjectFiles(projectId);
  const out = await dispatchRuntimeAcceptance(env, {
    project: { ...project, runtimeDeployment: target },
    files,
    spec: project.requirementSpec ?? null,
    architecture: project.architecture ?? null,
    requirements: project.requirementSpec?.requirements ?? []
  });
  if (!out.acceptance) return { dispatched: out.dispatched, recorded: false, reason: out.reason ?? 'the runner returned no valid acceptance report', deployment: target };
  recordRuntimeAcceptance(projectId, out.acceptance);
  return { dispatched: true, recorded: true, reason: null, deployment: target };
}

/**
 * Every project that has generated code and no CURRENT passing production runtime evidence.
 *
 * This is what makes acceptance AUTOMATIC: there is no configured project id, no fixture and
 * no manual list. Whatever founder command created the project, it appears here the moment
 * its code exists, and the runtime sweep has to account for it.
 *
 * "Current" is the part that used to be wrong. Reading the cached `runtimeAcceptanceReport`
 * meant a project whose code was REGENERATED after a repair kept reporting passed forever,
 * because the cached verdict was written before the repair and never re-checked. The sweep
 * skipped exactly the projects that most needed re-acceptance. Now a project only counts as
 * done when its stored run is judged against the artifact and the deployment it exists
 * today — a newer artifact, a moved URL or a missing record all put it back in the queue.
 */
export function projectsNeedingRuntimeAcceptance({ limit = 25, env = null } = {}) {
  return store.list('projects')
    .filter((p) => p && p.id && mergedProjectFiles(p.id).length > 0)
    .filter((p) => {
      const acceptance = currentRuntimeAcceptance(p);
      if (!acceptance) return true;
      const cached = p.runtimeAcceptanceReport;
      if (!cached || cached.status !== 'passed') return true;
      // Stale after a repair: the run describes bytes that no longer exist.
      const current = latestCodeArtifactId(p.id);
      if (acceptance.artifactId && current && acceptance.artifactId !== current) return true;
      // Stale after a redeploy elsewhere: the recorded run tested a URL this project no
      // longer answers on.
      const dep = normalizeDeployment(p.runtimeDeployment);
      const runUrl = typeof acceptance.deployment === 'string' ? acceptance.deployment : acceptance.deployment?.url ?? null;
      if (dep.url && runUrl && dep.url !== runUrl) return true;
      if (dep.status !== DEPLOYMENT_STATUS.DEPLOYED) {
        // A browser-only app owes no deployment; a backend that lost its record does.
        if (runtimeDeploymentKind({ architecture: p.architecture ?? null, platform: p.platform ?? null }) !== 'browser') return true;
      }
      return false;
    })
    .slice(0, limit)
    .map((p) => ({ id: p.id, name: p.name ?? null, objective: p.objective ?? null, platform: p.platform ?? null }));
}

/**
 * Run the deployment + acceptance sweep over every project that owes it.
 * The caller (the pipeline gate, a cron trigger, or CI) gets one row per project, and no
 * project can be skipped quietly: `blocked` names the dependency, it is never a pass.
 */
export async function sweepRuntimeAcceptance(env = null, { limit = 25 } = {}) {
  const projects = projectsNeedingRuntimeAcceptance({ limit });
  const results = [];
  for (const project of projects) {
    const outcome = await ensureRuntimeAcceptance(project.id, env);
    const summary = runtimeAcceptanceSummary(project.id, { env });
    results.push({
      projectId: project.id,
      recorded: outcome.recorded === true,
      blocked: outcome.blocked === true || outcome.recorded !== true,
      reason: outcome.reason ?? null,
      // Named, so CI can print BLOCKED — DEPENDENCY_REQUIRED instead of a green tick.
      blockingCode: summary.blockingCode ?? null,
      verdict: summary.label,
      runtimeUrl: summary.runtimeUrl ?? null,
      deploymentStatus: summary.deploymentStatus ?? DEPLOYMENT_STATUS.NOT_DEPLOYED,
      finalDelivery: summary.finalDelivery ?? 'BLOCKED'
    });
  }
  return {
    projects: results,
    swept: results.length,
    executorConfigured: runtimeExecutorConfigured(env),
    deployExecutorConfigured: deployExecutorConfigured(env),
    // Point 16: an unconfigured runner is a named dependency, never a silent skip.
    blockingDependency: !deployExecutorConfigured(env)
      ? 'MAULI_DEPLOY_EXECUTOR is not configured — generated projects cannot be deployed, so their Final Delivery stays BLOCKED'
      : !runtimeExecutorConfigured(env)
        ? 'MAULI_RUNTIME_EXECUTOR is not configured — deployed projects cannot be runtime-accepted, so their Final Delivery stays BLOCKED'
        : null
  };
}

/**
 * Judge a project's runtime acceptance from the stored evidence.
 * `credentials` is a map of env-var NAME → boolean availability; a value is never read or
 * recorded, only whether the binding is present.
 */
export function runtimeAcceptanceFor({ project = null, files = [], hasBackend = false, fidelity = null, credentials = {}, env = null, controlPlaneUrls = [] } = {}) {
  const acceptance = currentRuntimeAcceptance(project);
  const report = evaluateRuntimeAcceptance({
    files,
    architecture: project?.architecture ?? null,
    spec: project?.requirementSpec ?? null,
    requirements: project?.requirementSpec?.requirements ?? [],
    acceptance,
    fidelity,
    hasBackend,
    credentials,
    deployment: project?.runtimeDeployment ?? null,
    projectId: project?.id ?? null,
    platform: project?.platform ?? null,
    executorConfigured: runtimeExecutorConfigured(env),
    currentArtifactId: project ? latestCodeArtifactId(project.id) : null,
    controlPlaneUrls
  });
  return { acceptance, report };
}

export default runtimeAcceptanceFor;
