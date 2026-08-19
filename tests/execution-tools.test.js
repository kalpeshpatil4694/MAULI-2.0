import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask } from '../src/execution.js';

test('executor can call governed read-only tool', async () => {
  const result = await executeTask({ id: `task_${Date.now()}`, executor: 'internal.plan' });
  assert.equal(result.state, 'completed');
  assert.equal(result.result.diagnostics.healthy, true);
});

test('missing executor produces failed run instead of throwing', async () => {
  const result = await executeTask({ id: `task_${Date.now()}`, executor: 'missing.executor' });
  assert.equal(result.state, 'failed');
  assert.match(result.error, /No executor registered/);
});

test('critical task requires explicit approval', async () => {
  const result = await executeTask({ id: `task_${Date.now()}`, executor: 'internal.plan', risk: 'critical' });
  assert.equal(result.state, 'failed');
  assert.match(result.error, /explicit approval/);
});
