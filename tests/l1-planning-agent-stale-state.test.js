import test from 'node:test';
import assert from 'node:assert/strict';
import { seedAgents, listAgents, registerAgent, updateAgent } from '../src/agents.js';
import { createTask } from '../src/tasks.js';

test('L1 planning agent becomes available when its persisted task is stale', () => {
  const agent = registerAgent({
    name: 'Product Agent',
    role: 'Product',
    department: 'Business',
    capabilities: ['requirements'],
    tools: []
  });
  const staleTask = createTask({
    title: 'Old planning task',
    requiredCapabilities: ['product-planning', 'planning'],
    executor: 'internal.plan'
  });
  updateAgent(agent.id, { state: 'working', currentTaskId: staleTask.id });
  seedAgents();

  const refreshed = listAgents().find(item => item.id === agent.id);
  assert.equal(refreshed?.state, 'available');
  assert.equal(refreshed?.currentTaskId, null);
  assert.ok(refreshed?.capabilities.includes('product-planning'));
  assert.ok(refreshed?.capabilities.includes('planning'));
  assert.ok(refreshed?.tools.includes('planning.execute'));
});
