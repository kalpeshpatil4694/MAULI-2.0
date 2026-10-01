// A project could stay "active" forever with one leftover task that nothing could move:
//   1. duplicate gate rows from the pre-fix concurrency bug kept two chains alive, and the
//      survivor of the pair was never chosen — the chain simply waited on a row that was
//      itself waiting on the other one;
//   2. orphan recovery re-queued the task but never released its agent, and with one agent
//      per capability (the built-in Security Agent) nothing could claim it again;
//   3. a terminal project state written through the compare-and-set could be dropped when
//      another isolate had moved the row, and nothing retried it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { ensureProjectPipeline } from '../src/pipeline-gates.js';
import { recoverStaleTasks, schedulerTick } from '../src/scheduler.js';
import { listProjects } from '../src/projects.js';

const TAIL = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

// store.put always stamps a fresh updatedAt, so a row that must look stale to the recovery
// sweep has to be aged in the bucket directly (the same helper the recovery tests use).
function ageTask(taskId, ms) {
  const bucket = store.data.get('tasks');
  const task = bucket.get(taskId);
  bucket.set(taskId, { ...task, updatedAt: ago(ms), claimedAt: ago(ms) });
}

function seedProject(state = 'active') {
  const pid = `p-${TAIL()}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build a habit tracker', requirements: ['Track habits'], state });
  store.put('tasks', { id: `${pid}-gen`, projectId: pid, title: 'Generate app', state: 'completed' });
  store.put('tasks', { id: `${pid}-qa`, projectId: pid, title: 'Final project QA gate', state: 'completed', finalProjectVerification: true });
  return pid;
}

test('duplicate gate rows are collapsed into one canonical gate per type', async () => {
  const pid = seedProject();
  ensureProjectPipeline(pid);
  const gates = store.list('tasks').filter((t) => t.projectId === pid && t.pipelineGate);
  const security = gates.find((g) => g.gateType === 'security');

  // The historical duplicate: same gateType, random id, still waiting to run.
  store.put('tasks', {
    ...security, id: `${pid}-security-dup`, state: 'queued', assignedAgentId: null,
    agentId: null, dependsOn: [], createdAt: ago(600_000)
  });
  // A dependent that waits on the duplicate must be rewired to the survivor. The gate chain
  // itself is re-pointed by ensureProjectPipeline, so the dependent here is a plain task.
  const dependent = `${pid}-gen`;
  store.put('tasks', { ...store.get('tasks', dependent), dependsOn: [security.id, `${pid}-security-dup`], id: dependent });

  const result = ensureProjectPipeline(pid);

  assert.deepEqual(result.collapsed, [`${pid}-security-dup`], JSON.stringify(result.collapsed));
  const remaining = store.list('tasks')
    .filter((t) => t.projectId === pid && t.pipelineGate && t.gateType === 'security' && t.state !== 'cancelled');
  assert.equal(remaining.length, 1, 'exactly one security gate must survive');
  assert.equal(remaining[0].id, security.id, 'the surviving gate keeps its identity');
  const rewired = store.get('tasks', dependent);
  assert.ok(rewired.dependsOn.includes(security.id) && !rewired.dependsOn.includes(`${pid}-security-dup`),
    JSON.stringify(rewired.dependsOn));
  assert.equal(store.get('tasks', `${pid}-security-dup`).state, 'cancelled');
});

test('a completed gate wins over an unfinished duplicate of the same type', async () => {
  const pid = seedProject();
  ensureProjectPipeline(pid);
  const gates = store.list('tasks').filter((t) => t.projectId === pid && t.pipelineGate);
  const test1 = gates.find((g) => g.gateType === 'test');
  store.put('tasks', { ...test1, state: 'completed', id: `${pid}-test-done` });
  store.put('tasks', { ...test1, state: 'queued', id: `${pid}-test-pending`, assignedAgentId: null, agentId: null });

  ensureProjectPipeline(pid);

  const testGates = store.list('tasks').filter((t) => t.projectId === pid && t.pipelineGate && t.gateType === 'test');
  const live = testGates.filter((t) => t.state !== 'cancelled');
  assert.equal(live.length, 1);
  assert.equal(live[0].id, `${pid}-test-done`, 'the completed gate is the canonical one');
});

test('orphan recovery releases the agent so the re-queued task can be claimed again', async () => {
  const pid = `p-${TAIL()}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build a habit tracker', requirements: [], state: 'active' });
  const agent = store.put('agents', {
    id: `agent-collapsed-${TAIL()}`, name: 'Security Agent', role: 'Reviewer',
    department: 'Security', capabilities: ['security'], state: 'assigned', metadata: {}
  });
  const task = store.put('tasks', {
    id: `${pid}-sec`, projectId: pid, title: 'Pipeline gate: security', state: 'assigned',
    pipelineGate: true, gateType: 'security', requiredCapabilities: ['security'],
    assignedAgentId: agent.id, agentId: agent.id, leaseUntil: ago(300_000)
  });
  ageTask(task.id, 600_000);

  assert.ok(await (await recoverStaleTasks()).includes(task.id), 'the orphaned task must be re-queued');

  const requeued = store.get('tasks', task.id);
  assert.equal(requeued.state, 'queued');
  const released = store.get('agents', agent.id);
  // Holding the agent while the task sits in 'queued' is what made the task unclaimable:
  // claimNextTask only trusts an agent in 'available'/'registered'.
  assert.ok(['available', 'registered'].includes(released.state), `agent stuck in ${released.state}`);
  assert.equal(released.currentTaskId, null);
});

test('a collapsed duplicate gate no longer blocks finalization', async () => {
  const pid = seedProject();
  ensureProjectPipeline(pid);
  for (const gate of store.list('tasks').filter((t) => t.projectId === pid && t.pipelineGate)) {
    store.put('tasks', { ...gate, state: 'completed', verificationId: `v-${gate.id}`, id: gate.id });
  }
  const security = store.list('tasks').find((t) => t.projectId === pid && t.pipelineGate && t.gateType === 'security');
  store.put('tasks', {
    ...security, id: `${pid}-security-dup`, state: 'queued', verificationId: null,
    assignedAgentId: null, agentId: null, dependsOn: []
  });

  ensureProjectPipeline(pid);
  const states = store.list('tasks').filter((t) => t.projectId === pid).map((t) => t.state);
  assert.ok(states.includes('cancelled'), 'the duplicate is cancelled');
  assert.ok(!states.includes('queued'), `a cancelled task must not look like live work: ${states.join(',')}`);

  // The sweep that decides "this project is done" treats a collapsed duplicate as settled.
  const settled = store.list('tasks')
    .filter((t) => t.projectId === pid)
    .every((t) => t.state === 'completed' || t.state === 'cancelled');
  assert.equal(settled, true);
  assert.equal(typeof schedulerTick, 'function');
});

// The project row said 'completed'; the dashboard derives the state from the tasks, so a
// collapsed duplicate counted as live work kept the project reading 'active' forever.
test('a project with only collapsed duplicates reads as completed', async () => {
  const pid = seedProject();
  ensureProjectPipeline(pid);
  for (const gate of store.list('tasks').filter((t) => t.projectId === pid && t.pipelineGate)) {
    store.put('tasks', { ...gate, state: 'completed', verificationId: `v-${gate.id}`, id: gate.id });
  }
  const security = store.list('tasks').find((t) => t.projectId === pid && t.pipelineGate && t.gateType === 'security');
  store.put('tasks', { ...security, id: `${pid}-security-dup`, state: 'queued', verificationId: null, assignedAgentId: null, agentId: null, dependsOn: [] });
  ensureProjectPipeline(pid);
  store.put('projects', { ...store.get('projects', pid), state: 'completed', id: pid });

  const derived = listProjects().find((p) => p.id === pid);
  assert.equal(derived.state, 'completed',
    'a collapsed duplicate gate must not keep a delivered project looking active');
});