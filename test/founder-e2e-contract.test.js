import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretCommand } from '../src/orchestrator.js';
import { verifyResult, retryDecision } from '../src/verification.js';

test('founder command reaches the verification contract', () => {
  const intent = interpretCommand('Create an e-commerce platform');
  assert.equal(intent.command, 'Create an e-commerce platform');
  assert.ok(intent.capabilities.includes('requirements'));

  const task = { id: 'e2e-task', maxAttempts: 2 };
  const execution = { id: 'e2e-run', taskId: task.id, state: 'completed', result: { ok: true } };
  const verification = verifyResult(task, execution);
  assert.equal(verification.passed, true);
});

test('failed verification follows retry then escalation contract', () => {
  const task = { id: 'e2e-retry', maxAttempts: 2 };
  const verification = verifyResult(task, { id: 'run', taskId: task.id, state: 'failed', result: null });
  assert.equal(verification.passed, false);
  assert.deepEqual(retryDecision(task, verification, 1), { action: 'retry', attempt: 2 });
  assert.deepEqual(retryDecision(task, verification, 2), { action: 'escalate', attempt: 2, reason: 'verification_failed_after_retries' });
});
