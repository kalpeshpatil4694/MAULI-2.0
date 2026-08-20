import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, assignTask } from '../src/tasks.js';
import { executeTaskLifecycle } from '../src/execution.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

test('L1 task lifecycle reaches completed with the safe planning executor', async () => {
  seedAgents();
  const task = createTask({
    projectId: 'fixture-project',
    title: 'L1 lifecycle smoke task',
    description: 'Generate and verify a safe execution plan',
    requiredCapabilities: [],
    acceptance: []
  });
  const assigned = assignTask(task.id);
  assert.ok(assigned);
  assert.equal(assigned.state, 'assigned');

  const result = await executeTaskLifecycle(assigned, {});
  assert.equal(result.status, 'completed');
  assert.equal(result.task.state, 'completed');
  assert.equal(result.execution.state, 'completed');
  assert.equal(result.verification.passed, true);
  assert.ok(store.list('runs').some(r => r.taskId === task.id && r.state === 'completed'));
});
