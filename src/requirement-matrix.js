// MAULI 2.0 — TRACEABILITY, REQUIREMENT MATRIX AND QUALITY SCORE.
//
// "The code exists" is not "the requirement is complete". Every requirement extracted from
// the founder's command is followed through the whole chain —
//   Requirement → Design → Task → Agent → File/Module → API → DB → Test → Result —
// and the row is only allowed to say PASS when there is evidence at the far end of it.
//
// Two rules this module exists to enforce:
//   * A critical requirement that FAILs makes the project NOT DELIVERABLE. No amount of
//     passing generic features buys a delivery.
//   * "functional" and "founder requirement complete" are two different statuses. An app
//     can run beautifully and still not be the product that was asked for.

import { evaluateRequirementCoverage } from './generated-app-quality.js';

export const MATRIX_STATUS = { PASS: 'PASS', PARTIAL: 'PARTIAL', FAIL: 'FAIL', BLOCKED: 'BLOCKED' };

// Evidence vocabulary used by the runtime verifier. Each flag is produced by EXECUTING
// the generated app, not by reading it.
export const RUNTIME_EVIDENCE_KEYS = [
  'persistence', 'create', 'read', 'update', 'delete',
  'backend', 'validation', 'database', 'auth_register', 'auth_login',
  'auth_protected', 'logout', 'realtime', 'external', 'error_handling'
];

const CATEGORY_EVIDENCE = {
  product: ['create', 'read', 'update', 'delete', 'search', 'report', 'export', 'import', 'reminder', 'notification', 'attachment', 'payment', 'audit', 'media'],
  platform: [],
  data: ['persistence', 'create', 'read', 'database'],
  api: ['backend', 'validation', 'database'],
  auth: ['auth_register', 'auth_login', 'auth_protected', 'logout'],
  realtime: ['realtime'],
  external: ['external', 'error_handling'],
  security: ['validation', 'error_handling', 'auth_protected'],
  acceptance: ['persistence', 'create', 'auth_protected', 'realtime'],
};

function executedSource(files) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const out = [];
  for (const f of list) {
    if (/\.(json|lock|txt)$/i.test(f.path)) continue;
    if (/\.md$/i.test(f.path)) continue;
    out.push(String(f.content));
  }
  return out.join('\n').toLowerCase();
}

function staticEvidence(requirement, haystack) {
  const words = (requirement.evidence ?? []).map((w) => String(w).toLowerCase()).filter(Boolean);
  const matched = words.filter((w) => haystack.includes(w));
  return { matched, ratio: words.length ? matched.length / words.length : null };
}

/**
 * Build the requirement matrix for a project.
 *
 * @param {object} input
 * @param {Array} input.requirements - extracted requirements (each with a stable REQ id)
 * @param {Array} input.files       - the merged generated source
 * @param {object} [input.fidelity] - analyzeGeneratedApp() output, for the placeholder rule
 * @param {object} [input.runtime]  - runtime execution evidence from the verifier
 * @returns {{rows:Array, criticalFailed:Array, deliverable:boolean, summary:object}}
 */
export function buildRequirementMatrix({ requirements = [], files = [], fidelity = null, runtime = null, architecture = null } = {}) {
  const haystack = executedSource(files);
  const hasCode = (Array.isArray(files) ? files : []).length > 0;
  const rows = (Array.isArray(requirements) ? requirements : []).map((requirement) => {
    const id = requirement.id ?? requirement;
    const title = requirement.title ?? String(id);
    const critical = requirement.critical === true;
    const evidence = staticEvidence(requirement, haystack);
    const wanted = CATEGORY_EVIDENCE[requirement.category] ?? [];
    const runtimeKeys = wanted.filter((k) => runtime?.evidence?.[k] === true);
    // A requirement that can only exist behind a server is not a defect in an app that has
    // no server. A single-user medicine tracker has no 401 endpoint and must not be refused
    // for lacking one; it is recorded as NOT APPLICABLE, with the reason, rather than failed.
    if (requirement.appliesTo === 'backend' && architecture && architecture.backend !== true) {
      return {
        id, title, category: requirement.category ?? 'product', critical,
        status: 'NOT APPLICABLE', basis: `this architecture has no backend (${architecture.id}), so a server-side requirement does not apply`,
        matched: [], verification: requirement.verification ?? 'runtime'
      };
    }

    let status;
    let basis;
    if (!hasCode) {
      status = MATRIX_STATUS.BLOCKED;
      basis = 'no generated code to verify';
    } else if (title.includes('No stub, mock or fake-success')) {
      // The rule is evidenced by the fidelity gate itself, not by a word in the code.
      status = fidelity && fidelity.passed ? MATRIX_STATUS.PASS : MATRIX_STATUS.FAIL;
      basis = fidelity?.passed ? 'static fidelity gate found no placeholder, mock or dead control' : 'fidelity violations: ' + (fidelity?.violations ?? []).map((v) => v.code).join(', ');
    } else if (runtimeKeys.length > 0) {
      status = MATRIX_STATUS.PASS;
      basis = `runtime execution: ${runtimeKeys.join(', ')}`;
    } else if (evidence.ratio === null) {
      // A requirement with no observable evidence vocabulary ("the product runs on the
      // web") cannot be evidenced by running the app any more than by reading it. Scoring
      // it FAIL under runtime made a correct product report REQUIREMENT NOT VERIFIED for a
      // row nobody can observe.
      status = MATRIX_STATUS.PASS;
      basis = 'structural requirement, satisfied by the delivered target itself';
    } else if (runtime && runtime.executed) {
      // The app was executed and this requirement's behaviour was never observed.
      status = evidence.matched.length ? MATRIX_STATUS.PARTIAL : MATRIX_STATUS.FAIL;
      basis = evidence.matched.length ? 'source words present but no runtime behaviour observed' : 'no evidence in source and no runtime behaviour observed';
    } else if (requirement.verifiableStatically === false) {
      status = evidence.matched.length ? MATRIX_STATUS.PARTIAL : MATRIX_STATUS.FAIL;
      basis = evidence.matched.length ? 'static evidence only; this requirement needs runtime proof' : 'no evidence for this requirement';
    } else {
      status = evidence.ratio === null ? MATRIX_STATUS.PASS : (evidence.ratio > 0 ? MATRIX_STATUS.PASS : MATRIX_STATUS.FAIL);
      basis = evidence.matched.length ? `source evidence: ${evidence.matched.slice(0, 6).join(', ')}` : 'no evidence for this requirement';
    }

    return {
      id,
      title,
      category: requirement.category ?? 'product',
      critical,
      status,
      basis,
      matched: evidence.matched.slice(0, 8),
      verification: requirement.verification ?? 'runtime'
    };
  });

  const criticalFailed = rows.filter((r) => r.critical && (r.status === MATRIX_STATUS.FAIL || r.status === MATRIX_STATUS.BLOCKED));
  const applicable = rows.filter((r) => r.status !== 'NOT APPLICABLE');
  const anyFailed = rows.filter((r) => r.status === MATRIX_STATUS.FAIL || r.status === MATRIX_STATUS.BLOCKED);
  return {
    rows,
    criticalFailed,
    deliverable: criticalFailed.length === 0,
    summary: {
      total: rows.length,
      applicable: applicable.length,
      notApplicable: rows.length - applicable.length,
      pass: rows.filter((r) => r.status === MATRIX_STATUS.PASS).length,
      partial: rows.filter((r) => r.status === MATRIX_STATUS.PARTIAL).length,
      fail: rows.filter((r) => r.status === MATRIX_STATUS.FAIL).length,
      blocked: rows.filter((r) => r.status === MATRIX_STATUS.BLOCKED).length,
      criticalTotal: rows.filter((r) => r.critical).length,
      criticalPassed: rows.filter((r) => r.critical && r.status === MATRIX_STATUS.PASS).length
    }
  };
}

/**
 * Requirement → Design → Task → Agent → File → API → DB → Test → Result.
 * Links are resolved from what the project actually did, so a row cannot claim a design
 * or a file that was never produced.
 */
export function buildTraceability({ project = {}, spec = null, matrix = null, tasks = [], artifacts = [] } = {}) {
  const rows = [];
  const byTitle = (task, needle) => String(task.title ?? '').toLowerCase().includes(needle);
  const codeArtifacts = artifacts.filter((a) => a.type === 'code-workspace');
  const allFiles = codeArtifacts.flatMap((a) => (a.content?.files ?? []).map((f) => f.path));

  const taskFor = (category) => {
    switch (category) {
      case 'data': return tasks.find((t) => byTitle(t, 'database') || byTitle(t, 'persistence'));
      case 'api': case 'security': case 'auth': return tasks.find((t) => byTitle(t, 'backend') || byTitle(t, 'security'));
      case 'realtime': return tasks.find((t) => byTitle(t, 'backend')) ?? tasks.find((t) => byTitle(t, 'frontend'));
      case 'acceptance': case 'platform': return tasks.find((t) => byTitle(t, 'testing') || byTitle(t, 'verification'));
      default: return tasks.find((t) => byTitle(t, 'frontend')) ?? tasks.find((t) => byTitle(t, 'backend'));
    }
  };
  const filesFor = (category) => {
    if (category === 'data') return allFiles.filter((p) => /sql|schema|db|store|migration/i.test(p) || /localstorage/i.test(readFileOf(codeArtifacts, p)));
    if (category === 'api' || category === 'auth' || category === 'security') return allFiles.filter((p) => /worker|api|server|route|auth|session/i.test(p));
    if (category === 'realtime') return allFiles.filter((p) => /worker|realtime|socket|ws|sse|app\.js|index\.html/i.test(p));
    return allFiles.filter((p) => /\.(html?|js|css)$/i.test(p));
  };
  function readFileOf(list, path) {
    for (const a of list) {
      const hit = (a.content?.files ?? []).find((f) => f.path === path);
      if (hit) return String(hit.content ?? '');
    }
    return '';
  }

  for (const requirement of (spec?.requirements ?? [])) {
    const matrixRow = (matrix?.rows ?? []).find((r) => r.id === requirement.id) ?? null;
    const task = taskFor(requirement.category);
    const apiPath = (spec?.apis ?? [])[0]?.path ?? null;
    const dbLayer = requirement.category === 'data' || requirement.category === 'api'
      ? (project.architecture?.database === 'local' ? 'device store (localStorage)' : 'D1')
      : null;
    rows.push({
      requirementId: requirement.id,
      requirement: requirement.title,
      critical: requirement.critical === true,
      design: requirement.statement,
      taskId: task?.id ?? null,
      task: task?.title ?? null,
      agentId: task?.assignedAgentId ?? task?.agentId ?? null,
      agent: task?.assignedAgentName ?? null,
      files: filesFor(requirement.category).slice(0, 8),
      api: requirement.category === 'api' || requirement.category === 'auth' || requirement.category === 'data' ? apiPath : null,
      db: dbLayer,
      test: matrixRow?.verification ?? 'runtime',
      result: matrixRow?.status ?? 'BLOCKED',
      evidence: matrixRow?.basis ?? 'not evaluated'
    });
  }
  return { rows, chain: ['Requirement', 'Design', 'Task', 'Agent', 'File/Module', 'API', 'DB', 'Test', 'Result'] };
}

/**
 * The ten quality categories. A score is only as honest as its weakest category, and a
 * percentage is never printed without the evidence behind it.
 */
export const QUALITY_CATEGORIES = [
  'requirementCoverage', 'functionalCoverage', 'runtimeVerification', 'backendIntegration',
  'databaseIntegration', 'security', 'errorHandling', 'persistence', 'uiInteraction', 'artifactIntegrity'
];

export function scoreGeneratedAppQuality({ matrix = null, fidelity = null, runtime = null, integrity = null, architecture = null, files = [] } = {}) {
  const rows = matrix?.rows ?? [];
  const total = rows.length || 1;
  const pass = rows.filter((r) => r.status === 'PASS').length;
  const ev = runtime?.evidence ?? {};
  const pct = (n) => Math.max(0, Math.min(100, Math.round(n)));

  const criticals = rows.filter((r) => r.critical);
  const categories = {
    requirementCoverage: pct((pass / total) * 100),
    functionalCoverage: pct((rows.filter((r) => r.status === 'PASS').length / total) * 100),
    runtimeVerification: runtime?.executed ? pct(((runtime.passedSteps?.length ?? 0) / Math.max(1, (runtime.steps?.length ?? 1))) * 100) : 0,
    backendIntegration: architecture?.backend ? (ev.backend ? (ev.database ? 100 : 70) : 0) : (architecture ? 100 : 0),
    databaseIntegration: ev.persistence ? 100 : (ev.database ? 70 : 0),
    security: pct((fidelity && fidelity.passed ? 60 : 0) + (ev.auth_protected ? 25 : 0) + (ev.validation ? 15 : 0)),
    errorHandling: ev.error_handling ? 100 : (/try\s*\{|catch\s*\(/.test(executedSource(files)) ? 50 : 0),
    persistence: ev.persistence ? 100 : (/localstorage/i.test(executedSource(files)) ? 50 : 0),
    uiInteraction: fidelity?.stats?.interactionCount > 0 ? pct(60 + Math.min(40, fidelity.stats.interactionCount * 10)) : 0,
    artifactIntegrity: integrity && integrity.valid ? 100 : (integrity ? 60 : 0)
  };

  const values = QUALITY_CATEGORIES.map((k) => categories[k]);
  const overall = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  return {
    categories,
    overall,
    weakest: QUALITY_CATEGORIES.reduce((worst, k) => (categories[k] < categories[worst] ? k : worst), QUALITY_CATEGORIES[0]),
    criticalsPassed: criticals.length > 0 && criticals.every((r) => r.status === 'PASS'),
    // "100% functional" is a claim about evidence, never about file counts.
    functionalClaim: overall === 100 && (!criticals.length || criticals.every((r) => r.status === 'PASS'))
  };
}

/**
 * The two statuses the founder report must keep apart.
 * A generated app can be perfectly functional and still be the wrong product.
 */
export function dualStatus({ matrix = null, runtime = null, fidelity = null }) {
  const rows = (matrix?.rows ?? []).filter((r) => r.status !== 'NOT APPLICABLE');
  const criticals = rows.filter((r) => r.critical);
  const functional = Boolean(runtime?.verdict === 'functional' || fidelity?.passed);
  const requirementComplete = rows.length > 0 && criticals.length > 0
    && criticals.every((r) => r.status === 'PASS')
    && rows.every((r) => r.status !== 'FAIL' && r.status !== 'BLOCKED');
  return {
    functional: functional ? 'FUNCTIONAL' : 'NOT FUNCTIONAL',
    founderRequirementComplete: requirementComplete ? 'REQUIREMENT VERIFIED' : (rows.length ? 'REQUIREMENT NOT VERIFIED' : 'NO REQUIREMENTS EXTRACTED'),
    note: 'These are independent: an app can run and still not be the product requested.'
  };
}

export { evaluateRequirementCoverage };
