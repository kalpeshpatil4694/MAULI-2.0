// Regression coverage for the live flicker: a serving isolate hydrated while a founder
// command was still being written, so it held the project row without its tasks and never
// re-hydrated. /api/projects/:id/detail and /api/project-progress/:id then flipped between
// the real task list and an empty one across refreshes. Both now read this project's tasks
// from D1 (behind a short cache) instead of trusting per-isolate memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import app, { __resetD1TaskCache } from '../src/index.js';
import { store } from '../src/store.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function fakeD1({ projects = [], tasks = [], failTypes = [] } = {}) {
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
  const valuesFor = (type) => (type === 'projects' ? projects : type === 'tasks' ? tasks : []);
  const rowsFor = (type) => valuesFor(type).map((v) => ({ data: JSON.stringify(v) }));
  return {
    DB: {
      prepare(rawSql) {
        let args = [];
        const stmt = {
          bind(...a) { args = a; return stmt; },
          async all() {
            const sql = norm(rawSql);
            if (/^SELECT data FROM entities WHERE type = \?/.test(sql)) {
              // failTypes simulates one per-type scan dying while bounded reads keep
              // answering — the production case is the daily D1 rows_read limit, where
              // the full hydration sweep fails but single-row and LIMIT queries work.
              if (failTypes.includes(args[0])) throw new Error(`simulated D1 read failure for ${args[0]}`);
              const rows = rowsFor(args[0]);
              return { results: rows, meta: { rows_read: rows.length } };
            }
            return { results: [], meta: { rows_read: 0 } };
          },
          // d1Get reads one entity straight from D1: the direct fallback that must answer
          // for a project whose isolate never hydrated.
          async first() {
            const sql = norm(rawSql);
            if (/^SELECT data FROM entities WHERE type = \? AND id = \? LIMIT 1$/.test(sql)) {
              const match = valuesFor(args[0]).find((v) => v?.id === args[1]);
              return match ? { data: JSON.stringify(match) } : null;
            }
            return null;
          },
          async run() { return { meta: { rows_written: 0 } }; },
        };
        return stmt;
      },
    },
  };
}

test('project detail recovers tasks from D1 when the isolate cache is missing them', async () => {
  __resetD1TaskCache();
  const suffix = TAIL();
  const pid = `project_d1_${suffix}`;
  const dep = `t1_${suffix}`;
  const project = { id: pid, name: 'D1 project', objective: 'Build', state: 'active', requirements: ['x'], createdAt: new Date().toISOString() };
  const tasks = [
    { id: dep, projectId: pid, title: 'Plan', state: 'completed', dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1, createdAt: new Date().toISOString() },
    { id: `t2_${suffix}`, projectId: pid, title: 'Implement backend', state: 'assigned', dependsOn: [dep], requiredCapabilities: ['backend'], executor: 'internal.code', sequence: 2, createdAt: new Date().toISOString() },
  ];
  const env = fakeD1({ projects: [project], tasks });

  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = true;          // warm isolate: it will not re-hydrate
  store.put('projects', project); // memory has the project row...
  // ...but the tasks never made it into this isolate's memory (the exact production race).
  assert.equal(store.list('tasks').filter((t) => t.projectId === pid).length, 0);

  const res = await app.fetch(new Request(`https://mauli.test/api/projects/${pid}/detail`), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  const detail = body.detail ?? body.data.detail;
  assert.equal(detail.tasks.length, 2, 'the detail screen must show the real task list from D1');
  assert.equal(detail.summary.totalTasks, 2);
  assert.equal(detail.summary.completedTasks, 1);
  assert.equal(detail.summary.runningTasks, 1, 'the assigned task counts as running work');
});

test('project progress counts tasks recovered from D1, not the empty isolate cache', async () => {
  __resetD1TaskCache();
  const suffix = TAIL();
  const pid = `project_d1p_${suffix}`;
  const project = { id: pid, name: 'D1 progress', objective: 'Build', state: 'active', requirements: ['x'], createdAt: new Date().toISOString() };
  const tasks = [
    { id: `p1_${suffix}`, projectId: pid, title: 'Plan', state: 'completed', dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1 },
    { id: `p2_${suffix}`, projectId: pid, title: 'Pipeline gate: build', state: 'verifying', dependsOn: [], requiredCapabilities: ['verification'], executor: 'internal.pipeline-gate', sequence: 2 },
  ];
  const env = fakeD1({ projects: [project], tasks });

  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = true;
  store.put('projects', project);

  const res = await app.fetch(new Request(`https://mauli.test/api/project-progress/${pid}`), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const progress = (await res.json()).data.progress;
  assert.equal(progress.tasks.total, 2);
  assert.equal(progress.tasks.completed, 1);
  assert.equal(progress.tasks.verifying, 1);
  assert.equal(progress.tasks.running, 1, 'a verifying task is running work');
  assert.equal(progress.status, 'in_progress');
  assert.ok(progress.currentTask, 'the live task must be named');
});

// Project Details used to compute pendingTasks by subtraction (total - completed - failed -
// running), so blocked and cancelled tasks landed in the runnable-pending bucket. A project
// whose only remaining tasks were parked therefore advertised a backlog it could never claim,
// and the number disagreed with the authoritative projectTaskSummary the Projects table uses.
test('blocked and cancelled tasks are not reported as pending backlog', async () => {
  __resetD1TaskCache();
  const suffix = TAIL();
  const pid = `project_pending_${suffix}`;
  const project = { id: pid, name: 'Pending contract', objective: 'Build', state: 'active', requirements: ['x'], createdAt: new Date().toISOString() };
  const tasks = [
    { id: `c1_${suffix}`, projectId: pid, title: 'Done', state: 'completed', dependsOn: [], sequence: 1 },
    { id: `q1_${suffix}`, projectId: pid, title: 'Queued', state: 'queued', dependsOn: [], sequence: 2 },
    { id: `b1_${suffix}`, projectId: pid, title: 'Blocked one', state: 'blocked', dependsOn: [], sequence: 3 },
    { id: `b2_${suffix}`, projectId: pid, title: 'Blocked two', state: 'blocked', dependsOn: [], sequence: 4 },
    { id: `x1_${suffix}`, projectId: pid, title: 'Cancelled', state: 'cancelled', dependsOn: [], sequence: 5 },
  ];
  const env = fakeD1({ projects: [project], tasks });

  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = true;
  store.put('projects', project);

  const res = await app.fetch(new Request(`https://mauli.test/api/projects/${pid}/detail`), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const body = await res.json();
  const detail = body.detail ?? body.data.detail;
  assert.equal(detail.summary.totalTasks, 5);
  assert.equal(detail.summary.completedTasks, 1);
  assert.equal(detail.summary.runningTasks, 0);
  assert.equal(detail.summary.pendingTasks, 1, 'only the queued task is runnable backlog');
  assert.equal(detail.summary.blockedTasks, 2);
  assert.equal(detail.summary.cancelledTasks, 1);
});

// The production bug behind "Error: Project not found" on the deployed dashboard: a fresh
// isolate serves the dashboard load and its /api/state polling first (light paths, which
// deliberately skip hydration), so initOnce marked the isolate initialized but cold. Every
// later /api/projects/:id/detail on that isolate fell back to the empty in-memory store and
// answered 404 — while the Projects table kept listing the very same project from D1.
test('project detail answers for a D1 project on an isolate that never hydrated', async () => {
  __resetD1TaskCache();
  const suffix = TAIL();
  const pid = `project_cold_${suffix}`;
  const project = { id: pid, name: 'Cold isolate project', objective: 'Build', state: 'active', requirements: ['x'], createdAt: new Date().toISOString() };
  const tasks = [
    { id: `k1_${suffix}`, projectId: pid, title: 'Plan', state: 'completed', dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1, createdAt: new Date().toISOString() },
    { id: `k2_${suffix}`, projectId: pid, title: 'Implement backend', state: 'assigned', dependsOn: [], requiredCapabilities: ['backend'], executor: 'internal.code', sequence: 2, createdAt: new Date().toISOString() },
  ];
  // Hydration itself fails (the agents + projects scans die — the daily rows_read limit),
  // while the bounded per-project reads keep working, exactly as in production.
  const env = fakeD1({ projects: [project], tasks, failTypes: ['agents', 'projects'] });

  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = false; // cold isolate

  // The dashboard load / 5 s poll hits a light path first and must stay store-free.
  const stateRes = await app.fetch(new Request('https://mauli.test/api/state'), env, { waitUntil() {} });
  assert.equal(stateRes.status, 200);
  assert.equal(store.hydrated, false, 'light paths must not hydrate the store');

  // The founder clicks 📄 Details. The project must be answered for from D1 even though
  // this isolate could not hydrate — a false "Project not found" hides real work.
  const res = await app.fetch(new Request(`https://mauli.test/api/projects/${pid}/detail`), env, { waitUntil() {} });
  assert.equal(res.status, 200, 'a project that exists in D1 must never answer 404 from a cold isolate');
  const body = await res.json();
  const detail = body.detail ?? body.data.detail;
  assert.equal(detail.project.id, pid);
  assert.equal(detail.tasks.length, 2, 'tasks come from the bounded D1 read, not the empty isolate cache');
  assert.equal(detail.summary.totalTasks, 2);
  assert.equal(detail.summary.completedTasks, 1);
  assert.equal(detail.summary.runningTasks, 1);
});
