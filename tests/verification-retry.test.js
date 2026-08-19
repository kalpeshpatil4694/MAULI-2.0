import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyResult, retryDecision } from '../src/verification.js';

test('verification passes only for a completed matching execution with a result', () => {
  const task = { id: 'task_verify' };
  const execution = { id: 'run_verify', taskId: 'task_verify', state: 'completed', result: { ok: true } };
  const verification = verifyResult(task, execution);
  assert.equal(verification.passed, true);
});

test('verification fails for failed execution', () => {
  const task = { id: 'task_fail' };
  const execution = { id: 'run_fail', taskId: 'task_fail', state: 'failed', error: 'boom' };
  const verification = verifyResult(task, execution);
  assert.equal(verification.passed, false);
});

test('retry decision retries until max attempts then escalates', () => {
  const task = { id: 'task_retry', maxAttempts: 3 };
  const failed = { passed: false };
  assert.deepEqual(retryDecision(task, failed, 1), { action: 'retry', attempt: 2 });
  assert.deepEqual(retryDecision(task, failed, 2), { action: 'retry', attempt: 3 });
  assert.deepEqual(retryDecision(task, failed, 3), { action: 'escalate', attempt: 3, reason: 'verification_failed_after_retries' });
});
