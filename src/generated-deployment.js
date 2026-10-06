// MAULI 2.0 — GENERATED PROJECT DEPLOYMENT.
//
// The Production Runtime Acceptance gate asks "did this app actually run?", and an
// unanswerable way to ask that is to run the source in the same process that produced it.
// The honest sequence for a generated backend product is:
//
//   generated source → package/install → build → wrangler validation → DEPLOY
//     → actual deployment URL → real HTTP E2E against that URL → record the evidence
//
// This module owns the middle of that sentence: the deployment RECORD.
//
// Why a record and not a boolean:
//   * `deployed: true` cannot be checked. A URL can: it is either the generated project's
//     own endpoint or it is not.
//   * MAULI's own control-plane URL is NOT a generated app's runtime URL. Point 3 of the
//     acceptance contract says so explicitly, and mixing the two is exactly how a run
//     "passes" against MAULI's health route and calls it proof of the product.
//   * A deployment belongs to ONE project. `assertRuntimeIdentity()` exists so a run
//     executed against another project's URL can never be attached to this one.
//
// Worker-safe and pure: no node imports, no network in the model, no eval.

/** The only four things a generated project's deployment may be. */
export const DEPLOYMENT_STATUS = {
  NOT_DEPLOYED: 'NOT_DEPLOYED',
  DEPLOYING: 'DEPLOYING',
  DEPLOYED: 'DEPLOYED',
  FAILED: 'FAILED'
};

/** Environments a generated project may be deployed into. */
export const DEPLOYMENT_ENVIRONMENT = { PRODUCTION: 'production', PREVIEW: 'preview', LOCAL: 'local' };

/**
 * Why a deployment is blocked. Named, so the dashboard prints a reason and not a shrug.
 */
export const DEPLOYMENT_BLOCKING = {
  EXECUTOR_UNAVAILABLE: 'deploy-executor-unavailable',
  FAILED: 'deployment-failed',
  NO_URL: 'deployment-url-missing',
  NOT_DEPLOYED: 'deployment-not-deployed',
  IDENTITY_MISMATCH: 'deployment-identity-mismatch',
  ANDROID_RUNTIME_UNAVAILABLE: 'android-runtime-unavailable'
};

/** Secrets must never appear in a deployment record, an error, or evidence. */
const SECRET_VALUE_RE = /(?:bearer\s+)[A-Za-z0-9._~+/=-]{8,}|\b[A-Za-z0-9_-]{32,}\b|(?:token|key|secret|password)\s*[=:]\s*\S+/gi;

/**
 * Reduce a deploy failure to (category, safe message). A CI token that expires and a
 * TypeScript syntax error are not the same blocker, and neither may print a token.
 */
export function categorizeDeploymentError(error) {
  const raw = String(error?.message ?? error ?? '').trim();
  const safe = raw
    .replace(SECRET_VALUE_RE, '[redacted]')
    .replace(/(https?:\/\/)([^/\s]+)@/g, '$1[redacted]@')
    .slice(0, 400);
  if (!safe) return { errorCategory: 'unknown', errorMessage: 'the deployment runner reported a failure with no message' };
  if (/authenticat|unauthori[sz]ed|invalid[_ -]?token|forbidden|permission|api[_ -]?token|credential/i.test(raw)) {
    return { errorCategory: 'credentials', errorMessage: safe };
  }
  if (/quota|limit exceeded|rate limit|insufficient|allowance/i.test(raw)) {
    return { errorCategory: 'quota', errorMessage: safe };
  }
  if (/parse|syntax|unexpected token|compile|bundl|esbuild|ts\d{4}/i.test(raw)) {
    return { errorCategory: 'build', errorMessage: safe };
  }
  if (/wrangler|deploy|worker|entry|d1 binding|durable object/i.test(raw)) {
    return { errorCategory: 'deployment', errorMessage: safe };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network|socket/i.test(raw)) {
    return { errorCategory: 'network', errorMessage: safe };
  }
  return { errorCategory: 'unknown', errorMessage: safe };
}

/**
 * Normalise anything shaped like a deployment record into the one record the rest of the
 * system reads. Idempotent, so it is safe to call on every projection.
 */
export function normalizeDeployment(record = null) {
  const src = record && typeof record === 'object' ? record : {};
  const status = Object.values(DEPLOYMENT_STATUS).includes(String(src.status))
    ? String(src.status)
    : (src.url ? DEPLOYMENT_STATUS.DEPLOYED : DEPLOYMENT_STATUS.NOT_DEPLOYED);
  const url = typeof src.url === 'string' && /^https?:\/\//i.test(src.url.trim()) ? src.url.trim().replace(/\/+$/, '') : null;
  const err = src.errorMessage || src.error ? categorizeDeploymentError(src.errorMessage || src.error) : { errorCategory: null, errorMessage: null };
  return {
    status,
    url,
    deploymentId: src.deploymentId ?? src.id ?? null,
    deployedAt: src.deployedAt ?? src.testedAt ?? null,
    commit: src.commit ?? src.revision ?? null,
    environment: DEPLOYMENT_ENVIRONMENT[String(src.environment ?? '').toLowerCase()] ?? null,
    projectId: src.projectId ?? null,
    // The exact artifact that was deployed. Identity point 17: the code that was tested and
    // the code that was deployed must be the same bytes, not merely the same project.
    artifactId: src.artifactId ?? src.sourceArtifactId ?? null,
    errorCategory: src.errorCategory ?? err.errorCategory,
    errorMessage: src.errorMessage ? String(src.errorMessage) : err.errorMessage,
    attemptedAt: src.attemptedAt ?? null
  };
}

/**
 * Is this the generated project's own runtime URL?
 *
 * Two things disqualify a URL outright:
 *   1. it is MAULI's own control-plane URL (the Worker this whole product runs inside), and
 *   2. it is not the URL recorded on this project's deployment record.
 * A host that differs from the control plane but is not recorded is still refused by (2):
 * an unrecorded URL is an unattributable URL.
 *
 * @param {string} url
 * @param {object} opts
 * @param {object|null} opts.deployment - this project's normalised deployment record
 * @param {string[]} [opts.controlPlaneUrls] - MAULI's own base URLs
 */
export function isGeneratedAppUrl(url, { deployment = null, controlPlaneUrls = [] } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  const candidate = url.trim().replace(/\/+$/, '');
  if (!candidate) return false;
  let host;
  try { host = new URL(candidate).host.toLowerCase(); } catch { return false; }
  const controlHosts = new Set();
  for (const base of [controlPlaneUrls, ...(deployment?.controlPlaneUrls ?? [])].flat()) {
    try { controlHosts.add(new URL(String(base)).host.toLowerCase()); } catch { /* not a URL — ignore */ }
  }
  if (controlHosts.has(host)) return false;
  // The deployment record is the authority on which URL belongs to this project.
  if (deployment?.url) return candidate === deployment.url;
  // No record yet: accept only when the URL itself names the project, which is the only
  // attribution available. `https://<worker>.workers.dev/mauli_<projectId>` qualifies.
  if (deployment?.projectId) return candidate.includes(String(deployment.projectId));
  return false;
}

/**
 * THE IDENTITY CHECK (point 17).
 *
 *   Project ID ↔ Artifact ↔ Deployment ↔ Runtime Evidence ↔ Requirement Matrix ↔ Delivery
 *
 * Every link is verified. A runtime run that belongs to a different project, a deployment
 * that recorded a different project's id, or an acceptance whose transport URL is not the
 * deployed URL, is BLOCKED — never attached with a warning.
 *
 * @returns {{ok:boolean, violations:Array<{code:string, why:string}>}}
 */
export function assertRuntimeIdentity({
  projectId = null, acceptance = null, deployment = null, controlPlaneUrls = [],
  expectedArtifactId = null, currentArtifactId = null, required = true
} = {}) {
  const violations = [];
  const add = (code, why) => { if (!violations.some((v) => v.code === code)) violations.push({ code, why }); };

  const dep = normalizeDeployment(deployment);

  if (required && dep.status !== DEPLOYMENT_STATUS.DEPLOYED) {
    add(DEPLOYMENT_BLOCKING.NOT_DEPLOYED, `the generated project was never deployed (deployment status: ${dep.status})`);
  }
  if (required && !dep.url) add(DEPLOYMENT_BLOCKING.NO_URL, 'the deployment produced no URL, so there is nothing to run the acceptance against');

  // The deployment must belong to this project.
  if (dep.projectId && projectId && dep.projectId !== projectId) {
    add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH, `deployment belongs to project ${dep.projectId}, not ${projectId}`);
  }
  // The deployed artifact must belong to this project too.
  if (dep.artifactId && expectedArtifactId && dep.artifactId !== expectedArtifactId) {
    add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH, `the deployed artifact ${dep.artifactId} is not the artifact that produced this project (${expectedArtifactId})`);
  }
  // The URL must be the generated app's own, never MAULI's control plane.
  if (dep.url && !isGeneratedAppUrl(dep.url, { deployment: dep, controlPlaneUrls })) {
    add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH, controlPlaneUrls.some((b) => {
      try { return new URL(dep.url).host === new URL(String(b)).host; } catch { return false; }
    })
      ? 'the deployment URL is MAULI\'s own control-plane URL, not the generated application'
      : `the deployment URL ${dep.url} is not recorded as this project's runtime URL`);
  }

  // The acceptance run must belong to this project.
  if (acceptance) {
    if (acceptance.projectId && projectId && acceptance.projectId !== projectId) {
      add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH, `the runtime acceptance run was produced for project ${acceptance.projectId}, not ${projectId}`);
    }
    const testedUrl = typeof acceptance.deployment === 'string' ? acceptance.deployment : (acceptance.deployment?.url ?? null);
    if (testedUrl && dep.url && testedUrl.replace(/\/+$/, '') !== dep.url) {
      add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH, `the acceptance run tested ${testedUrl} but this project is deployed at ${dep.url}`);
    }
    if (testedUrl && !isGeneratedAppUrl(testedUrl, { deployment: dep, controlPlaneUrls })) {
      add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH, `the acceptance run tested ${testedUrl}, which is not this generated project's runtime URL`);
    }
    // A production acceptance for a deployed project must have been produced over real
    // network HTTP. Executing the source in-process is a local fixture, not production.
    if (required && dep.status === DEPLOYMENT_STATUS.DEPLOYED && acceptance.transport && acceptance.transport !== 'deployed-http') {
      add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH,
        `the acceptance run used the "${acceptance.transport}" transport against a deployed project; production acceptance must issue real HTTP requests to ${dep.url}`);
    }
    // Point 18: a repair regenerates the code and redeploys it. The run that passed BEFORE
    // the repair describes bytes that no longer exist, so it is stale evidence — never a
    // standing PASS. A newer artifact invalidates the older run until it is re-accepted.
    if (acceptance.artifactId && currentArtifactId && acceptance.artifactId !== currentArtifactId) {
      add(DEPLOYMENT_BLOCKING.IDENTITY_MISMATCH,
        `the acceptance run tested artifact ${acceptance.artifactId} but the project has since been regenerated as ${currentArtifactId}; the run must be repeated against the new deployment`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Is a deploy runner configured? Named so "no runner" can never read as "deployed". */
export function deployExecutorConfigured(env) {
  return Boolean(env?.MAULI_DEPLOY_EXECUTOR && String(env.MAULI_DEPLOY_EXECUTOR).trim());
}

export function githubDeployExecutorConfigured(env) {
  return Boolean((env?.GITHUB_TOKEN || env?.MAULI_GITHUB_TOKEN || env?.GITHUB_PAT) && (env?.MAULI_CONTROL_PLANE_URL || env?.PUBLIC_BASE_URL || 'https://mauli-2-0.kalpeshpatil4694.workers.dev'));
}
async function dispatchGithubDeploy(env, project, artifactId) {
  const token = env?.GITHUB_TOKEN || env?.MAULI_GITHUB_TOKEN || env?.GITHUB_PAT;
  const repo = env?.MAULI_GITHUB_REPO || 'kalpeshpatil4694/MAULI-2.0';
  const controlPlane = String(env?.MAULI_CONTROL_PLANE_URL || env?.PUBLIC_BASE_URL || 'https://mauli-2-0.kalpeshpatil4694.workers.dev').replace(/\/+$/, '');
  if (!token || !controlPlane) return null;
  const response = await fetch('https://api.github.com/repos/' + repo + '/dispatches', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json', 'User-Agent': 'MAULI-2.0-deployment-executor' },
    body: JSON.stringify({ event_type: 'mauli_generated_deploy', client_payload: { projectId: project?.id ?? null, artifactId: artifactId ?? null, controlPlane } })
  });
  if (!response.ok) { const body = await response.text().catch(() => ''); const x = categorizeDeploymentError(body || ('GitHub dispatch HTTP ' + response.status)); return { ok:false, errorCategory:x.errorCategory, errorMessage:x.errorMessage }; }
  return { ok:true };
}

/**
 * Ask the configured deploy runner to build and deploy a generated project.
 * No runner → `{ deployed: false, reason }`; the caller records that as a FAILED/NOT_DEPLOYED
 * deployment, which blocks the gate. It is never treated as success.
 */
export async function dispatchGeneratedDeployment(env, { project = null, files = [], architecture = null, artifactId = null } = {}) {
  const url = env?.MAULI_DEPLOY_EXECUTOR;
  if (!deployExecutorConfigured(env)) {
    if (githubDeployExecutorConfigured(env)) {
      const dispatched = await dispatchGithubDeploy(env, project, artifactId);
      if (dispatched?.ok) return { deployed:false, pending:true, reason:'GitHub Actions deployment executor dispatched; waiting for callback', category:'deployment-pending', deployment:normalizeDeployment({status:DEPLOYMENT_STATUS.DEPLOYING,projectId:project?.id??null,artifactId,environment:'production',attemptedAt:new Date().toISOString()}) };
      return { deployed:false, reason:dispatched?.errorMessage??'GitHub Actions dispatch failed', category:dispatched?.errorCategory??'deployment', deployment:normalizeDeployment({status:DEPLOYMENT_STATUS.FAILED,projectId:project?.id??null,artifactId,errorCategory:dispatched?.errorCategory??'deployment',errorMessage:dispatched?.errorMessage??'GitHub Actions dispatch failed'}) };
    }
    return { deployed:false, reason:'No deployment executor is configured: MAULI_DEPLOY_EXECUTOR or GitHub hosted executor', category:'executor-unavailable', deployment:normalizeDeployment({status:DEPLOYMENT_STATUS.NOT_DEPLOYED,projectId:project?.id??null,artifactId}) };
  }
  const payload = {
    projectId: project?.id ?? null,
    objective: project?.objective ?? '',
    platform: project?.platform ?? null,
    architecture: architecture ?? project?.architecture ?? null,
    artifactId,
    files: (files ?? []).map((f) => ({ path: f.path, content: f.content }))
  };
  const headers = { 'Content-Type': 'application/json' };
  if (env?.MAULI_DEPLOY_EXECUTOR_TOKEN) headers.Authorization = `Bearer ${env.MAULI_DEPLOY_EXECUTOR_TOKEN}`;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const { errorCategory, errorMessage } = categorizeDeploymentError(body?.error ?? `deploy runner answered ${response.status}`);
      return {
        deployed: false, reason: errorMessage, category: errorCategory,
        deployment: normalizeDeployment({ status: DEPLOYMENT_STATUS.FAILED, projectId: project?.id ?? null, artifactId, errorMessage })
      };
    }
    const deployment = normalizeDeployment({
      ...(body?.deployment ?? body ?? {}),
      projectId: body?.deployment?.projectId ?? body?.projectId ?? project?.id ?? null,
      artifactId,
      deployedAt: body?.deployment?.deployedAt ?? new Date().toISOString()
    });
    if (deployment.status !== DEPLOYMENT_STATUS.DEPLOYED || !deployment.url) {
      return {
        deployed: false, reason: 'the deploy runner answered without a deployment URL', category: 'deployment',
        deployment: normalizeDeployment({ ...deployment, status: DEPLOYMENT_STATUS.FAILED, errorMessage: 'the deploy runner answered without a deployment URL' })
      };
    }
    return { deployed: true, reason: null, category: null, deployment };
  } catch (error) {
    const { errorCategory, errorMessage } = categorizeDeploymentError(error);
    return {
      deployed: false, reason: `deploy runner unreachable: ${errorMessage}`, category: errorCategory,
      deployment: normalizeDeployment({ status: DEPLOYMENT_STATUS.FAILED, projectId: project?.id ?? null, artifactId, errorMessage })
    };
  }
}

/**
 * What kind of runtime proof this architecture owes.
 *  * backend  → an actual deployment + real HTTP against it
 *  * native   → an installed app on an emulator/device (APK build alone is not runtime)
 *  * browser  → an executed app in a real runtime, no server to deploy
 */
export function runtimeDeploymentKind({ architecture = null, platform = null } = {}) {
  const nativePlatform = ['android', 'ios', 'desktop'].includes(String(platform ?? '').toLowerCase())
    || architecture?.native === true;
  if (nativePlatform) return 'native';
  if (architecture) return architecture.backend === true ? 'backend' : 'browser';
  return 'browser';
}

export default normalizeDeployment;