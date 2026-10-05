// Multi-agent execution used to be one lane: schedulerTick claimed and ran a single task at a
// time, so a project with several independent tasks advanced no faster than one agent however
// many free agents it had. These tests drive the REAL scheduler with a tracking executor and
// observe the overlap, with a negative control that pins the bound back to 1 so the assertion
// cannot pass for the wrong reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { registerExecutor } from '../src/execution.js';
import { schedulerTick } from '../src/scheduler.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A tracker shared by the executor handler. `active` is the number of handler bodies in flight
// right now; `maxActive` is the high-water mark the scheduler allowed.
function tracker() {
  const state = { active: 0, maxActive: 0, runs: 0 };
  return state;
}

let TRACK = tracker();
registerExecutor('test.track', async () => {
  TRACK.active += 1;
  TRACK.runs += 1;
  TRACK.maxActive = Math.max(TRACK.maxActive, TRACK.active);
  // Hold the lane long enough that a serial loop cannot overlap two bodies by accident.
  await new Promise((r) => setTimeout(r, 40));
  TRACK.active -= 1;
  return { type: 'plan', summary: 'tracked execution', ok: true };
}, { description: 'test tracking executor', risk: 'low', scope: 'internal' });

/**
 * One project with two independent tasks that select DIFFERENT agents (frontend vs backend),
 * so neither task has to wait for the other's agent.
 */
function twoIndependentTasks(suffix) {
  const pid = `project-parallel-${suffix}`;
  store.put('projects', {
    id: pid, name: 'Parallel project', objective: 'Build', state: 'active',
    requirements: ['x'], createdAt: new Date().toISOString(),
  });
  for (const [i, capability] of [['a', 'frontend'], ['b', 'backend']]) {
    store.put('tasks', {
      id: `task-parallel-${i}-${suffix}`, projectId: pid, title: `Work ${i}`,
      state: 'queued', dependsOn: [], requiredCapabilities: [capability],
      executor: 'test.track', sequence: i === 'a' ? 1 : 2,
    });
  }
  return pid;
}

test('independent tasks with different agents execute concurrently', async () => {
  store.configure(null);
  store.hydrated = true;
  seedAgents();
  TRACK = tracker();
  const pid = twoIndependentTasks(TAIL());

  await schedulerTick({}, { budgetMs: 0 });

  const tasks = store.list('tasks').filter((t) => t.projectId === pid);
  assert.equal(TRACK.runs, 2, 'both independent tasks must have executed in one tick');
  assert.ok(
    TRACK.maxActive >= 2,
    `two independent tasks must overlap, but the peak in-flight count was ${TRACK.maxActive}`
  );
  // The agents must not collide: two tasks, two different agents.
  const agents = new Set(tasks.map((t) => t.agentId ?? t.assignedAgentId).filter(Boolean));
  assert.equal(agents.size, 2, 'each task must have claimed its own agent');
});

// Negative control: with the bound pinned to one lane the same fixture must NOT overlap, so the
// assertion above is really measuring parallelism and not the harness.
test('the concurrency bound is honoured: one lane means no overlap (control)', async () => {
  store.configure(null);
  store.hydrated = true;
  seedAgents();
  TRACK = tracker();
  const pid = twoIndependentTasks(TAIL());

  await schedulerTick({}, { budgetMs: 0, concurrency: 1 });

  const tasks = store.list('tasks').filter((t) => t.projectId === pid);
  assert.equal(TRACK.runs, 2, 'a single lane still runs both tasks, just one after the other');
  assert.equal(TRACK.maxActive, 1, 'a one-lane bound must never run two task bodies at once');
  assert.equal(tasks.length, 2);
});

// The bound must stay modest: the free-tier CPU (10ms) and ~40-subrequest budgets are per
// invocation, so an unbounded fan-out would fail every task at once instead of speeding
// anything up. An absurd configured value is clamped rather than obeyed.
test('an absurd configured concurrency is clamped, never unbounded', async () => {
  store.configure(null);
  store.hydrated = true;
  seedAgents();
  TRACK = tracker();
  const suffix = TAIL();
  const pid = `project-clamp-${suffix}`;
  store.put('projects', { id: pid, name: 'Clamp', objective: 'Build', state: 'active', requirements: ['x'], createdAt: new Date().toISOString() });
  const capabilities = ['frontend', 'backend', 'database', 'testing', 'security', 'deployment', 'research', 'design', 'mobile', 'pdf'];
  for (let i = 0; i < capabilities.length; i++) {
    store.put('tasks', {
      id: `task-clamp-${i}-${suffix}`, projectId: pid, title: `Work ${i}`, state: 'queued',
      dependsOn: [], requiredCapabilities: [capabilities[i]], executor: 'test.track', sequence: i + 1,
    });
  }

  await schedulerTick({ MAULI_AGENT_CONCURRENCY: '1000' }, { budgetMs: 0 });

  assert.ok(TRACK.maxActive <= 8, `concurrency must be clamped to 8, saw ${TRACK.maxActive}`);
  assert.ok(TRACK.maxActive >= 2, 'the clamp must still allow real parallelism');
});