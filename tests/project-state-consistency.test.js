import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { createProject, listProjects } from '../src/projects.js';

test('project state is active while any task is unfinished', () => {
  const project = createProject({
    name: 'State consistency test',
    objective: 'Project state must follow task truth'
  });
  store.put('tasks', {
    id: 'state-consistency-working',
    projectId: project.id,
    title: 'Working task',
    state: 'working'
  });
  store.put('tasks', {
    id: 'state-consistency-completed',
    projectId: project.id,
    title: 'Completed task',
    state: 'completed'
  });
  store.put('projects', { ...project, state: 'completed', id: project.id });

  const current = listProjects().find(p => p.id === project.id);
  assert.equal(current.state, 'active');
});

// A project whose remaining work is entirely parked is not progressing. Deriving the state
// from "any task is blocked" alone reported 'active' forever on a project where nothing
// could run, which is the false-active state the state model forbids.
test('a project whose every unfinished task is blocked is blocked, not falsely active', () => {
  const project = createProject({
    name: 'Falsely active test',
    objective: 'A parked project must read as blocked'
  });
  store.put('tasks', {
    id: 'blocked-only-a',
    projectId: project.id,
    title: 'Blocked task A',
    state: 'blocked',
    blockedReason: 'No capable available agent'
  });
  store.put('tasks', {
    id: 'blocked-only-b',
    projectId: project.id,
    title: 'Blocked task B',
    state: 'blocked',
    blockedReason: 'Dependencies incomplete'
  });

  assert.equal(listProjects().find(p => p.id === project.id).state, 'blocked');
});

test('one runnable task alongside a blocked one is still active work', () => {
  const project = createProject({
    name: 'Partially blocked test',
    objective: 'A runnable task keeps the project active'
  });
  store.put('tasks', {
    id: 'partial-blocked',
    projectId: project.id,
    title: 'Blocked task',
    state: 'blocked',
    blockedReason: 'Dependencies incomplete'
  });
  store.put('tasks', {
    id: 'partial-queued',
    projectId: project.id,
    title: 'Queued task',
    state: 'queued'
  });

  assert.equal(listProjects().find(p => p.id === project.id).state, 'active');
});

test('a blocked project becomes active again once a task can run', () => {
  const project = createProject({
    name: 'Blocked recovery test',
    objective: 'Blocked is a recoverable state'
  });
  store.put('tasks', {
    id: 'recovery-blocked',
    projectId: project.id,
    title: 'Blocked task',
    state: 'blocked',
    blockedReason: 'No capable available agent'
  });
  assert.equal(listProjects().find(p => p.id === project.id).state, 'blocked');

  // The scheduler re-queues a blocked task whose dependencies are now ready; the project
  // must follow it back to active rather than staying parked.
  store.put('tasks', {
    id: 'recovery-blocked',
    projectId: project.id,
    title: 'Blocked task',
    state: 'queued',
    blockedReason: null
  });
  assert.equal(listProjects().find(p => p.id === project.id).state, 'active');
});

test('project state becomes completed only when every task is completed', () => {
  const project = createProject({
    name: 'State completion test',
    objective: 'Project completion must require all tasks'
  });
  store.put('tasks', {
    id: 'state-completion-a',
    projectId: project.id,
    title: 'Task A',
    state: 'completed'
  });
  store.put('tasks', {
    id: 'state-completion-b',
    projectId: project.id,
    title: 'Task B',
    state: 'completed'
  });

  // Every task done is not the same as delivered: without a final delivery the founder
  // has nothing to download, so the project must stay visibly unfinished.
  assert.equal(listProjects().find(p => p.id === project.id).state, 'active');
  store.put('projects', { ...store.get('projects', project.id), finalDeliveryId: 'artifact-state-test', id: project.id });
  assert.equal(listProjects().find(p => p.id === project.id).state, 'completed');
});
