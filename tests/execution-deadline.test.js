// A hang is not a failure the scheduler can see. Before these deadlines existed, an executor
// (or a Workers AI call) that never settled kept its `await` alive forever: the run heartbeat
// interval kept writing, the run never went stale, await recoverStaleTasks() ignored it, and the
// scheduler tick never returned — one wedged task stalled its project with no error anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDeadline } from '../src/core.js';
import { executeTask, registerExecutor, grantExecutor } from '../src/execution.js';
import { generateAI } from '../src/ai.js';
import { store } from '../src/store.js';

test('withDeadline rejects a promise that never settles', async () => {
  await assert.rejects(
    () => withDeadline(new Promise(() => {}), 30, 'thing'),
    /thing timed out after 30ms/,
  );
});

test('withDeadline passes a value through when it settles in time', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 1000, 'thing'), 'ok');
});

test('an executor that never settles is failed by the execution deadline, not left running', async () => {
  const taskId = `deadline_task_${Date.now()}`;
  registerExecutor('test.never-settles', () => new Promise(() => {}), { risk: 'normal', scope: 'internal' });
  grantExecutor('test.never-settles', 'internal');

  const started = Date.now();
  const result = await executeTask({ id: taskId, executor: 'test.never-settles', risk: 'normal' }, { taskTimeoutMs: 40 });

  assert.equal(result.state, 'failed');
  assert.match(result.error, /timed out/);
  assert.ok(Date.now() - started < 5000, 'the deadline must fire promptly, not at some later recovery pass');

  // The point of the deadline: nothing is left looking alive, so recovery and the next tick
  // see a settled run instead of a permanent "execution in progress".
  const live = store.list('runs').filter(r => r.taskId === taskId && r.state === 'running');
  assert.equal(live.length, 0, 'no run may be left in the running state');
  assert.notEqual(store.get('runs', result.executionId)?.recoverable, true);
});

test('a Workers AI call that never settles surfaces as an ordinary AI error', async () => {
  const env = { AI: { run: () => new Promise(() => {}) } };
  await assert.rejects(
    () => generateAI(env, [{ role: 'user', content: 'hello' }], { timeoutMs: 30 }),
    /timed out/,
  );
});
