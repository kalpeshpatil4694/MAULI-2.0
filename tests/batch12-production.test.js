import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfig, requestId, securityHeaders, productionSnapshot, isProductionHealthy } from '../src/production.js';

test('production limits are bounded and deterministic', () => {
  const config = productionConfig({ MAULI_MAX_EVENTS: '999999', MAULI_REQUEST_TIMEOUT_MS: '10' });
  assert.equal(config.maxEvents, 5000);
  assert.equal(config.requestTimeoutMs, 1000);
  assert.equal(productionConfig({}).maxRequestBytes, 1048576);
});

test('request id accepts safe caller id and generates one otherwise', () => {
  assert.equal(requestId(new Request('https://example.test', { headers: { 'x-request-id': 'founder_123' } })), 'founder_123');
  const generated = requestId(new Request('https://example.test'));
  assert.match(generated, /^req_[0-9a-f-]{36}$/);
});

test('production response headers disable unsafe caching and framing', () => {
  const headers = securityHeaders();
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['cache-control'], 'no-store');
});

test('production snapshot reports readiness without exposing secrets', () => {
  const snapshot = productionSnapshot({ env: { ENVIRONMENT: 'production', DB: { prepare() {} }, AI: {} }, recoveredRuns: ['r1'], store: { recentEvents: () => [{ type: 'x' }] } });
  assert.equal(snapshot.environment, 'production');
  assert.equal(snapshot.persistence, true);
  assert.equal(snapshot.recoveredRuns, 1);
  assert.equal(isProductionHealthy(snapshot), true);
  assert.equal('token' in snapshot, false);
});

test('production readiness is degraded when persistence is unavailable', () => {
  const snapshot = productionSnapshot({ env: { ENVIRONMENT: 'production' } });
  assert.equal(isProductionHealthy(snapshot), false);
});
