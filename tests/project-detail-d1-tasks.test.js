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

function fakeD1({ projects = [], tasks = [] } = {}) {
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
  const rowsFor = (type) => (type === 'projects' ? projects : type === 'tasks' ? tasks : []).map((v) => ({ data: JSON.stringify(v) }));
  return {
    DB: {
      prepare(rawSql) {
        let args = [];
        const stmt = {
          bind(...a) { args = a; return stmt; },
          async all() {
            const sql = norm(rawSql);
            if (/^SELECT data FROM entities WHERE type = \?/.test(sql)) {
              const rows = rowsFor(args[0]);
              return { results: rows, meta: { rows_read: rows.length } };
            }
            return { results: [], meta: { rows_read: 0 } };
          },
          async first() { return null; },
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
