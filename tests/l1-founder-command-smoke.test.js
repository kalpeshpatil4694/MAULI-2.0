import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

test('L1 Founder command creates a usable project and task plan', async () => {
  seedAgents();
  const command = 'Create a simple e-commerce platform';
  const result = await planCommand(command, {});
  assert.ok(result);
  assert.ok(result.project);
  assert.equal(result.project.founderCommand, command);
  assert.ok(Array.isArray(result.tasks));
  assert.ok(result.tasks.length > 0);
  for (const task of result.tasks) {
    assert.ok(Array.isArray(task.requiredCapabilities));
    assert.ok(Array.isArray(task.toolNames));
    assert.ok(task.assignedAgentId || task.state === 'blocked');
  }
  const storedProject = store.get('projects', result.project.id);
  assert.ok(storedProject);
});
