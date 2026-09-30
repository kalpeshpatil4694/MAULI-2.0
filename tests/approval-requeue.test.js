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
  store.put('projects', { id: 'stuck-failed-chain', name: 'Failed chain', state: 'escalated' });
  store.put('tasks', { id: 'failed-chain-ok', projectId: 'stuck-failed-chain', title: 'Build', state: 'completed' });
  store.put('tasks', { id: 'failed-chain-dead', projectId: 'stuck-failed-chain', title: 'QA', state: 'failed', dependsOn: ['task-that-never-existed'], error: 'upstream gate never ran' });
  store.put('projects', { id: 'stuck-running', name: 'In progress', state: 'active' });
  store.put('tasks', { id: 'stuck-running-task', projectId: 'stuck-running', title: 'Working task', state: 'queued' });

  const dry = recoverStuckProjects({ dryRun: true });
  assert.equal(dry.scanned, 5);
  assert.equal(dry.requeued, 0, 'a dry run never mutates');
  const verdicts = Object.fromEntries(dry.reports.map(r => [r.projectId, r.verdict]));
  assert.equal(verdicts['stuck-no-tasks'], 'no_tasks');
  assert.equal(verdicts['stuck-awaiting'], 'awaiting_approval');
  assert.equal(verdicts['stuck-finished'], 'finalize_completed');
  assert.equal(verdicts['stuck-running'], 'in_progress');
  assert.equal(verdicts['stuck-failed-chain'], 'would_requeue');
  assert.equal(store.get('projects', done.id).state, 'active', 'dry run leaves state untouched');

  const live = recoverStuckProjects();
  assert.equal(store.get('projects', done.id).state, 'completed',
    'a project whose tasks all completed must be finalized');
  assert.equal(store.get('projects', 'stuck-failed-chain').state, 'failed',
    'a project with an unretriable failure is retired as failed, not passed off as completed');
});

test('a running task in one project does not mark every other project in_progress', () => {
  // The live-run check has to be per-project. Globalising it made any single running task
  // excuse every project on the system, so nothing was ever diagnosed or re-queued.
  resetStore();
  store.put('projects', { id: 'live-project', name: 'Running', state: 'active' });
  store.put('tasks', { id: 'live-task', projectId: 'live-project', title: 'Working', state: 'working' });
  store.put('runs', { id: 'live-run', taskId: 'live-task', state: 'running', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });

  store.put('projects', { id: 'other-dead-project', name: 'Dead chain', state: 'active' });
  store.put('tasks', { id: 'other-blocked', projectId: 'other-dead-project', title: 'Blocked step', state: 'blocked', dependsOn: ['other-done'] });
  store.put('tasks', { id: 'other-done', projectId: 'other-dead-project', title: 'Earlier step', state: 'completed' });

  const report = recoverStuckProjects();
  assert.equal(report.reports.find(r => r.projectId === 'live-project').verdict, 'in_progress');
  assert.equal(report.reports.find(r => r.projectId === 'other-dead-project').verdict, 'requeued',
    'an unrelated live run must not hide a dead project');
  assert.equal(store.get('tasks', 'other-blocked').state, 'queued');
});

test('a project with an unretriable failure is retired as failed, not as completed', () => {
  // buildFinalDelivery refuses a delivery that has a failed task, so claiming completion
  // for one is a lie the next scheduler pass contradicts with command.failed. A failed task
  // is retried when its dependencies can still be satisfied; it is retired when they cannot.
  resetStore();
  const projectId = 'completed-must-mean-completed';
  store.put('projects', { id: projectId, name: 'Almost done', state: 'escalated' });
  store.put('tasks', { id: 'almost-a', projectId, title: 'Build', state: 'completed' });
  store.put('tasks', { id: 'almost-b', projectId, title: 'Security gate', state: 'completed' });
  store.put('tasks', { id: 'almost-c', projectId, title: 'Integrity', state: 'failed', dependsOn: ['task-that-never-existed'], error: 'manifest mismatch' });

  const report = recoverStuckProjects();
  const entry = report.reports.find(r => r.projectId === projectId);
  assert.equal(entry.verdict, 'failed_chain');
  assert.equal(store.get('projects', projectId).state, 'failed');
  assert.equal(report.failed, 1);
});

test('a failed task whose dependencies are still satisfiable is retried, not retired', () => {
  resetStore();
  const projectId = 'retriable-failure';
  store.put('projects', { id: projectId, name: 'Retry me', state: 'escalated' });
  store.put('tasks', { id: 'retriable-done', projectId, title: 'Build', state: 'completed' });
  store.put('tasks', { id: 'retriable-failed', projectId, title: 'Test', state: 'failed', dependsOn: ['retriable-done'], error: 'verifier timeout' });

  const report = recoverStuckProjects();
  assert.equal(report.reports.find(r => r.projectId === projectId).verdict, 'requeued');
  assert.equal(store.get('tasks', 'retriable-failed').state, 'queued');
  assert.equal(store.get('projects', projectId).state, 'queued');
});

test('a running task in one project does not mark every other project in_progress', () => {
  // The live-run check has to be per-project. Globalising it made any single running task
  // excuse every project on the system, so nothing was ever diagnosed or re-queued.
  resetStore();
  store.put('projects', { id: 'live-project', name: 'Running', state: 'active' });
  store.put('tasks', { id: 'live-task', projectId: 'live-project', title: 'Working', state: 'working' });
  store.put('runs', { id: 'live-run', taskId: 'live-task', state: 'running', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });

  store.put('projects', { id: 'other-dead-project', name: 'Dead chain', state: 'active' });
  store.put('tasks', { id: 'other-blocked', projectId: 'other-dead-project', title: 'Blocked step', state: 'blocked', dependsOn: ['other-done'] });
  store.put('tasks', { id: 'other-done', projectId: 'other-dead-project', title: 'Earlier step', state: 'completed' });

  const report = recoverStuckProjects();
  assert.equal(report.reports.find(r => r.projectId === 'live-project').verdict, 'in_progress');
  assert.equal(report.reports.find(r => r.projectId === 'other-dead-project').verdict, 'requeued',
    'an unrelated live run must not hide a dead project');
  assert.equal(store.get('tasks', 'other-blocked').state, 'queued');
});

test('recoverStuckProjects re-queues a dead chain and clears it from the project list', () => {
  resetStore();
  const projectId = 'stuck-requeue-project';
  store.put('projects', { id: projectId, name: 'Interrupted build', state: 'active' });
  store.put('tasks', { id: 'requeue-build', projectId, title: 'Build', state: 'completed' });
  store.put('tasks', { id: 'requeue-test', projectId, title: 'Test', state: 'blocked', dependsOn: ['requeue-build'], blockedReason: 'dependencies incomplete' });
  store.put('tasks', { id: 'requeue-qa', projectId, title: 'QA', state: 'blocked', dependsOn: ['requeue-test'], blockedReason: 'dependencies incomplete' });

  const report = recoverStuckProjects();
  const entry = report.reports.find(r => r.projectId === projectId);
  assert.equal(entry.verdict, 'requeued');
  assert.equal(store.get('projects', projectId).state, 'queued');
  assert.equal(store.get('tasks', 'requeue-test').state, 'queued',
    'a blocked task whose inputs are done must be runnable again');

  // Second pass must not keep re-queueing a project that now has runnable work.
  const again = recoverStuckProjects();
  assert.equal(again.reports.find(r => r.projectId === projectId).verdict, 'in_progress');
});
