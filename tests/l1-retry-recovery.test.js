import test from 'node:test';
import assert from 'node:assert/strict';
import { retryDecision } from '../src/verification.js';

test('L1 verification requests retry before max attempts', () => {
  const task = { id: 'retry-task', maxAttempts: 3 };
  const failed = { passed: false };
  assert.deepEqual(retryDecision(task, failed, 1), { action: 'retry', attempt: 2 });
  assert.deepEqual(retryDecision(task, failed, 2), { action: 'retry', attempt: 3 });
});

test('L1 verification escalates after max attempts', () => {
  const task = { id: 'escalate-task', maxAttempts: 3 };
  const failed = { passed: false };
  const decision = retryDecision(task, failed, 3);
  assert.equal(decision.action, 'escalate');
  assert.equal(decision.reason, 'verification_failed_after_retries');
});

test('L1 verification completes immediately after a passing result', () => {
  const task = { id: 'complete-task', maxAttempts: 3 };
  const passed = { passed: true };
  assert.deepEqual(retryDecision(task, passed, 1), { action: 'complete', attempt: 1 });
});
