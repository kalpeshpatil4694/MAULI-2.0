#!/usr/bin/env node
// MAULI 2.0 — PRODUCTION RUNTIME ACCEPTANCE, the harness.
//
// scripts/production-runtime.mjs produces the report; this file takes it to the project it
// was produced FOR and records it, so the pipeline gate, the delivery and the dashboard all
// judge evidence that really came from running that project's generated application:
//
//   FOUNDER PROJECT → download its code → run the smoke test
//     (health → API contract → auth → CRUD → persistence → error path → user journey)
//     → POST /api/projects/:id/runtime-acceptance → read back the verdict → PASS / BLOCKED
//
// With `--deployed <url>` the same sequence is issued over real network HTTP against a
// deployed Worker (the post-deploy smoke). Without it the generated Worker is executed in
// this process against a real in-memory D1, real WebCrypto and a real WebSocketPair.
//
// Exit code is the verdict: 0 = passed, 1 = failed/blocked, 2 = project unknown,
// 3 = the project has no generated code to run.

import { runProductionRuntimeAcceptance } from './production-runtime.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const projectId = opt('project') ?? process.env.MAULI_RUNTIME_PROJECT ?? null;
const base = String(opt('base') ?? process.env.MAULI_BASE ?? 'https://mauli-2-0.kalpeshpatil4694.workers.dev').replace(/\/+$/, '');
const key = opt('key') ?? process.env.MAULI_KEY ?? 'Mauli123';
const deployed = opt('deployed');
const outFile = opt('out');

if (!projectId) {
  console.error('Usage: node scripts/accept-runtime.mjs --project <projectId> [--base <mauli url>] [--deployed <generated app url>] [--out report.json]');
  process.exit(2);
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
console.log(`  target    ${base}${deployed ? ` (deployed Worker: ${deployed})` : ' (generated Worker executed here)'}\n`);

// 2. its code -------------------------------------------------------------------
const artifactsRes = await call('GET', `/api/artifacts?projectId=${encodeURIComponent(projectId)}`);
const artifacts = artifactsRes.data?.artifacts ?? [];
const seen = new Set();
const files = [];
for (const artifact of artifacts.filter((a) => a?.type === 'code-workspace')) {
  for (const file of (artifact.content?.files ?? [])) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string' || seen.has(file.path)) continue;
    seen.add(file.path);
    files.push({ path: file.path, content: file.content });
  }
}
if (!files.length) {
  line('FAIL', 'generated code', 'this project has no code-workspace artifact to run');
  console.log('\nBLOCKED — no generated application exists to smoke test.\n');
  process.exit(3);
}

// 3. run the smoke test ---------------------------------------------------------
const report = await runProductionRuntimeAcceptance(files, {
  spec: project.requirementSpec ?? {},
  architecture: project.architecture ?? null,
  objective: project.objective ?? '',
  requirements: Array.isArray(project.requirements) ? project.requirements : [],
  baseUrl: deployed ?? null
});

console.log('  smoke test');
for (const [id, test] of Object.entries(report.tests ?? {})) {
  line(test.status === 'PASS' ? 'PASS' : test.status === 'MISSING' ? 'MISS' : 'FAIL', id, test.detail ?? '');
}
console.log('');

if (outFile) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outFile, JSON.stringify({ runtimeAcceptance: report }, null, 2));
  console.log(`  report written to ${outFile}`);
}

// 4. record the evidence on the project ----------------------------------------
const post = await call('POST', `/api/projects/${encodeURIComponent(projectId)}/runtime-acceptance`, { runtimeAcceptance: report });
if (!post.ok) {
  console.error(`\nFAILED — the acceptance run could not be recorded (HTTP ${post.status}): ${post.payload?.error?.message ?? post.payload?.error ?? 'unknown error'}`);
  process.exit(1);
}
const summary = post.data?.productionRuntime ?? null;
if (summary) {
  console.log('  recorded verdict');
  line(summary.label === 'PASS' ? 'PASS' : summary.label === 'FAILED' ? 'FAIL' : 'BLOCK', 'production runtime', summary.reason ?? '');
  console.log(`    tested at        ${summary.testedAt ?? '—'}`);
  console.log(`    deployment       ${summary.deployment ?? '—'}`);
  console.log(`    api              ${summary.api ?? '—'}`);
  console.log(`    database         ${summary.database ?? '—'}`);
  console.log(`    authentication   ${summary.authentication ?? '—'}`);
  console.log(`    user journey     ${summary.userJourney ?? '—'}`);
  console.log(`    critical reqs    ${summary.criticalPassed ?? 0} passed / ${summary.criticalFailed ?? 0} failed`);
}
console.log('');
process.exit(summary && summary.status === 'passed' ? 0 : 1);
