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

test('L1 completion requires final project QA and returns only current project tasks', async () => {
  seedAgents();
  const first = await planCommand('Build a chess game', {});
  const second = await planCommand('Build a calculator app', {});

  assert.notEqual(first.project.id, second.project.id, 'each founder command must create a new project');

  const secondTasks = store.list('tasks').filter(task => task.projectId === second.project.id);
  const finalQa = secondTasks.filter(task => task.finalProjectVerification);

  assert.equal(finalQa.length, 1, 'exactly one final QA task must exist for the current project');
  assert.equal(finalQa[0].state, 'completed', 'final QA must be completed before project completion');
  assert.ok(finalQa[0].verificationId, 'final QA must have verification evidence');
  assert.equal(second.project.state, 'completed', 'project may complete only after final QA');
  assert.equal(second.status, 'completed', 'result may complete only after final QA');
  assert.equal(second.tasks.length, secondTasks.length, 'result must contain every task from the current project');
  assert.ok(second.tasks.every(entry => entry.task.projectId === second.project.id), 'result must not leak tasks from an older project');
  assert.ok(second.tasks.some(entry => entry.task.finalProjectVerification), 'result must include final QA task');
});
