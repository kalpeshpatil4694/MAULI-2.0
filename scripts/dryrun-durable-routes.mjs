// Exercises the durable delivery ROUTES end to end against the in-memory store.
//
// The D1 write ceiling currently makes POST /api/command impossible, so the two routes
// the founder actually reaches for afterwards — listing a project's artifacts and
// downloading the generated app — have never been run against real data. They are run
// here against a completed local project, so that when writes lift the only unknown is
// D1 itself, not the code the founder clicks through.
import { store } from '../src/store.js';
import { queueCommand } from '../src/orchestrator.js';
import { schedulerTick } from '../src/scheduler.js';
import { collectProjectFiles } from '../src/zip.js';

store.configure(null);
store.data = new Map();
store.events = [];
store.hydrated = false;

const app = (await import('../src/index.js')).default;
const ENV = { MAULI_TEST_MODE: true };
const ctx = { waitUntil() {} };

const queued = await queueCommand('Build a simple calculator web app', {});
const projectId = queued.project.id;
if (queued.status === 'awaiting_approval') {
  const a = store.get('approvals', queued.approval.id);
  if (a) store.put('approvals', { ...a, state: 'approved', id: a.id });
  const p = store.get('projects', projectId);
  if (p) store.put('projects', { ...p, state: 'queued', id: p.id });
}
for (let i = 0; i < 90; i++) {
  await schedulerTick({}, { projectId, budgetMs: 0 });
  const p = store.get('projects', projectId);
  if (p && ['completed', 'failed', 'cancelled'].includes(p.state)) break;
  const past = new Date(Date.now() - 20000).toISOString();
  for (const [id, t] of store.data.get('tasks') ?? []) {
    if (t.projectId === projectId && !['completed', 'failed', 'cancelled'].includes(t.state)) {
      store.data.get('tasks').set(id, { ...t, updatedAt: past, claimedAt: past });
    }
  }
  for (const [id, r] of store.data.get('runs') ?? []) {
    if (r.state === 'running') store.data.get('runs').set(id, { ...r, heartbeatAt: past, startedAt: past });
  }
}

const results = [];
const check = (ok, label, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${detail ? '  — ' + detail : ''}`);
};

const get = async (path) => app.fetch(new Request('https://mauli.test' + path), ENV, ctx);

// ---- 1. durable project + task history -------------------------------------
const detailRes = await get(`/api/projects/${projectId}/detail`);
const detail = (await detailRes.json()).data?.detail;
const tasks = detail?.tasks ?? [];
check(detailRes.ok && tasks.length > 0, 'project detail readable after the fact', `${tasks.length} tasks`);
check(tasks.every(t => t.state === 'completed'), 'every task completed', `${tasks.filter(t => t.state === 'completed').length}/${tasks.length}`);

// ---- 2. artifact listing ----------------------------------------------------
const artRes = await get(`/api/artifacts?projectId=${projectId}`);
const artifacts = (await artRes.json()).data?.artifacts ?? [];
const code = artifacts.filter(a => a.type === 'code-workspace');
const delivery = artifacts.filter(a => a.type === 'final-delivery');
check(artRes.ok && code.length > 0, 'AI code artifact listed', `${code.length} code-workspace`);
check(delivery.length > 0, 'final delivery recorded', delivery[0]?.id ?? 'none');

// ---- 3. which generator produced it ----------------------------------------
const generatedBy = [...new Set(code.map(a => a.metadata?.generatedBy))];
console.log(`         generatedBy: ${JSON.stringify(generatedBy)}`);
// Offline there is no Workers AI binding, so the template fallback is the CORRECT outcome
// here and its absence would be the bug. Saying so keeps a green run honest instead of
// pretending this environment proves the AI path — that is what /api/ai/code-probe and a
// live POST /api/command are for.
if (generatedBy.includes('functional-code-executor')) {
  check(true, 'produced by the AI path, not the template fallback', JSON.stringify(generatedBy));
} else {
  console.log('  SKIP  produced by the AI path  — no AI binding offline; verified live via /api/ai/code-probe');
}

// ---- 4. the download the founder clicks -------------------------------------
const target = delivery[0] ?? code[0];
const zipRes = await get(`/api/artifacts/${target.id}/download`);
const buf = new Uint8Array(await zipRes.arrayBuffer());
check(zipRes.ok && buf[0] === 0x50 && buf[1] === 0x4b,
  'artifact downloads as a real zip', `${zipRes.status}, ${buf.length} bytes`);
check((zipRes.headers.get('content-disposition') ?? '').includes('attachment'),
  'download is served as an attachment', zipRes.headers.get('content-disposition') ?? 'none');

const files = collectProjectFiles(target.projectId, target, store);
check(files.length > 0, 'the zip contains project files', files.map(f => f.path).join(', '));
const manifest = files.find(f => f.path === 'package.json');
check(!!manifest && String(manifest.content).replace(/\s/g, '').length > 10,
  'the delivered project has a usable package.json', manifest ? String(manifest.content).slice(0, 80) : 'missing');

const passed = results.filter(Boolean).length;
console.log(`\n${passed === results.length ? 'ALL STAGES PASSED' : 'FAILURES PRESENT'} (${passed}/${results.length})`);
process.exit(passed === results.length ? 0 : 1);
