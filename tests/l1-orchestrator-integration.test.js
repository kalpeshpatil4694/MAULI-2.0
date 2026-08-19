import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';

test('L1 founder command creates a project and executable task plan without paid services', async () => {
  const result = await planCommand('Create a simple e-commerce platform.');

  assert.ok(result.project?.id, 'project should be created');
  assert.ok(result.project?.founderCommand?.includes('e-commerce'));
  assert.ok(Array.isArray(result.tasks));
  assert.ok(result.tasks.length > 0, 'at least one task should be planned');

  for (const entry of result.tasks) {
    assert.ok(entry.task?.id);
    assert.ok(Array.isArray(entry.task?.requiredCapabilities));
    assert.ok(Array.isArray(entry.task?.toolNames));
  }

  assert.ok(['completed', 'active', 'escalated', 'awaiting_approval', 'blocked', 'error'].includes(result.status));
});
