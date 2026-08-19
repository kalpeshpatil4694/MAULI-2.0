import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

test('L1 end-to-end: founder command creates and executes a project flow', async () => {
  seedAgents();

  const result = await planCommand('Create a simple e-commerce platform', {});

  assert.ok(result?.project?.id, 'project must be created');
  assert.ok(Array.isArray(result.tasks), 'tasks must be returned');
  assert.ok(result.tasks.length > 0, 'at least one task must be created');

  const persistedTasks = store.list('tasks').filter(task => task.projectId === result.project.id);
  assert.ok(persistedTasks.length > 0, 'tasks must be persisted');

  const hasPlanning = persistedTasks.some(task => /plan|requirements|research/i.test(task.title));
  assert.ok(hasPlanning, 'project should contain planning/requirements work');

  const hasVerification = persistedTasks.some(task => task.executor === 'internal.verify-code' || /verify|test|qa/i.test(task.title));
  assert.ok(hasVerification, 'project should contain verification work');

  const project = store.get('projects', result.project.id);
  assert.ok(project, 'project must remain persisted after execution');
  assert.ok(['active', 'completed', 'escalated', 'awaiting_approval', 'blocked', 'error'].includes(project.state), 'project must have a valid lifecycle state');
});
