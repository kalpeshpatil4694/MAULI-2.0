import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, checkCommandRateLimit, getRateLimitScopes } from '../src/auth.js';

function req(ip) {
  return { headers: { get: (name) => (name.toLowerCase() === 'x-forwarded-for' ? ip : null) } };
}

test('ordinary traffic cannot spend the chat budget', () => {
  const ip = '10.0.0.1';
  // 18 dashboard reads — more than the chat limit of 5, fewer than the default limit of 20.
  for (let i = 0; i < 18; i++) assert.equal(checkRateLimit(req(ip)).ok, true);

  const chat = checkCommandRateLimit(req(ip), 'chat');
  assert.equal(chat.ok, true, 'first chat message must not be blocked by dashboard reads');
  assert.equal(chat.limit, 5);
});

test('the chat budget is still five per window', () => {
  const ip = '10.0.0.2';
  for (let i = 0; i < 5; i++) assert.equal(checkCommandRateLimit(req(ip), 'chat').ok, true, `message ${i + 1} must pass`);
  const sixth = checkCommandRateLimit(req(ip), 'chat');
  assert.equal(sixth.ok, false);
  assert.equal(sixth.status, 429);
  assert.equal(sixth.error, 'Rate limit exceeded');
  assert.ok(sixth.retryAfter >= 0);
});

test('chat and command have independent budgets', () => {
  const ip = '10.0.0.3';
  for (let i = 0; i < 5; i++) checkCommandRateLimit(req(ip), 'command');
  // The command budget is spent, but the conversation box is a different operation.
  assert.equal(checkCommandRateLimit(req(ip), 'command').ok, false);
  assert.equal(checkCommandRateLimit(req(ip), 'chat').ok, true);
});

test('the default budget is still twenty per window', () => {
  const ip = '10.0.0.4';
  for (let i = 0; i < 20; i++) assert.equal(checkRateLimit(req(ip)).ok, true, `read ${i + 1} must pass`);
  assert.equal(checkRateLimit(req(ip)).ok, false);
});

test('a custom scope is counted on its own', () => {
  const ip = '10.0.0.5';
  checkRateLimit(req(ip), { limit: 1, scope: 'deploy' });
  assert.equal(checkRateLimit(req(ip), { limit: 1, scope: 'deploy' }).ok, false);
  assert.equal(checkRateLimit(req(ip), { limit: 1, scope: 'export' }).ok, true);
});

test('different clients never share a bucket', () => {
  for (let i = 0; i < 5; i++) checkCommandRateLimit(req('10.0.1.1'), 'chat');
  assert.equal(checkCommandRateLimit(req('10.0.1.1'), 'chat').ok, false);
  assert.equal(checkCommandRateLimit(req('10.0.1.2'), 'chat').ok, true);
});

test('scopes are reported separately for the usage page', () => {
  const before = getRateLimitScopes();
  checkRateLimit(req('10.0.2.1'));
  checkCommandRateLimit(req('10.0.2.1'), 'chat');
  const after = getRateLimitScopes();
  // The two calls from one client land in two different scopes, so the default bucket
  // grows by exactly one and the chat bucket by exactly one.
  assert.equal((after.default ?? 0) - (before.default ?? 0), 1);
  assert.equal((after.chat ?? 0) - (before.chat ?? 0), 1);
});