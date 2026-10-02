#!/usr/bin/env node
// MAULI 2.0 — PRODUCTION RUNTIME ACCEPTANCE, the harness.
//
// scripts/production-runtime.mjs produces the report; this file takes it to the project it
// was produced FOR and records it, so the pipeline gate, the delivery and the dashboard all
// judge evidence that really came from running THAT project's generated application:
//
//   FOUNDER PROJECT → download its code → (deploy, if needed) → run the acceptance
//     (health → API contract → auth → CRUD → persistence → error path → user journey)
//     → POST /api/projects/:id/runtime-acceptance → read back the verdict → PASS / BLOCKED
//
// With `--deployed <url>` the whole sequence is issued over REAL network HTTP against the
// generated project's own deployment. That is the only transport that counts as production
// acceptance for a backend project: executing the source in this process is a local fixture,
// and the Worker will BLOCK a report that claims otherwise.
//
// There is no default project and no default credential any more. Point 1: production
// acceptance is automatic per project, never pinned to one configured id. Point 24: a real
// secret is never a default in source, so `--key`/`MAULI_KEY` must be supplied.
//
// Exit code is the verdict: 0 = passed, 1 = failed/blocked, 2 = configuration/project
// error, 3 = no generated code to run, 4 = the deployment URL does not belong to this
// project (identity mismatch).

import { runProductionRuntimeAcceptance } from './production-runtime.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const projectId = opt('project') ?? process.env.MAULI_RUNTIME_PROJECT ?? null;
const base = String(opt('base') ?? process.env.MAULI_BASE ?? 'https://mauli-2-0.kalpeshpatil4694.workers.dev').replace(/\/+$/, '');
// Point 24: no hardcoded founder key. A committed default is a committed production secret,
// and a missing one must fail loudly rather than silently authenticate as nobody.
const key = opt('key') ?? process.env.MAULI_KEY ?? null;
const deployed = opt('deployed');
const deployFirst = has('deploy');
const recordDeployment = has('record-deployment');
const outFile = opt('out');

if (!projectId) {
  console.error('Usage: node scripts/accept-runtime.mjs --project <projectId> --key <founder key> [--deployed <generated app url>] [--record-deployment] [--out report.json]');
  console.error('  --project is the CURRENT generated project. There is no default project: production runtime acceptance is per project.');
  process.exit(2);
}
if (!key) {
  console.error('Refusing to run: no founder key. Pass --key <key> or set MAULI_KEY in the environment.');
  console.error('  A credential is never defaulted in source — a hardcoded fallback is a committed production secret.');
  process.exit(2);
}
if (deployFirst && !deployed) {
  console.log('  target    will be deployed first, then the acceptance runs against the real URL');
}
// Point 3: MAULI's own control-plane URL is not a generated application's runtime URL.
if (deployed && !/^https?:\/\//i.test(deployed)) {
  console.error(`Refusing to run: --deployed "${deployed}" is not an http(s) URL. The acceptance run must hit the generated project's real deployment.`);
  process.exit(2);
}
if (deployed && deployed.replace(/\/+$/, '') === base) {
  console.error(`Refusing to run: --deployed ${deployed} is MAULI's own control-plane URL, not the generated application's deployment.`);
  process.exit(4);
}

async function call(method, path, body = undefined) {
  const headers = { 'x-mauli-founder': key, 'content-type': 'application/json' };
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  return { status: response.status, ok: response.ok, payload: payload ?? null, data: (payload && (payload.data ?? payload)) ?? null };
}

const line = (mark, label, detail = '') => console.log(`  ${mark} ${label}${detail ? `  — ${detail}` : ''}`);

// 1. the project ----------------------------------------------------------------
const detailRes = await call('GET', `/api/projects/${encodeURIComponent(projectId)}/detail`);
if (!detailRes.ok || !detailRes.data?.detail) {
  console.error(`Project ${projectId} could not be read from ${base} (HTTP ${detailRes.status}).`);
  process.exit(2);
}
const project = detailRes.data.detail.project ?? {};
console.log(`\nProduction runtime acceptance — ${project.name ?? project.objective ?? projectId}\n`);
console.log(`  project   ${projectId}`);

// 2. deployment: build and deploy THIS project, then capture its actual URL ----------
// Point 2/3. With `--deploy` the generated project's own files are handed to the configured
// deploy executor and the URL Cloudflare actually returns is what the acceptance runs
// against. No executor configured is BLOCKED / DEPENDENCY_REQUIRED — never a fabricated
// URL and never a run against the source in this process.
let deployment = project.runtimeDeployment ?? null;
if (deployFirst) {
  const executor = process.env.MAULI_DEPLOY_EXECUTOR ?? null;
  if (!executor) {
    console.error('\nBLOCKED — DEPENDENCY_REQUIRED: MAULI_DEPLOY_EXECUTOR is not configured, so this generated');
    console.error('  project cannot be deployed. Final Delivery stays blocked; nothing is being skipped.');
    process.exit(2);
  }
  const { deployGeneratedProject } = await import('./deploy-executor.mjs');
  const files = [];
  const artifactsRes = await call('GET', `/api/artifacts?projectId=${encodeURIComponent(projectId)}`);
  for (const artifact of (artifactsRes.data?.artifacts ?? []).filter((a) => a?.type === 'code-workspace')) {
    for (const file of (artifact.content?.files ?? [])) {
      if (file && typeof file.path === 'string' && typeof file.content === 'string') files.push({ path: file.path, content: file.content });
    }
  }
  const out = deployFirst && executor === 'local'
    ? await deployGeneratedProject({ projectId, files, artifactId: project.artifactId ?? null })
    : await (async () => {
      const headers = { 'content-type': 'application/json' };
      if (process.env.MAULI_DEPLOY_EXECUTOR_TOKEN) headers.authorization = `Bearer ${process.env.MAULI_DEPLOY_EXECUTOR_TOKEN}`;
      const response = await fetch(executor, { method: 'POST', headers, body: JSON.stringify({ projectId, files, artifactId: project.artifactId ?? null }) });
      const body = await response.json().catch(() => ({}));
      return { deployment: body.deployment ?? null };
    })();
  deployment = out.deployment;
  if (!deployment || deployment.status !== 'DEPLOYED' || !deployment.url) {
    console.error(`\nBLOCKED — the generated project failed to deploy (${deployment?.errorCategory ?? 'unknown'}): ${deployment?.errorMessage ?? 'no deployment record came back'}`);
    process.exit(1);
  }
  console.log(`  deployed  ${deployment.url} (${deployment.deploymentId ?? 'no deployment id'})`);
  const record = await call('POST', `/api/projects/${encodeURIComponent(projectId)}/deployment`, deployment);
  if (!record.ok) {
    console.error(`\nBLOCKED — the deployment happened but could not be recorded against this project (HTTP ${record.status}).`);
    process.exit(4);
  }
}

// 3. identity: the URL must belong to THIS project -----------------------------
const recorded = project.runtimeDeployment ?? deployment ?? null;
const target = deployment?.url ?? deployed ?? null;
if (target) {
  if (recorded?.url && recorded.url.replace(/\/+$/, '') !== target.replace(/\/+$/, '')) {
    console.error(`\nBLOCKED — identity mismatch: this project is deployed at ${recorded.url}, but the run was pointed at ${target}.`);
    console.error('  A runtime result produced for another project\'s URL is never attached to this one.');
    process.exit(4);
  }
  const reachable = await fetch(`${target.replace(/\/+$/, '')}/api/health`, { method: 'GET' })
    .then((r) => ({ ok: r.ok, status: r.status }))
    .catch((error) => ({ ok: false, status: 0, error: String(error?.message ?? error) }));
  if (!reachable.ok) {
    console.error(`\nBLOCKED — the deployment ${target} did not answer (HTTP ${reachable.status}). ${reachable.error ?? ''}`.trim());
    process.exit(1);
  }
}
console.log(`  target    ${target ? `deployed: ${target}` : base}\n`);
if (deployed) {
  if (recorded?.url && recorded.url.replace(/\/+$/, '') !== deployed.replace(/\/+$/, '')) {
    console.error(`\nBLOCKED — identity mismatch: this project is deployed at ${recorded.url}, but the run was pointed at ${deployed}.`);
    console.error('  A runtime result produced for another project\'s URL is never attached to this one.');
    process.exit(4);
  }
  const reachable = await fetch(`${deployed.replace(/\/+$/, '')}/api/health`, { method: 'GET' })
    .then((r) => ({ ok: r.ok, status: r.status }))
    .catch((error) => ({ ok: false, status: 0, error: String(error?.message ?? error) }));
  if (!reachable.ok) {
    console.error(`\nBLOCKED — the deployment ${deployed} did not answer (HTTP ${reachable.status}). ${reachable.error ?? ''}`.trim());
    process.exit(1);
  }
}
console.log(`  target    ${target ? `deployed: ${target}` : base}\n`);

// 4. its code -------------------------------------------------------------------
const artifactsRes = await call('GET', `/api/artifacts?projectId=${encodeURIComponent(projectId)}`);
const artifacts = artifactsRes.data?.artifacts ?? [];
const seen = new Set();
const files = [];
let deployedArtifactId = null;
for (const artifact of artifacts.filter((a) => a?.type === 'code-workspace')) {
  for (const file of (artifact.content?.files ?? [])) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || seen.has(file.path)) continue;
    seen.add(file.path);
    files.push({ path: file.path, content: file.content });
  }
  if (!deployedArtifactId) deployedArtifactId = artifact.id;
}
if (!files.length) {
  line('FAIL', 'generated code', 'this project has no code-workspace artifact to run');
  console.log('\nBLOCKED — no generated application exists to smoke test.\n');
  process.exit(3);
}

// 5. run the acceptance ----------------------------------------------------------
const report = await runProductionRuntimeAcceptance(files, {
  spec: project.requirementSpec ?? {},
  architecture: project.architecture ?? null,
  objective: project.objective ?? '',
  requirements: Array.isArray(project.requirements) ? project.requirements : [],
  baseUrl: target ?? null,
  // Identity travels WITH the report, so the Worker can refuse a run that belongs to
  // another project even if somebody posts it to the wrong project id.
  projectId,
  artifactId: deployedArtifactId,
  deployment: recorded ?? (target ? { url: target, status: 'DEPLOYED', projectId } : null),
  platform: project.platform ?? null
});

console.log('  acceptance run');
line(report.transport === 'deployed-http' ? 'PASS' : 'note', 'transport', report.transport);
if (report.coreFeature) {
  line(report.coreFeature.status === 'PASS' ? 'PASS' : 'BLOCKED', `core feature "${report.coreFeature.label}"`, report.coreFeature.status);
}
if (target && report.transport !== 'deployed-http') {
  console.error('\nBLOCKED — the run did not use real network HTTP, so it cannot be production acceptance.');
  process.exit(1);
}
for (const [id, test] of Object.entries(report.tests ?? {})) {
  line(test.status === 'PASS' ? 'PASS' : test.status === 'MISSING' ? 'MISS' : 'FAIL', id, test.detail ?? '');
}
console.log('');

if (outFile) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outFile, JSON.stringify({ runtimeAcceptance: report }, null, 2));
  console.log(`  report written to ${outFile}`);
}

// 5. record the deployment (opt-in: it is a fact about the world, not a verdict) ---
if (deployed && recordDeployment) {
  const dep = await call('POST', `/api/projects/${encodeURIComponent(projectId)}/deployment`, {
    deployment: {
      status: 'DEPLOYED',
      url: deployed,
      projectId,
      artifactId: deployedArtifactId,
      environment: 'production',
      deployedAt: new Date().toISOString()
    }
  });
  if (!dep.ok) {
    console.error(`  deployment record FAILED — HTTP ${dep.status}: ${dep.payload?.error?.message ?? 'unknown error'}`);
    process.exit(1);
  }
  console.log(`  deployment recorded: ${deployed}`);
}

// 6. record the evidence on the project ------------------------------------------
const post = await call('POST', `/api/projects/${encodeURIComponent(projectId)}/runtime-acceptance`, { runtimeAcceptance: report });
if (!post.ok) {
  console.error(`\nFAILED — the acceptance run could not be recorded (HTTP ${post.status}): ${post.payload?.error?.message ?? post.payload?.error ?? 'unknown error'}`);
  process.exit(1);
}
const summary = post.data?.productionRuntime ?? null;
if (summary) {
  console.log('  recorded verdict');
  line(summary.label === 'PASS' ? 'PASS' : summary.label === 'FAILED' ? 'FAIL' : 'BLOCK', 'production runtime', summary.reason ?? '');
  console.log(`    deployment       ${summary.deploymentStatus ?? '—'} ${summary.runtimeUrl ?? ''}`);
  console.log(`    tested at        ${summary.testedAt ?? '—'}`);
  console.log(`    transport        ${summary.transport ?? '—'}`);
  console.log(`    api              ${summary.api ?? '—'}`);
  console.log(`    database         ${summary.database ?? '—'}`);
  console.log(`    authentication   ${summary.authentication ?? '—'}`);
  console.log(`    user journey     ${summary.userJourney ?? '—'}`);
  console.log(`    critical reqs    ${summary.criticalPassed ?? 0} passed / ${summary.criticalFailed ?? 0} failed`);
  console.log(`    final delivery   ${summary.finalDelivery ?? '—'}`);
}
console.log('');
process.exit(summary && summary.status === 'passed' ? 0 : 1);