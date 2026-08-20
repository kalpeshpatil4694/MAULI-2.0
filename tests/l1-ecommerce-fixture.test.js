import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { runL1SelfTest } from '../src/self-test.js';

test('L1 e-commerce founder command produces a complete execution plan', async () => {
  seedAgents();
  const command = 'Create a simple e-commerce platform';
  const result = await planCommand(command, {});

  assert.equal(result.project.founderCommand, command);
  assert.ok(result.project.id);
  assert.ok(result.project.objective);
  assert.ok(result.tasks.length >= 3);

  for (const task of result.tasks) {
    assert.ok(task.id);
    assert.ok(task.projectId === result.project.id);
    assert.ok(task.title);
    assert.ok(Array.isArray(task.requiredCapabilities));
    assert.ok(Array.isArray(task.toolNames));
    assert.ok(task.assignedAgentId || task.state === 'blocked');
  }

  assert.ok(store.get('projects', result.project.id));
  assert.ok(store.list('tasks').some(t => t.projectId === result.project.id));
});

test('L1 self-test remains operational after fixture planning', () => {
  const report = runL1SelfTest();
  assert.ok(['ready', 'degraded', 'not_ready'].includes(report.status));
  assert.equal(report.checks.length > 0, true);
  assert.ok(Number.isInteger(report.score));
});
