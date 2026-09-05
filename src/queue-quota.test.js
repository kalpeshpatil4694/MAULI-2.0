import assert from 'node:assert/strict';
import {
  canUseQueue,
  queueQuotaSnapshot,
  recordQueueOperation,
  reserveQueueOperation,
  validateQueuePayload,
  QUEUE_DAILY_OPERATION_LIMIT,
  QUEUE_SAFE_OPERATION_LIMIT,
  QUEUE_MAX_SAFE_MESSAGE_BYTES
} from './queue-quota.js';

const env = {};
assert.equal(QUEUE_DAILY_OPERATION_LIMIT, 10000);
assert.equal(QUEUE_SAFE_OPERATION_LIMIT, 8000);
assert.equal(validateQueuePayload('hello').ok, true);
assert.equal(validateQueuePayload(new Uint8Array(QUEUE_MAX_SAFE_MESSAGE_BYTES)).ok, true);
assert.equal(validateQueuePayload(new Uint8Array(QUEUE_MAX_SAFE_MESSAGE_BYTES + 1)).ok, false);
assert.equal(queueQuotaSnapshot(env).used, 0);

assert.equal(reserveQueueOperation(env), true);
assert.equal(queueQuotaSnapshot(env).used, 1);
assert.equal(canUseQueue(env, { payload: new Uint8Array(QUEUE_MAX_SAFE_MESSAGE_BYTES + 1) }), false);

for (let i = 1; i < QUEUE_SAFE_OPERATION_LIMIT; i++) recordQueueOperation(env);
assert.equal(queueQuotaSnapshot(env).used, QUEUE_SAFE_OPERATION_LIMIT);
assert.equal(canUseQueue(env), false);
assert.equal(canUseQueue(env, { critical: true }), true);

for (let i = QUEUE_SAFE_OPERATION_LIMIT; i < QUEUE_DAILY_OPERATION_LIMIT; i++) recordQueueOperation(env);
assert.equal(queueQuotaSnapshot(env).used, QUEUE_DAILY_OPERATION_LIMIT);
assert.equal(canUseQueue(env, { critical: true }), false);
