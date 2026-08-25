import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { productionSnapshot, isProductionHealthy } from '../src/production.js';

test('production health contract reports healthy when persistence and environment are present', () => {
  const snapshot = productionSnapshot({ env: { DB: { prepare() {} }, ENVIRONMENT: 'production' }, recoveredRuns: [], store: { recentEvents: () => [] } });
  assert.equal(snapshot.service, 'mauli2.0');
  assert.equal(snapshot.persistence, true);
  assert.equal(snapshot.environment, 'production');
  assert.equal(isProductionHealthy(snapshot), true);
});

test('health endpoint degrades when persistence is unavailable', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/health'), { ENVIRONMENT: 'production' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.persistence, false);
  assert.equal(body.data.status, 'degraded');
});

test('unknown route returns 404 contract', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/unknown'), {});
  assert.equal(response.status, 404);
});

test('command endpoint rejects missing founder command', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/command', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }), {});
  assert.equal(response.status, 400);
});
