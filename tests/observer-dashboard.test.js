import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('observer dashboard is served without exposing protected data', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/'), {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Live Task Observer/);
  assert.match(html, /Founder API key/);
  assert.match(html, /\/api\/observer/);
});

test('observer dashboard alternate route is available', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/observer'), {});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /BATCH 2/);
});

test('state endpoint requires Founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/state'), {});
  assert.equal(response.status, 503);
});

test('observer endpoint requires Founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/observer'), {});
  assert.equal(response.status, 503);
});

test('observer timeline requires Founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/observer/timeline'), {});
  assert.equal(response.status, 503);
});
