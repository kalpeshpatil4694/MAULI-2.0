import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { claimNextTask, schedulerTick } from '../src/scheduler.js';
import { queueCommand, specForCommand } from '../src/orchestrator.js';

function resetStore() {
  store.configure(null);
  store.hydrated = true;
  store.data.clear();
  store.events.length = 0;
  seedAgents();
}

// assignTask() marks the agent busy for the task it assigns, and every gate/generation task
// is created pre-assigned. The claim guard used to demand an agent in 'available'/
// 'registered', so a task arriving at the scheduler already 'assigned' found its only
// capable agent recorded as busy with that very task and returned null — permanently. The
// blocked-retry loop re-assigned it every tick, re-creating the same busy agent, so the
// pipeline never left its first gate.
test('a pre-assigned task is claimable when its agent is busy with that same task', () => {
  resetStore();
  store.put('projects', { id: 'proj-claim-self', state: 'active', founderCommand: 'x' });
  const task = store.put('tasks', {
    id: 'task-self-assigned', projectId: 'proj-claim-self', title: 'Pipeline gate: build',
    state: 'assigned', pipelineGate: true, gateType: 'build',
    requiredCapabilities: ['testing', 'verification'], toolNames: [], requiredTools: [],
    assignedAgentId: 'agent-builtin-qa-agent', agentId: 'agent-builtin-qa-agent'
  });
  // Exactly what assignTask() leaves behind: the agent is busy with the task itself.
  store.put('agents', {
    ...store.get('agents', 'agent-builtin-qa-agent'),
    state: 'assigned', currentTaskId: task.id
  });

  const claimed = claimNextTask(task.id);

  assert.ok(claimed, 'the scheduler must be able to claim its own pre-assigned task');
  assert.equal(claimed.state, 'assigned');
  assert.equal(claimed.agentId, 'agent-builtin-qa-agent');
});

test('an agent still bound to a dead task is released before being re-used', () => {
  resetStore();
  store.put('projects', { id: 'proj-stale-owner', state: 'active', founderCommand: 'x' });
  store.put('tasks', {
    id: 'task-dead', projectId: 'proj-stale-owner', title: 'Dead run',
    state: 'working', assignedAgentId: 'agent-builtin-qa-agent', agentId: 'agent-builtin-qa-agent'
  });
  store.put('agents', {
    ...store.get('agents', 'agent-builtin-qa-agent'),
    state: 'working', currentTaskId: 'task-dead'
  });
  const task = store.put('tasks', {
    id: 'task-new-owner', projectId: 'proj-stale-owner', title: 'Next gate',
    state: 'assigned', requiredCapabilities: ['testing', 'verification'],
    assignedAgentId: 'agent-builtin-qa-agent', agentId: 'agent-builtin-qa-agent'
  });

  const claimed = claimNextTask(task.id);

  assert.ok(claimed, 'a recoverable agent must still be usable');
  assert.equal(store.get('agents', 'agent-builtin-qa-agent').currentTaskId, task.id,
    'the dead task must not keep the agent booked');
});

// ensureExecutablePlan() decided "is this software?" from a closed keyword list. A founder
// command that plainly describes a full-stack product without using one of those words was
// planned instead of built: the project received a single planning task, no frontend,
// backend, database, security or testing work was ever scheduled, and every delivery gate
// failed for want of a generated artifact.
test('a full-stack command needs no magic word to be built', () => {
  const structured = specForCommand(
    'Design a customer support ticket management system with secure authentication, real-time updates, and data persistence in D1',
    'web'
  );
  resetStore();

  return queueCommand(
    'Design a customer support ticket management system with secure authentication, real-time updates, and data persistence in D1',
    {}
  ).then(queued => {
    const tasks = store.list('tasks').filter(t => t.projectId === queued.project.id);
    const executors = new Set(tasks.map(t => t.executor));
    assert.ok(tasks.length >= 6, `expected a real task set, got ${tasks.length} task(s)`);
    assert.ok(executors.has('internal.code'), 'the project must schedule code generation, not only a plan');
    for (const capability of ['backend', 'database', 'frontend', 'security']) {
      assert.ok(
        tasks.some(t => (t.requiredCapabilities ?? []).includes(capability)),
        `${capability} work must be scheduled for a full-stack command`
      );
    }
    assert.ok(structured.architecture?.backend === true, 'the architecture really does owe a backend');
  });
});

// End-to-end guard for the livelock: with the claim guard in place the very first pipeline
// gate was 'not-runnable' on every tick and the project stayed 'active' forever.
test('a queued project advances past every pipeline gate', async () => {
  resetStore();
  const queued = await queueCommand(
    'Design a customer support ticket management system with secure authentication, real-time updates, and data persistence in D1',
    {}
  );
  if (queued.status === 'awaiting_approval') {
    const { approveProject } = await import('../src/governance.js');
    await approveProject(queued.approval.id, { approved: true }, {});
  }
  const projectId = queued.project.id;

  for (let i = 0; i < 20; i++) await schedulerTick({}, { projectId, budgetMs: 20_000 });

  const tasks = store.list('tasks').filter(t => t.projectId === projectId);
  const stuck = tasks.filter(t => t.state === 'assigned' || t.state === 'working');
  assert.equal(stuck.length, 0, `no task may stay claimed with nothing running: ${stuck.map(t => t.title).join(', ')}`);

  const gates = tasks.filter(t => t.pipelineGate);
  assert.ok(gates.length >= 8, 'the full gate chain must exist');
  const unfinishedGates = gates.filter(t => !['completed', 'failed', 'cancelled'].includes(t.state));
  assert.equal(unfinishedGates.length, 0,
    `every gate must reach a terminal state, still open: ${unfinishedGates.map(t => t.gateType).join(', ')}`);

  // The project must not read as "still building" forever once nothing is left to run.
  const project = store.get('projects', projectId);
  assert.notEqual(project.state, 'active',
    'a project whose tasks are all terminal must not stay active — that is the frozen-progress symptom');
});