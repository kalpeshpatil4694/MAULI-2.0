import { strict as assert } from 'node:assert';
import { canWriteD1, d1QuotaSnapshot, recordD1Write } from './d1-quota.js';

const env = {};
assert.equal(d1QuotaSnapshot(env).limit, 100000);
assert.equal(d1QuotaSnapshot(env).used, 0);
recordD1Write(env, 70000);
assert.equal(d1QuotaSnapshot(env).status, 'watch');
assert.equal(canWriteD1(env, false), true);
recordD1Write(env, 20000);
assert.equal(d1QuotaSnapshot(env).protectionMode, true);
assert.equal(canWriteD1(env, false), false);
assert.equal(canWriteD1(env, true), true);

console.log('D1 quota guard tests passed');
