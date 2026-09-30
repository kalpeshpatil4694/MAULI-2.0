// Regression coverage for the founder approval gate.
//
// Production symptom this prevents: `POST /api/approvals/:id` flipped the approval row to
// 'approved' but left the project parked on 'awaiting_approval' with its tasks in
// 'blocked'/'assigned'. The scheduler skips awaiting_approval projects and skips blocked
// tasks, so the founder approved a command and nothing ever ran. Approving must now open
// both gates: approval row -> 'approved' AND project/tasks -> 'queued'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { queueCommand } from '../src/orchestrator.js';
import { schedulerTick } from '../src/scheduler.js';
import { approveProject } from '../src/governance.js';
import { recoverStuckProjects } from '../src/maintenance.js';

const ENV = { MAULI_FOUNDER_KEY: 'test-founder-key', MAULI_TEST_MODE: true };
const FOUNDER_HEADERS = { 'x-mauli-founder': 'test-founder-key', 'content-type': 'application/json' };

function resetStore() {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;
}

async function postJson(path, body) {
  const app = (await import('../src/index.js')).default;
  const request = new Request(`https://mauli.test${path}`, {
    method: 'POST',
    headers: FOUNDER_HEADERS,
    body: JSON.stringify(body),
  });
  const response = await app.fetch(request, ENV, { waitUntil() {} });
  return { response, payload: await response.json() };
}

// The cron ticks are minutes apart while these loops run instantly, so age the timestamps
// the orphan/lease recovery windows look at.
function passTime(projectId, seconds = 20) {
  const past = new Date(Date.now() - seconds * 1000).toISOString();
  const tasks = store.data.get('tasks');
  if (tasks) for (const [id, t] of tasks) {
    if (t.projectId === projectId && !['completed', 'failed', 'cancelled'].includes(t.state)) {
      tasks.set(id, { ...t, updatedAt: past, claimedAt: past });
    }
  }
  const runs = store.data.get('runs');
  if (runs) for (const [id, r] of runs) {
    if (r.state === 'running') {
      runs.set(id, { ...r, heartbeatAt: past, startedAt: past });
    }
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

test('approving a high-risk command moves the project to queued, not awaiting_approval', async () => {
  resetStore();
  const queued = await queueCommand('Build a simple to-do list web app', {});
  assert.equal(queued.status, 'awaiting_approval', 'a high-risk command must open the approval gate');
  const projectId = queued.project.id;
  const approvalId = queued.approval.id;

  const before = store.get('projects', projectId);
  assert.equal(before.state, 'awaiting_approval');
  assert.ok(store.list('tasks').filter(t => t.projectId === projectId).length > 0);

  const { response, payload } = await postJson(`/api/approvals/${approvalId}`, { approved: true, note: 'ship it' });
  assert.equal(response.status, 200);
  assert.equal(payload.data?.status ?? payload.status, 'approved');

  const after = store.get('projects', projectId);
  assert.equal(store.get('approvals', approvalId).state, 'approved');
  assert.equal(after.state, 'queued',
    'approving must re-queue the project so the scheduler will pick it up');
  assert.equal(payload.data?.project?.state ?? payload.project?.state, 'queued',
    'the response reports the new state so the dashboard can update without a refetch');
});

test('an approved command runs its whole task chain to a final delivery', async () => {
  resetStore();
  const queued = await queueCommand('Build a notes web app', {});
  const projectId = queued.project.id;

  await postJson(`/api/approvals/${queued.approval.id}`, { approved: true });

  const live = store.list('tasks').filter(t => t.projectId === projectId);
  assert.ok(live.length >= 5, `expected a real task chain, got ${live.length}`);
  assert.ok(live.every(t => ['queued', 'blocked', 'assigned'].includes(t.state)),
    'approval must not leave tasks in a non-runnable state forever');

  const finalProject = await driveToCompletion(projectId);
  const finalTasks = store.list('tasks').filter(t => t.projectId === projectId);
  assert.equal(finalProject.state, 'completed',
    `the approved command must complete; task states: ${finalTasks.map(t => t.state).join(', ')}`);
  assert.ok(finalProject.finalDeliveryId, 'a completed command must produce a final delivery artifact');
});

test('approveProject re-activates a blocked gate whose dependencies are all done', () => {
  resetStore();
  const projectId = 'approve-gate-reactivation-project';
  store.put('projects', { id: projectId, name: 'Gate reactivation', state: 'awaiting_approval' });
  store.put('tasks', { id: 'gate-build', projectId, title: 'Build app', state: 'completed', dependsOn: [] });
  store.put('tasks', {
    id: 'gate-test', projectId, title: 'Run tests', state: 'blocked',
    pipelineGate: true, gateType: 'test', dependsOn: ['gate-build'], blockedReason: 'dependencies incomplete',
  });
  const approval = { id: 'approval-gate-reactivation', projectId, risk: 'high', state: 'pending' };

  const result = approveProject(approval, store.get('projects', projectId), 'approved by founder');
  assert.ok(result, 'approveProject must return the updated rows');
  assert.equal(store.get('tasks', 'gate-test').state, 'queued',
    'a gate whose inputs are all completed is a stale blocker, not a real one');
  assert.equal(store.get('tasks', 'gate-test').blockedReason, null);
  assert.equal(store.get('projects', projectId).state, 'queued');
});

test('approveProject is idempotent for a project that is not awaiting approval', () => {
  resetStore();
  const projectId = 'approve-idempotent-project';
  store.put('projects', { id: projectId, name: 'Already queued', state: 'queued' });
  store.put('tasks', { id: 'idempotent-task', projectId, title: 'Do the work', state: 'assigned', agentId: 'agent-old', assignedAgentId: 'agent-old' });
  const approval = { id: 'approval-idempotent', projectId, risk: 'high', state: 'pending' };

  approveProject(approval, store.get('projects', projectId));
  approveProject(approval, store.get('projects', projectId));

  const task = store.get('tasks', 'idempotent-task');
  assert.equal(task.state, 'queued');
  assert.equal(task.agentId, null, 'a stale claim must be released so a live agent can take it');
  assert.equal(store.get('projects', projectId).state, 'queued');
});

test('recoverStuckProjects reports a verdict for every non-terminal project', () => {
  resetStore();
  const noTasks = store.put('projects', { id: 'stuck-no-tasks', name: 'No tasks', state: 'active' });
  store.put('projects', { id: 'stuck-awaiting', name: 'Awaiting founder', state: 'awaiting_approval' });
  store.put('tasks', { id: 'stuck-awaiting-task', projectId: 'stuck-awaiting', title: 'Waiting', state: 'blocked' });
  store.put('approvals', { id: 'approval-stuck-awaiting', projectId: 'stuck-awaiting', state: 'pending', risk: 'high' });
  const done = store.put('projects', { id: 'stuck-finished', name: 'All done', state: 'active' });
  store.put('tasks', { id: 'stuck-finished-task', projectId: done.id, title: 'Only task', state: 'completed' });
  store.put('projects', { id: 'stuck-running', name: 'In progress', state: 'active' });
  store.put('tasks', { id: 'stuck-running-task', projectId: 'stuck-running', title: 'Working task', state: 'queued' });

  const dry = recoverStuckProjects({ dryRun: true });
  assert.equal(dry.scanned, 4);
  assert.equal(dry.requeued, 0, 'a dry run never mutates');
  const verdicts = Object.fromEntries(dry.reports.map(r => [r.projectId, r.verdict]));
  assert.equal(verdicts['stuck-no-tasks'], 'no_tasks');
  assert.equal(verdicts['stuck-awaiting'], 'awaiting_approval');
  assert.equal(verdicts['stuck-finished'], 'finalize_completed');
  assert.equal(verdicts['stuck-running'], 'in_progress');
  assert.equal(store.get('projects', done.id).state, 'active', 'dry run leaves state untouched');

  const live = recoverStuckProjects();
  assert.equal(store.get('projects', done.id).state, 'completed',
    'a project whose tasks are all terminal must be finalized');
});

test('recoverStuckProjects re-queues a dead chain and clears it from the project list', () => {
  resetStore();
  const projectId = 'stuck-requeue-project';
  store.put('projects', { id: projectId, name: 'Interrupted build', state: 'active' });
  store.put('tasks', { id: 'requeue-build', projectId, title: 'Build', state: 'completed' });
  store.put('tasks', { id: 'requeue-test', projectId, title: 'Test', state: 'blocked', dependsOn: ['requeue-build'], blockedReason: 'dependencies incomplete' });
  store.put('tasks', { id: 'requeue-qa', projectId, title: 'QA', state: 'failed', dependsOn: ['requeue-test'], error: 'verifier timeout' });

  const report = recoverStuckProjects();
  const entry = report.reports.find(r => r.projectId === projectId);
  assert.equal(entry.verdict, 'requeued');
  assert.equal(store.get('projects', projectId).state, 'queued');
  assert.equal(store.get('tasks', 'requeue-qa').state, 'queued',
    'a failed task whose inputs are done must be retryable again');

  // Second pass must not keep re-queueing a project that now has runnable work.
  const again = recoverStuckProjects();
  assert.equal(again.reports.find(r => r.projectId === projectId).verdict, 'in_progress');
});
