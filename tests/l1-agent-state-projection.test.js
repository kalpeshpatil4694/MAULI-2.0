import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';

test('L1 final result returns cleaned agent state after completed task', async () => {
  const result = await planCommand('Research a travel destination', {});

  assert.equal(result.status, 'completed');
  assert.equal(result.selectedAgent?.state, 'available');
  assert.equal(result.selectedAgent?.currentTaskId, null);

  const finalQa = result.tasks.find(entry => entry.task?.finalProjectVerification);
  assert.ok(finalQa, 'final QA task must be present');
  assert.equal(finalQa.task.state, 'completed');
  assert.ok(finalQa.task.verificationId, 'final QA must have verification evidence');
});
