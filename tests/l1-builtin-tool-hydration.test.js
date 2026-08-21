import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { ensureBuiltinTools, toolsForTask } from '../src/tools.js';

test('L1 restores canonical planning tool after stale D1 hydration', () => {
  store.put('tools', {
    id: 'tool_planning.execute',
    name: 'planning.execute',
    description: 'stale persisted metadata',
    risk: 'write',
    capabilities: ['legacy-planning'],
    scope: 'external',
    enabled: false
  });

  ensureBuiltinTools();

  const planningTool = store.get('tools', 'tool_planning.execute');
  assert.equal(planningTool?.enabled, true);
  assert.equal(planningTool?.risk, 'read');
  assert.equal(planningTool?.scope, 'internal');
  assert.deepEqual(planningTool?.capabilities, ['planning', 'product-planning']);
  assert.deepEqual(
    toolsForTask({ requiredCapabilities: ['product-planning', 'planning'] }, { scope: 'internal', maxRisk: 'read' }),
    ['planning.execute']
  );
});
