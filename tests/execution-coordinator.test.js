import test from 'node:test';
import assert from 'node:assert/strict';
import { withProjectExecutionLock } from '../src/execution-coordination.js';

test('execution coordinator falls back safely when Durable Objects are not bound', async () => {
  const result = await withProjectExecutionLock({}, 'project-1', async ({ coordinated }) => ({ ok: true, coordinated }));
  assert.deepEqual(result, { ok: true, coordinated: false });
});

test('execution coordinator skips a project when its durable lease is busy', async () => {
  let called = false;
  const env = {
    MAULI_PROJECT_EXECUTOR: {
      idFromName: () => 'id',
      get: () => ({
        acquire: async () => ({ granted: false, busyUntil: Date.now() + 1000 })
      })
    }
  };
  const result = await withProjectExecutionLock(env, 'project-1', async () => { called = true; return { ok: true }; });
  assert.equal(called, false);
  assert.equal(result.status, 'coordinator-busy');
});
