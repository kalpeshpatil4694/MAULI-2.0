// Regression coverage for the "command never processed / display jumps / counters frozen"
// report:
//   1. schedulerTick starved every project past the 40th once the account held 80+ projects;
//   2. a future-dated run/task timestamp suppressed orphan recovery forever;
//   3. getProjectProgress counted only 'working' (never 'assigned'/'verifying'), so the live
//      view reported running: 0 and a completion count that disagreed with the detail page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { schedulerTick, recoverStaleTasks } from '../src/scheduler.js';
import { getProjectProgress } from '../src/live-monitor.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function ageTaskTo(taskId, iso) {
  const bucket = store.data.get('tasks');
  bucket.set(taskId, { ...bucket.get(taskId), updatedAt: iso, claimedAt: iso });
}

test('a freshly queued founder command is processed even with 44 older projects', async () => {
  store.configure(null);
  store.hydrated = true;
  seedAgents();
  const suffix = TAIL();
  // 44 older projects (aged past the freshness window) plus one just-queued command, which
  // is inserted last. The old insertion-ordered slice(0,40) always dropped the newest
  // command first; the fresh tier must instead run it ahead of the backlog.
  for (let i = 0; i < 44; i++) {
    const pid = `project-filler-${i}-${suffix}`;
    store.put('projects', { id: pid, name: `Filler ${i}`, objective: 'Build', state: 'active', requirements: ['x'], createdAt: new Date(Date.now() - 3_600_000).toISOString() });
    const t = store.put('tasks', {
      id: `task-filler-${i}-${suffix}`, projectId: pid, title: 'Plan', state: 'queued',
      dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1,
    });
    ageTaskTo(t.id, new Date(Date.now() - 3_600_000).toISOString());
  }
  const targetId = `project-target-${suffix}`;
  store.put('projects', { id: targetId, name: 'Target', objective: 'Build', state: 'active', requirements: ['x'], queuedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
  const targetTask = store.put('tasks', {
    id: `task-target-${suffix}`, projectId: targetId, title: 'Plan', state: 'queued',
    dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1,
  });

  await schedulerTick({}, { budgetMs: 0 });
  // runTask results do not carry the project id, so assert on the effect: the fresh
  // command's task must have run ahead of the 44-project backlog.
  assert.notEqual(store.get('tasks', targetTask.id).state, 'queued',
    'a just-queued command must not be starved behind the backlog');
});

test('consecutive ticks drain every project instead of re-processing the same 40', async () => {
  store.configure(null);
  store.hydrated = true;
  seedAgents();
  const suffix = TAIL();
  const ids = [];
  for (let i = 0; i < 45; i++) {
    const pid = `project-rot-${i}-${suffix}`;
    ids.push(pid);
    store.put('projects', { id: pid, name: `Rot ${i}`, objective: 'Build', state: 'active', requirements: ['x'] });
    store.put('tasks', {
      id: `task-rot-${i}-${suffix}`, projectId: pid, title: 'Plan', state: 'queued',
      dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1,
    });
  }

  await schedulerTick({}, { budgetMs: 0 });
  await schedulerTick({}, { budgetMs: 0 });
  const drained = ids.filter((id) => {
    const task = store.list('tasks').find((t) => t.projectId === id);
    return task && task.state !== 'queued';
  });
  assert.equal(drained.length, 45, 'two ticks must cover all 45 projects, not stall on the same 40');
});

test('a future-dated run heartbeat cannot pin a task as live forever', async () => {
  store.configure(null);
  const task = store.put('tasks', {
    id: 'task-future-run', projectId: 'proj-future', title: 'Stuck verifying',
    state: 'verifying', attempts: 0, maxAttempts: 3, executor: 'internal.pipeline-gate',
  });
  ageTaskTo(task.id, new Date(Date.now() - 600_000).toISOString());
  store.put('runs', {
    id: 'run-future', taskId: task.id, executor: 'internal.pipeline-gate', state: 'running',
    startedAt: new Date(Date.now() + 86_400_000).toISOString(),
    heartbeatAt: new Date(Date.now() + 86_400_000).toISOString(),
  });

  const recovered = await recoverStaleTasks();

  assert.ok(recovered.includes(task.id), 'a future timestamp must be treated as stale, not live');
  assert.equal(store.get('runs', 'run-future').state, 'failed', 'the impossible run is closed');
  assert.equal(store.get('tasks', task.id).state, 'queued', 'the task returns to the scheduler');
});

test('a future-dated task update cannot suppress orphan recovery', async () => {
  store.configure(null);
  const task = store.put('tasks', {
    id: 'task-future-updated', projectId: 'proj-future2', title: 'Orphaned verifying',
    state: 'verifying', attempts: 0, maxAttempts: 3, executor: 'internal.pipeline-gate',
  });
  ageTaskTo(task.id, new Date(Date.now() + 86_400_000).toISOString());

  await recoverStaleTasks();

  assert.equal(store.get('tasks', task.id).state, 'queued',
    'a future updatedAt must not be read as "just touched"');
});

test('live progress counts assigned and verifying tasks as running work', async () => {
  store.configure(null);
  store.hydrated = true;
  const suffix = TAIL();
  const pid = `p-progress-${suffix}`;
  store.put('projects', { id: pid, name: 'Live', objective: 'Build', state: 'active', requirements: ['x'] });
  store.put('tasks', { id: `done-${suffix}`, projectId: pid, title: 'Done', state: 'completed', dependsOn: [], requiredCapabilities: ['planning'], executor: 'internal.plan', sequence: 1 });
  store.put('tasks', { id: `verifying-${suffix}`, projectId: pid, title: 'Pipeline gate: build', state: 'verifying', dependsOn: [], requiredCapabilities: ['verification'], executor: 'internal.pipeline-gate', sequence: 2 });
  store.put('tasks', { id: `assigned-${suffix}`, projectId: pid, title: 'Pipeline gate: qa', state: 'assigned', dependsOn: [], requiredCapabilities: ['verification'], executor: 'internal.pipeline-gate', sequence: 3 });

  const progress = getProjectProgress(pid);

  assert.equal(progress.tasks.completed, 1);
  assert.equal(progress.tasks.verifying, 1);
  assert.equal(progress.tasks.assigned, 1);
  assert.equal(progress.tasks.working, 1, 'verifying is running work');
  assert.equal(progress.tasks.running, 2, 'verifying + assigned are both live work');
  assert.equal(progress.status, 'in_progress', 'a project with live work is not "pending"');
  assert.ok(progress.currentTask, 'the real task under execution must be exposed');
  assert.match(String(progress.currentTask.title), /build|qa/i);
});
