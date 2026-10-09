import test from 'node:test';
import assert from 'node:assert/strict';
// Rate limiting on the PRODUCTION command route.
//
// This file did not exist before; it was created as part of resolving finding F-1, because the
// production route and the removed src/index.js duplicate used DIFFERENT buckets:
//
//   removed handler: checkCommandRateLimit(request)        → COMMAND_LIMIT = 5/min per client
//   production:      checkRateLimit(request)               → LIMIT        = 20/min per client
//
// tests/rate-limit-scope.test.js covers the limiter functions directly. This file covers the
// HTTP route, so the assertion is about the limit the founder actually hits.
import { handleFounderCommand } from '../src/command-endpoint.js';

const ENV = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };

function request(body, ip) {
  return new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body)
  });
}

// A body with no `command` is rejected with 400 AFTER the limiter has counted it, so it spends a
// slot without paying for a plan. That keeps these tests about rate limiting, not throughput.
const spendOneSlot = (ip) => handleFounderCommand(request({}, ip), ENV, {});

test('the production command route spends the default bucket, not the legacy 5/min command scope', async () => {
  const ip = '203.0.113.10';
  for (let i = 0; i < 6; i++) {
    const spent = await spendOneSlot(ip);
    assert.equal(spent.status, 400, 'an empty command is rejected but still counted');
  }
  // Six requests have now been counted. Under the removed handler's COMMAND_LIMIT of 5 this
  // seventh request would already have been answered 429. The deployed route must accept it.
  const response = await handleFounderCommand(request({ command: 'Build a simple calculator web app' }, ip), ENV, {});
  assert.equal(response.status, 202, 'the deployed route uses the 20/min default bucket, not the legacy 5/min command scope');
});

test('the production command route answers 429 with a retry hint once the bucket is spent', async () => {
  const ip = '203.0.113.11';
  // LIMIT is 20 per 60 s window, so the 21st counted request for one client is refused.
  for (let i = 0; i < 20; i++) {
    const spent = await spendOneSlot(ip);
    assert.equal(spent.status, 400, `request ${i + 1} must be counted, not refused`);
  }
  const blocked = await handleFounderCommand(request({ command: 'Build a simple calculator web app' }, ip), ENV, {});
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.ok, false);
  assert.equal(body?.error?.message, 'Rate limit exceeded');
  assert.ok(Number.isFinite(body?.error?.details?.retryAfter), 'the refusal must say when to retry');
  assert.ok(body.error.details.retryAfter >= 0);
});

test('one client exhausting the bucket does not lock out another client', async () => {
  const spentIp = '203.0.113.12';
  const otherIp = '203.0.113.13';
  for (let i = 0; i < 20; i++) await spendOneSlot(spentIp);
  const refused = await handleFounderCommand(request({ command: 'Build a calculator' }, spentIp), ENV, {});
  assert.equal(refused.status, 429, 'the spent client is refused');

  const allowed = await handleFounderCommand(request({ command: 'Build a calculator' }, otherIp), ENV, {});
  assert.equal(allowed.status, 202, 'a different client keeps its own budget');
});
