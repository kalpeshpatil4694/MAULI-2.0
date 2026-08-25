import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask } from '../src/execution.js';
import { verifyResult, retryDecision } from '../src/verification.js';
import { executeAutonomously, getAutonomousTimeline } from '../src/orchestrator.js';

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

test('autonomous execution preserves the governed end-to-end lifecycle', async () => {
  const result = await executeAutonomously('Create a calculator project');
  assert.match(result.commandId, /^autonomous_[a-z0-9]+$/);
  assert.ok(result.lifecycle.includes('received'));
  assert.ok(['completed', 'blocked', 'failed', 'awaiting_approval', 'executing', 'qa'].includes(result.autonomousState));
  const timeline = getAutonomousTimeline(result.commandId);
  assert.ok(timeline.length >= 2);
  assert.equal(timeline[0].state, 'received');
  assert.ok(timeline.every(event => event.commandId === result.commandId));
});

test('autonomous execution rejects an empty founder command without side effects', async () => {
  const result = await executeAutonomously('');
  assert.equal(result.autonomousState, 'failed');
  assert.equal(result.error, 'Founder command is required');
  assert.deepEqual(result.lifecycle, ['received', 'failed']);
});
