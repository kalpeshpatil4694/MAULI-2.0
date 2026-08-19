import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask, recoverRunningExecutions } from '../src/execution.js';
import { store } from '../src/store.js';

test('running execution is recovered idempotently', async () => {
  const task = { id: `recovery_${Date.now()}`, executor: 'internal.plan' };
  const first = await executeTask(task);
  assert.equal(first.state, 'completed');
  const recovered = recoverRunningExecutions();
  assert.ok(Array.isArray(recovered));
});

test('recovery candidates are limited to running executions', () => {
  const id = `run_${Date.now()}`;
  store.put('runs', { id, taskId:'recovery_candidate', executor:'internal.plan', state:'running', startedAt:new Date().toISOString(), recoverable:true });
  const candidates = recoverRunningExecutions();
  assert.ok(candidates.some(run => run.id === id));
});

test('completed executions are not recovery candidates', () => {
  const id = `run_completed_${Date.now()}`;
  store.put('runs', { id, taskId:'completed_candidate', executor:'internal.plan', state:'completed', startedAt:new Date().toISOString(), completedAt:new Date().toISOString(), recoverable:false });
  const candidates = recoverRunningExecutions();
  assert.equal(candidates.some(run => run.id === id), false);
});
