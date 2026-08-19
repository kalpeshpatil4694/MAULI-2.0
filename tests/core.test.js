import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretCommand } from '../src/orchestrator.js';
import { registerAgent, selectAgents } from '../src/agents.js';
import { createTask, assignTask } from '../src/tasks.js';
import { id, now } from '../src/core.js';
import { riskLevel, requiresApproval } from '../src/governance.js';

test('interprets a founder command', () => {
  const intent = interpretCommand('Build an e-commerce platform');
  assert.equal(intent.command, 'Build an e-commerce platform');
  assert.ok(intent.id);
});

test('identifiers are prefixed and timestamps are valid ISO strings', () => {
  assert.match(id('task'), /^task_[a-z0-9]+$/);
  assert.doesNotThrow(() => new Date(now()).toISOString());
});

test('selects agents by capability', () => {
  const agent = registerAgent({ name: 'Test Planner', role: 'Planner', capabilities: ['planning'] });
  const found = selectAgents(['planning']).find(a => a.id === agent.id);
  assert.ok(found);
});

test('assigns a compatible task', () => {
  const agent = registerAgent({ name: 'Test Researcher', role: 'Researcher', capabilities: ['research'] });
  const task = createTask({ title: 'Research', requiredCapabilities: ['research'] });
  const assigned = assignTask(task.id);
  assert.equal(assigned.agentId, agent.id);
  assert.equal(assigned.state, 'assigned');
});

test('high-risk code and external actions require approval', () => {
  const risk = riskLevel({ codeWrite: true, externalSideEffect: true });
  assert.equal(risk, 'high');
  assert.equal(requiresApproval(risk), true);
});
