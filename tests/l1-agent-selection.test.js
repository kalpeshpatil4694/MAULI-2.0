import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAgent, selectBestAgent, updateAgent } from '../src/agents.js';

test('L1 agent selection prefers capability match, reliability and availability', () => {
  const frontend = registerAgent({
    name: 'Selection Frontend', role: 'Engineer', department: 'Engineering',
    capabilities: ['frontend', 'ui']
  });
  const weak = registerAgent({
    name: 'Selection Weak', role: 'Engineer', department: 'Engineering',
    capabilities: ['frontend']
  });
  updateAgent(frontend.id, { metadata: { successRate: 0.95, priority: 2 } });
  updateAgent(weak.id, { metadata: { successRate: 0.20, priority: 0 } });

  const selected = selectBestAgent(['frontend', 'ui'], { department: 'Engineering' });
  assert.equal(selected?.id, frontend.id);
});

test('L1 agent selection rejects an unavailable specialist', () => {
  const specialist = registerAgent({
    name: 'Unavailable Backend', role: 'Engineer', department: 'Engineering',
    capabilities: ['backend', 'api']
  });
  updateAgent(specialist.id, { state: 'working' });

  const selected = selectBestAgent(['backend', 'api'], { department: 'Engineering' });
  assert.notEqual(selected?.id, specialist.id);
});
