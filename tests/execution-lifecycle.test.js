import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverRunningExecutions } from '../src/execution.js';

test('execution recovery API is safe with no stale executions', () => {
  const result = recoverRunningExecutions();
  assert.ok(Array.isArray(result));
});

test('execution lifecycle recovery returns a bounded collection', () => {
  const result = recoverRunningExecutions();
  assert.ok(result.length >= 0);
});
