import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleRun, recoverRunningExecutions } from '../src/execution.js';

test('execution lifecycle detects expired leases', () => {
  const old = new Date(Date.now() - 120_000).toISOString();
  assert.equal(isStaleRun({ state: 'running', heartbeatAt: old }), true);
  assert.equal(isStaleRun({ state: 'completed', heartbeatAt: old }), false);
});

test('execution lifecycle keeps fresh running leases active', () => {
  const fresh = new Date(Date.now() - 5_000).toISOString();
  assert.equal(isStaleRun({ state: 'running', heartbeatAt: fresh }), false);
});

test('recovery API is safe when there are no running executions', () => {
  const result = recoverRunningExecutions();
  assert.ok(Array.isArray(result));
});
