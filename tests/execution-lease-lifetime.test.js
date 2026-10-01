// A run whose terminal write never landed must still be reclaimable.
//
// Production wedged a 13-task project at 0/13 with a single execution still in state
// 'running'. Every recovery path in MAULI asks the same question — "is this run stale?" —
// and stale() was a pure function of heartbeatAt. So one execution that kept heartbeating
// was simultaneously invisible to claimNextTask (it saw a live run and refused), to the
// orphan sweep (the task "had a live run"), and to recoverStuckProjects (the project was
// "in_progress", so nothing was requeued). The project stayed 'active' with no runnable
// work and no path left to recover it.
//
// The fix bounds the lease by an absolute lifetime measured from the immutable startedAt,
// so reclaimability cannot depend on a heartbeat that a dead execution can keep refreshing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_RUN_LIFETIME_MS, runOverLifetime, heartbeatExecution, isStaleRun } from '../src/execution.js';
import { stale as staleRun, recoverStaleTasks } from '../src/scheduler.js';
import { store } from '../src/store.js';
import { registerAgent } from '../src/agents.js';
import { createProject, addTaskToProject } from '../src/projects.js';

const iso = (ms) => new Date(ms).toISOString();

test('a run past its absolute lifetime is reclaimable even with a fresh heartbeat', () => {
  const startedAt = Date.now() - (MAX_RUN_LIFETIME_MS + 60_000);
  const run = {
    id: 'run_old',
    taskId: 'task_old',
    state: 'running',
    startedAt: iso(startedAt),
    // Heartbeated one second ago: under the old rule this run was "live" forever.
    heartbeatAt: iso(Date.now() - 1_000),
  };
  assert.equal(runOverLifetime(run), true, 'over its absolute lifetime');
  assert.equal(isStaleRun(run), true, 'execution.js treats it as stale');
  assert.equal(staleRun(run), true, 'the scheduler treats it as stale');
});

test('a healthy run is not stale and keeps its lease', () => {
  const run = {
    id: 'run_fresh',
    taskId: 'task_fresh',
    state: 'running',
    startedAt: iso(Date.now() - 5_000),
    heartbeatAt: iso(Date.now() - 1_000),
  };
  assert.equal(runOverLifetime(run), false);
  assert.equal(isStaleRun(run), false);
  assert.equal(staleRun(run), false);
});

test('a slow but living execution is not killed by the lifetime bound', () => {
  // Six minutes old — well past the 90s lease and inside the absolute lifetime — but still
  // heartbeating every 60s, so it is genuinely working and must not be reclaimed.
  const run = {
    id: 'run_slow',
    taskId: 'task_slow',
    state: 'running',
    startedAt: iso(Date.now() - 360_000),
    heartbeatAt: iso(Date.now() - 30_000),
  };
  assert.equal(runOverLifetime(run), false, 'still inside its absolute lifetime');
  assert.equal(staleRun(run), false, 'a slow but heartbeating execution is left alone');
  assert.equal(isStaleRun(run), false);

  // The ordinary lease rule is untouched: an execution that simply stopped beating inside
  // its lifetime is still reclaimed once its heartbeat ages out.
  const stopped = { ...run, heartbeatAt: iso(Date.now() - 200_000) };
  assert.equal(runOverLifetime(stopped), false);
  assert.equal(staleRun(stopped), true, 'a silent execution is reclaimed by the lease');
});

test('the heartbeat stops renewing the lease once the lifetime is spent', () => {
  const dead = {
    id: 'run_immortal',
    taskId: 'task_immortal',
    state: 'running',
    startedAt: iso(Date.now() - (MAX_RUN_LIFETIME_MS + 1_000)),
    heartbeatAt: iso(Date.now() - 1_000),
    updatedAt: iso(Date.now() - 1_000),
  };
  store.put('runs', dead);
  const before = store.get('runs', 'run_immortal').heartbeatAt;
  assert.equal(heartbeatExecution('run_immortal'), false, 'a dead run cannot renew its lease');
  assert.equal(
    store.get('runs', 'run_immortal').heartbeatAt,
    before,
    'and the refused heartbeat wrote nothing'
  );
  store.data.get('runs')?.delete('run_immortal');
});

test('the orphan sweep reclaims the task held hostage by an immortal run', async () => {
  // This is the production shape: a task left 'assigned', its execution 'running' with a
  // fresh heartbeat and a long-dead startedAt. Before the fix the sweep skipped it as
  // "has a live run" and the project never converged.
  const suffix = Date.now();
  const agent = registerAgent({
    id: `agent_lease_${suffix}`,
    name: 'Lease Test Agent',
    state: 'available',
    capabilities: ['research'],
    tools: [],
    metadata: {},
  });
  const project = createProject({ name: 'Lease lifetime', objective: 'Recover a dead execution' });
  const task = addTaskToProject(project.id, {
    title: 'Research and validate requirements',
    requiredCapabilities: ['research'],
  });
  const taskId = task.id;

  const startedAt = Date.now() - (MAX_RUN_LIFETIME_MS + 120_000);
  store.put('runs', {
    id: `run_lease_${suffix}`,
    taskId,
    state: 'running',
    startedAt: iso(startedAt),
    heartbeatAt: iso(Date.now() - 2_000),
    attempt: 1,
    agentId: agent.id,
  });
  store.put('tasks', { ...store.get('tasks', taskId), state: 'assigned', agentId: agent.id, assignedAgentId: agent.id, leaseUntil: iso(Date.now() - 60_000) });

  const recovered = await recoverStaleTasks();

  assert.ok(recovered.includes(taskId), 'the orphan sweep reclaims the task');
  const after = store.get('tasks', taskId);
  assert.equal(after.state, 'queued', 'the task returns to the queue instead of wedging');
  assert.equal(after.agentId, null, 'and its agent is released for re-claim');

  store.data.get('runs')?.delete(`run_lease_${suffix}`);
  store.data.get('tasks')?.delete(taskId);
  store.data.get('projects')?.delete(project.id);
  store.data.get('agents')?.delete(agent.id);
});
