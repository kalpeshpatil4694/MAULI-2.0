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

test('execution coordinator renews long-running project leases', async () => {
  const calls = [];
  const env = {
    MAULI_PROJECT_EXECUTOR: {
      idFromName: () => 'id',
      get: () => ({
        acquire: async () => ({ granted: true, token: 'token-1', busyUntil: Date.now() + 120000 }),
        renew: async (token, leaseMs) => { calls.push(['renew', token, leaseMs]); return { renewed: true }; },
        release: async (token) => { calls.push(['release', token]); return { released: true }; }
      })
    }
  };
  const result = await withProjectExecutionLock(env, 'project-1', async ({ leaseHeartbeatMs }) => {
    assert.equal(leaseHeartbeatMs, 10);
    await new Promise(resolve => setTimeout(resolve, 35));
    return { ok: true };
  }, { leaseMs: 90000, heartbeatMs: 10 });
  assert.deepEqual(result, { ok: true });
  assert.ok(calls.some(call => call[0] === 'renew'));
  assert.deepEqual(calls.at(-1), ['release', 'token-1']);
});
