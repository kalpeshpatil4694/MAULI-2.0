// Regression coverage for the two defects behind the "Call recording application" report:
// a project stalled 21 hours behind three blocked pipeline gates, and a project card that
// reported 2719h estimated / 679h remaining for a project finishing in minutes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents, listAgents, scoreAgent } from '../src/agents.js';
import { assignTask, completeTask, createTask } from '../src/tasks.js';
import { recoverStaleTasks } from '../src/scheduler.js';
import { GATES, CAP, ensureProjectPipeline } from '../src/pipeline-gates.js';
import {
  estimateTaskDurationMs,
  enrichTaskTiming,
  enrichProjectTiming,
  estimateProjectDuration,
  MAX_TASK_ESTIMATE_MS,
  MAX_PROJECT_ESTIMATE_MS,
} from '../src/time-tracking.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test('every pipeline gate capability set is held by at least one built-in agent', () => {
  seedAgents();
  const agents = listAgents();
  const unsatisfiable = GATES.filter(
    (type) => !agents.some((a) => (CAP[type] ?? []).every((c) => (a.capabilities ?? []).includes(c)))
  );
  assert.deepEqual(unsatisfiable, [],
    `these gates demand capabilities no single agent holds: ${unsatisfiable.join(', ')}`);
});

test('a task whose capability set no agent fully holds still gets assigned', () => {
  seedAgents();
  // Exactly the combination the old security gate demanded: the Security Agent has
  // `security` only and the QA Agent has `verification` only, so strict matching scored
  // every agent -Infinity and the task blocked permanently with all 18 agents idle.
  const task = createTask({
    projectId: `p-${TAIL()}`,
    title: 'Pipeline gate: security',
    requiredCapabilities: ['security', 'verification'],
    executor: 'internal.pipeline-gate',
  });
  const assigned = assignTask(task.id);
  assert.equal(assigned.state, 'assigned',
    'an unassignable capability combination must not park the task forever');
  assert.ok(assigned.assignedAgentId, 'a partial-match agent must be selected');
  assert.equal(assigned.blockedReason ?? null, null);
});

test('partial matching stays opt-in and never accepts zero overlap', () => {
  seedAgents();
  const agents = listAgents();
  const holder = agents.find((a) => (a.capabilities ?? []).includes('security'));
  assert.ok(holder, 'a security-capable agent must exist');

  assert.equal(scoreAgent(holder, ['security', 'verification']), -Infinity,
    'strict matching (the default) still rejects a partial hold');
  assert.ok(Number.isFinite(scoreAgent(holder, ['security'])),
    'strict matching succeeds when the agent does hold everything');
  assert.ok(Number.isFinite(scoreAgent(holder, ['security', 'verification'], { allowPartialCapabilities: true })),
    'the caller may opt into a partial hold');

  const stranger = agents.find((a) => !(a.capabilities ?? []).includes('security')
    && !(a.capabilities ?? []).includes('verification'));
  assert.ok(stranger, 'an agent holding neither capability must exist for this check');
  assert.equal(scoreAgent(stranger, ['security', 'verification'], { allowPartialCapabilities: true }), -Infinity,
    'zero overlap is still rejected even when partial matching is allowed');
});

test('a blocked task with complete dependencies is retried by the scheduler', () => {
  seedAgents();
  const suffix = TAIL();
  const pid = `p-${suffix}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build an app', state: 'active', requirements: ['x'] });
  store.put('tasks', { id: `dep-${suffix}`, projectId: pid, title: 'Dependency', state: 'completed', dependsOn: [], requiredCapabilities: ['research'] });
  store.put('tasks', {
    id: `gate-${suffix}`, projectId: pid, title: 'Pipeline gate: security',
    state: 'blocked', blockedReason: 'No capable available agent',
    dependsOn: [`dep-${suffix}`], requiredCapabilities: ['security', 'verification'],
    executor: 'internal.pipeline-gate',
  });

  const recovered = recoverStaleTasks();
  const gate = store.get('tasks', `gate-${suffix}`);

  assert.notEqual(gate.state, 'blocked', 'a blocked task whose dependencies are complete must be reconsidered');
  assert.ok(recovered.includes(`gate-${suffix}`), 'the recovery pass must report it');
  assert.ok(['assigned', 'queued'].includes(gate.state));
});

test('a blocked task waiting on an incomplete dependency is left alone', () => {
  seedAgents();
  const suffix = TAIL();
  const pid = `p-${suffix}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build an app', state: 'active', requirements: ['x'] });
  store.put('tasks', { id: `dep-${suffix}`, projectId: pid, title: 'Dependency', state: 'queued', dependsOn: [], requiredCapabilities: ['research'] });
  store.put('tasks', {
    id: `gate-${suffix}`, projectId: pid, title: 'Pipeline gate: qa',
    state: 'blocked', blockedReason: 'Dependencies incomplete',
    dependsOn: [`dep-${suffix}`], requiredCapabilities: ['testing', 'verification'],
    executor: 'internal.pipeline-gate',
  });

  recoverStaleTasks();

  assert.equal(store.get('tasks', `gate-${suffix}`).state, 'blocked',
    'a task with genuinely incomplete dependencies must stay blocked');
});

test('a poisoned stored estimate is clamped instead of shown as 679h', () => {
  const enriched = enrichTaskTiming({
    id: 'poisoned-task', state: 'blocked',
    estimatedDurationMs: 2446835243,   // 679h 40m 35s as seen on the live project
    requiredCapabilities: ['security', 'verification'],
  });
  assert.ok(enriched.estimatedDurationMs <= MAX_TASK_ESTIMATE_MS,
    `estimate must stay within ${MAX_TASK_ESTIMATE_MS}ms, got ${enriched.estimatedDurationMs}`);
  assert.ok(!enriched.estimatedDurationFormatted.includes('h'),
    `a single task must never be estimated in hours: ${enriched.estimatedDurationFormatted}`);
});

test('a project estimate built from poisoned tasks stays human-sized', () => {
  const poisoned = (id, state) => ({
    id, state, estimatedDurationMs: 2446835243,
    requiredCapabilities: state === 'completed' ? ['testing'] : ['security'],
  });
  const project = { id: 'p-poisoned', state: 'active', createdAt: new Date().toISOString() };
  const timing = enrichProjectTiming(project, [
    poisoned('t1', 'completed'), poisoned('t2', 'completed'),
    poisoned('t3', 'blocked'), poisoned('t4', 'blocked'),
  ]);
  assert.ok(timing.estimatedDurationMs <= MAX_PROJECT_ESTIMATE_MS,
    `project estimate must stay within 24h, got ${timing.estimatedDurationMs}`);
  assert.ok(timing.remainingMs <= MAX_PROJECT_ESTIMATE_MS);
  assert.ok(!/\d{2,}h/.test(timing.estimatedDurationFormatted),
    `project card must not report thousands of hours: ${timing.estimatedDurationFormatted}`);
  assert.ok(!/\d{2,}h/.test(timing.remainingFormatted),
    `remaining must not report hundreds of hours: ${timing.remainingFormatted}`);
});

test('the estimator ignores recorded durations that are implausible', () => {
  const suffix = TAIL();
  for (const n of ['a', 'b']) {
    store.put('tasks', {
      id: `absurd-${n}-${suffix}`, projectId: 'p-absurd', title: `Absurd ${n}`,
      state: 'completed', executor: 'internal.code', requiredCapabilities: ['backend'],
      actualDurationMs: 2446835243,
    });
  }
  const estimate = estimateTaskDurationMs({ requiredCapabilities: ['backend'], executor: 'internal.code' });
  assert.ok(estimate <= MAX_TASK_ESTIMATE_MS, 'a 679h sample must not drive the next estimate');
  assert.ok(estimate >= 30000, 'estimates still keep their floor');
  assert.ok(estimateProjectDuration([{ estimatedDurationMs: 2446835243 }]) <= MAX_PROJECT_ESTIMATE_MS);
});

test('the detail pipeline creates gates the roster can actually staff', () => {
  seedAgents();
  const suffix = TAIL();
  const pid = `p-${suffix}`;
  store.put('projects', { id: pid, name: 'Pipeline', objective: 'Build a call recorder', requirements: ['x'], state: 'active' });
  store.put('tasks', { id: `${pid}-gen`, projectId: pid, title: 'Generate', state: 'completed', finalProjectVerification: false });
  store.put('tasks', { id: `${pid}-qa`, projectId: pid, title: 'Final QA', state: 'queued', finalProjectVerification: true });

  const result = ensureProjectPipeline(pid);
  assert.ok(result && result.gates.length >= GATES.length, 'all gates must be created');
  assert.deepEqual(result.gates.map((g) => g.type).sort(),
    ['build', 'integrity', 'qa', 'requirements', 'security', 'test'].sort());

  const unstaffable = new Set();
  // Drive the chain the way the scheduler does: attempt every gate, complete what gets
  // assigned, and come back next tick for anything still waiting on a dependency.
  let progress = true;
  let rounds = 0;
  while (progress && rounds < 10) {
    progress = false;
    rounds++;
    for (const gate of result.gates) {
      const task = store.get('tasks', gate.id);
      if (task.state === 'completed') continue;
      const assigned = assignTask(task.id);
      if (assigned?.state === 'blocked' && assigned.blockedReason === 'No capable available agent') {
        unstaffable.add(gate.type);
        continue;
      }
      if (assigned?.state === 'assigned') {
        completeTask(assigned.id, { ok: true });
        progress = true;
      }
    }
  }
  assert.deepEqual([...unstaffable], [], `gates with no assignable agent: ${[...unstaffable].join(', ')}`);

  const states = result.gates.map((g) => store.get('tasks', g.id).state);
  assert.ok(states.every((s) => s === 'completed'),
    `the whole gate chain should advance when every gate has staff: ${states.join(', ')}`);
});
