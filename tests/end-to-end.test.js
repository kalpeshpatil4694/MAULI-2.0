import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask } from '../src/execution.js';
import { verifyResult, retryDecision } from '../src/verification.js';

test('end-to-end execution to verification completes', async () => {
  const task = { id: `task_e2e_${Date.now()}`, executor: 'internal.plan', maxAttempts: 3 };
  const execution = await executeTask(task);
  const verification = verifyResult(task, execution);
  const decision = retryDecision(task, verification, 1);
  assert.equal(execution.state, 'completed');
  assert.equal(verification.passed, true);
  assert.deepEqual(decision, { action: 'complete', attempt: 1 });
});

test('end-to-end failed execution reaches retry decision', async () => {
  const task = { id: `task_e2e_fail_${Date.now()}`, executor: 'missing.executor', maxAttempts: 2 };
  const execution = await executeTask(task);
  const verification = verifyResult(task, execution);
  const decision = retryDecision(task, verification, 1);
  assert.equal(execution.state, 'failed');
  assert.equal(verification.passed, false);
  assert.deepEqual(decision, { action: 'retry', attempt: 2 });
});
