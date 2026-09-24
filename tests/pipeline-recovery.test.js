import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { recoverStaleTasks } from '../src/scheduler.js';

function ago(msAgo) { return new Date(Date.now() - msAgo).toISOString(); }

function ageTask(taskId, msAgo) {
  const bucket = store.data.get('tasks');
  const task = bucket.get(taskId);
  bucket.set(taskId, { ...task, updatedAt: ago(msAgo), claimedAt: ago(msAgo) });
}

test('L1 repeated seeding is quiet: no duplicate agent events for a fresh hydrated store', () => {
  store.configure(null);
  store.hydrated = true;
  seedAgents();
  const agents = store.list('agents').length;
  const eventsBefore = store.events.length;

  seedAgents();

  assert.equal(store.list('agents').length, agents, 're-seeding never creates rows');
  assert.equal(
    store.events.length,
    eventsBefore,
    'a no-change seed must not emit agent.updated events (each event was a D1 write that helped exhaust rows_written/day)'
  );
});

test('L1 orphaned working task without a live run is requeued without burning an attempt', () => {
  store.configure(null);
  const task = store.put('tasks', {
    id: 'task-orphan-working', projectId: 'proj-orphan', title: 'Orphaned work',
    state: 'working', attempts: 2, maxAttempts: 3, executor: 'internal.plan'
  });
  ageTask(task.id, 60_000);

  const recovered = recoverStaleTasks();

  assert.ok(recovered.includes(task.id), 'orphaned task is recovered');
  const after = store.get('tasks', task.id);
  assert.equal(after.state, 'queued', 'orphaned working tasks become runnable again');
  assert.equal(after.attempts, 2, 'platform cancellation must not consume a real attempt');
  assert.equal(after.infraRecoveries, 1);
});

test('L1 lease expiry recovers the task but keeps the real attempt budget', () => {
  store.configure(null);
  const task = store.put('tasks', {
    id: 'task-stale-run', projectId: 'proj-stale', title: 'Stale execution',
    state: 'assigned', attempts: 2, maxAttempts: 3, agentId: 'agent-x', assignedAgentId: 'agent-x'
  });
  store.put('runs', {
    id: 'run-stale', taskId: task.id, executor: 'internal.code', state: 'running',
    startedAt: ago(600_000), heartbeatAt: ago(600_000)
  });

  recoverStaleTasks();

  const after = store.get('tasks', task.id);
  assert.equal(store.get('runs', 'run-stale').state, 'failed', 'stale run is closed');
  assert.equal(after.state, 'queued', 'task returns to the queue for the cron scheduler');
  assert.equal(after.attempts, 2, 'a lease expiry is not a failed attempt');
  assert.equal(after.infraRecoveries, 1);
  assert.equal(after.agentId, null, 'released for a fresh claim');
});

test('L1 repeated platform cancellations are still bounded', () => {
  store.configure(null);
  const task = store.put('tasks', {
    id: 'task-cancellation-loop', projectId: 'proj-loop', title: 'Poison task',
    state: 'working', attempts: 1, maxAttempts: 3, infraRecoveries: 8
  });
  ageTask(task.id, 60_000);

  recoverStaleTasks();

  const after = store.get('tasks', task.id);
  assert.equal(after.state, 'failed', 'infra recovery is capped so a poison task cannot churn forever');
  assert.match(String(after.error), /no live execution/);
});

test('L1 assigned task with a valid claim lease and fresh update is left alone', () => {
  store.configure(null);
  const task = store.put('tasks', {
    id: 'task-fresh-claim', projectId: 'proj-claim', title: 'Just claimed',
    state: 'assigned', leaseUntil: new Date(Date.now() + 60_000).toISOString()
  });
  ageTask(task.id, 60_000);

  recoverStaleTasks();

  const after = store.get('tasks', task.id);
  assert.equal(after.state, 'assigned', 'a live claim is not stolen');
  assert.equal(after.infraRecoveries ?? 0, 0);
});
