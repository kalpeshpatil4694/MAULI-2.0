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

  const current = listProjects().find(p => p.id === project.id);
  assert.equal(current.state, 'completed');
});
