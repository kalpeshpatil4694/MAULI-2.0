// End-to-end proof of the founder-visible promise: a queued command actually executes its
// task chain to a final delivery, and the dashboard state/progress reflect the real work.
// Runs against the in-memory path (no D1, no AI) exactly like the offline template fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { queueCommand } from '../src/orchestrator.js';
import { schedulerTick } from '../src/scheduler.js';
import { getProjectProgress } from '../src/live-monitor.js';

// A real cron tick is minutes apart, which is what lets orphan recovery reclaim an assigned
// task whose agent was pinned. This loop runs instantly, so simulate the elapsed time
// between ticks; otherwise the 15s/90s lease grace windows never open and the chain looks
// stuck when it is only waiting for the clock.
async function passTime(projectId, seconds = 20) {
  const past = new Date(Date.now() - seconds * 1000).toISOString();
  const tasks = store.data.get('tasks');
  if (tasks) for (const [id, t] of tasks) {
    if (t.projectId === projectId && !['completed', 'failed', 'cancelled'].includes(t.state)) tasks.set(id, { ...t, updatedAt: past, claimedAt: past });
  }
  const runs = store.data.get('runs');
  if (runs) for (const [id, r] of runs) {
    if (r.state === 'running') runs.set(id, { ...r, heartbeatAt: new Date(Date.now() - 120 * 1000).toISOString(), startedAt: new Date(Date.now() - 120 * 1000).toISOString() });
  }
}

async function driveToCompletion(projectId, maxTicks = 80) {
  for (let i = 0; i < maxTicks; i++) {
    await schedulerTick({}, { projectId, budgetMs: 0 });
    const project = store.get('projects', projectId);
    if (project && ['completed', 'failed', 'cancelled'].includes(project.state)) return project;
    passTime(projectId);
  }
  return store.get('projects', projectId);
}

test('a queued founder command runs to a completed final delivery', async () => {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;

  const queued = await queueCommand('Build a simple to-do list web app', {});
  const projectId = queued.project?.id;
  assert.ok(projectId, 'queueCommand must return a project id');
  assert.ok(['queued', 'awaiting_approval'].includes(queued.status), `unexpected queue status ${queued.status}`);

  // A high-risk command opens an approval gate; the scheduler legitimately waits for it, so
  // approve it the way the founder (or the approval endpoint) would.
  if (queued.status === 'awaiting_approval') {
    const approval = store.get('approvals', queued.approval?.id);
    if (approval) store.put('approvals', { ...approval, state: 'approved', decidedAt: new Date().toISOString(), id: approval.id });
    const project = store.get('projects', projectId);
    if (project) store.put('projects', { ...project, state: 'queued', id: project.id });
    for (const t of store.list('tasks').filter((t) => t.projectId === projectId && !['completed', 'failed', 'cancelled'].includes(t.state))) {
      store.put('tasks', { ...t, state: 'queued', id: t.id });
    }
  }

  const tasks = store.list('tasks').filter((t) => t.projectId === projectId);
  assert.ok(tasks.length >= 5, `a command must decompose into a real task chain (got ${tasks.length})`);

  const finalProject = await driveToCompletion(projectId);
  const finalTasks = store.list('tasks').filter((t) => t.projectId === projectId);
  const states = finalTasks.map((t) => t.state);
  assert.equal(finalProject.state, 'completed',
    `the command must complete; states were ${states.join(', ')}`);
  assert.ok(finalTasks.every((t) => t.state === 'completed'), `every task must finish: ${states.join(', ')}`);
  assert.ok(finalProject.finalDeliveryId, 'completion must produce a final delivery artifact');

  // The dashboard must reflect the same real state — not a timer, not a fabricated count.
  const progress = getProjectProgress(projectId);
  assert.equal(progress.tasks.total, finalTasks.length);
  assert.equal(progress.tasks.completed, finalTasks.length);
  assert.equal(progress.tasks.running, 0);
  assert.equal(progress.status, 'completed');
});

test('the live counters move when a command runs', async () => {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  store.hydrated = true;

  const before = store.list('tasks').length;
  const queued = await queueCommand('Build a notes web app', {});
  const projectId = queued.project.id;
  const afterQueue = store.list('tasks').length;
  assert.ok(afterQueue > before, 'queuing a command must increase the real task count');

  if (queued.status === 'awaiting_approval' && queued.approval?.id) {
    const approval = store.get('approvals', queued.approval.id);
    if (approval) store.put('approvals', { ...approval, state: 'approved', id: approval.id });
    const project = store.get('projects', projectId);
    if (project) store.put('projects', { ...project, state: 'queued', id: project.id });
    for (const t of store.list('tasks').filter((t) => t.projectId === projectId && !['completed', 'failed', 'cancelled'].includes(t.state))) {
      store.put('tasks', { ...t, state: 'queued', id: t.id });
    }
  }

  const app = (await import('../src/index.js')).default;
  const beforeState = await (await app.fetch(new Request('https://mauli.test/api/state'), {}, { waitUntil() {} })).json();
  await driveToCompletion(projectId);
  const afterState = await (await app.fetch(new Request('https://mauli.test/api/state'), {}, { waitUntil() {} })).json();

  const beforeTotals = beforeState.data.summary.totals ?? beforeState.data.summary;
  const afterTotals = afterState.data.summary.totals ?? afterState.data.summary;
  assert.ok(
    Number(afterTotals.tasks) > Number(beforeTotals.tasks) ||
    Number(afterTotals.projects) > Number(beforeTotals.projects),
    `counters must move after a command: before=${JSON.stringify(beforeTotals)} after=${JSON.stringify(afterTotals)}`
  );
});
