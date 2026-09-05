import { strict as assert } from 'node:assert';
import { canWriteD1, d1QuotaSnapshot, recordD1Write } from './d1-quota.js';

const env = {};
assert.equal(d1QuotaSnapshot(env).limit, 100000);
assert.equal(d1QuotaSnapshot(env).used, 0);
assert.equal(d1QuotaSnapshot(env).remaining, 100000);

recordD1Write(env, 70000);
assert.equal(d1QuotaSnapshot(env).status, 'watch');
assert.equal(canWriteD1(env, false), true);

recordD1Write(env, 15000);
assert.equal(d1QuotaSnapshot(env).status, 'high');
assert.equal(canWriteD1(env, false), true);

recordD1Write(env, 5000);
assert.equal(d1QuotaSnapshot(env).status, 'critical');
assert.equal(d1QuotaSnapshot(env).protectionMode, true);
assert.equal(canWriteD1(env, false), false);
assert.equal(canWriteD1(env, true), true);

recordD1Write(env, 10000);
assert.equal(d1QuotaSnapshot(env).used, 100000);
assert.equal(d1QuotaSnapshot(env).remaining, 0);
assert.equal(d1QuotaSnapshot(env).status, 'limit_reached');
assert.equal(d1QuotaSnapshot(env).protectionMode, true);
assert.equal(canWriteD1(env, false), false);
assert.equal(canWriteD1(env, true), false);

const overflowEnv = {};
recordD1Write(overflowEnv, 150000);
assert.equal(d1QuotaSnapshot(overflowEnv).used, 100000);
assert.equal(d1QuotaSnapshot(overflowEnv).remaining, 0);
assert.equal(canWriteD1(overflowEnv, true), false);

const projectedEnv = {};
recordD1Write(projectedEnv, 89999);
assert.equal(canWriteD1(projectedEnv, false), false);
assert.equal(canWriteD1(projectedEnv, true, 2), true);
assert.equal(canWriteD1(projectedEnv, true, 2) && projectedEnv.__MAULI_D1_QUOTA.writes + 2 <= 100000, true);

console.log('D1 quota guard tests passed');
