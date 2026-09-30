// MAULI's own D1 counter only sees the writes this isolate issued, so it reported
// "healthy, 0/100000" while Cloudflare was rejecting every write with:
//
//   "Your account has exceeded D1's free tier daily row write limit."
//
// Nothing in the product could distinguish "no work happened" from "no work could be
// recorded": projects stalled, tasks churned as orphans, and /api/health said healthy.
// The dashboard looked broken with no explanation anywhere.
//
// These tests pin the detection and the reporting that make the limit visible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { noteD1WriteBlocked, d1QuotaSnapshot, canWriteD1, d1WriteBlockedSnapshot } from '../src/d1-quota.js';
import { d1Put } from '../src/db.js';

const LIMIT_ERROR = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.");

function envWithRejectingD1(error) {
  return {
    DB: { prepare() { return { bind() { return { async run() { throw error; } }; } }; } },
  };
}

test('an account-level write-limit rejection is recognised', () => {
  const env = {};
  assert.equal(noteD1WriteBlocked(env, LIMIT_ERROR), true);
  const blocked = d1WriteBlockedSnapshot(env);
  assert.ok(blocked, 'the blocked state must be recorded');
  assert.equal(blocked.source, 'cloudflare-account');
  assert.match(blocked.reason, /daily row write limit/);
});

test('an unrelated D1 error is not mistaken for the daily limit', () => {
  const env = {};
  assert.equal(noteD1WriteBlocked(env, new Error('D1_ERROR: something else went wrong')), false);
  assert.equal(d1WriteBlockedSnapshot(env), null);
});

test('the quota reports the account limit instead of a healthy 0/100000', () => {
  const env = {};
  assert.equal(d1QuotaSnapshot(env).status, 'healthy', 'precondition: it looks healthy before the rejection');
  noteD1WriteBlocked(env, LIMIT_ERROR);
  const snapshot = d1QuotaSnapshot(env);
  assert.equal(snapshot.status, 'account_limit_reached');
  assert.equal(snapshot.protectionMode, true);
  assert.ok(snapshot.blocked, 'the reason must travel with the snapshot, not just a status string');
});

test('further writes stop being attempted once Cloudflare has refused them', () => {
  const env = {};
  assert.equal(canWriteD1(env, true, 1), true, 'precondition: writes are allowed');
  noteD1WriteBlocked(env, LIMIT_ERROR);
  assert.equal(canWriteD1(env, true, 1), false, 'a write Cloudflare will reject must not be attempted');
});

test('a write blocked after the limit is known explains itself', async () => {
  // "write blocked" told the founder nothing and read like a product fault. The isolate
  // that trips the guard is the only one that knows why, so it has to say so.
  const env = { DB: { prepare() { return { bind() { return { async run() { throw LIMIT_ERROR; } }; } }; } } };
  await d1Put(env, 'tasks', { id: 'warm', state: 'queued' });
  const blocked = await d1Put(env, 'tasks', { id: 'next', state: 'queued' });
  assert.equal(blocked._d1WriteLimit, true);
  assert.match(blocked._d1WriteError, /daily row write limit/);
  assert.match(blocked._d1WriteError, /Writes resume after/);
});

test('a rejected entity write records the limit instead of failing silently', async () => {
  const env = envWithRejectingD1(LIMIT_ERROR);
  const result = await d1Put(env, 'tasks', { id: 't1', state: 'queued' });
  assert.ok(result._d1WriteDeferred, 'the write is reported as deferred');
  assert.match(result._d1WriteError, /daily row write limit/);
  assert.ok(d1WriteBlockedSnapshot(env), 'the rejection must be visible on /api/health');
  assert.equal(d1QuotaSnapshot(env).status, 'account_limit_reached');
});
