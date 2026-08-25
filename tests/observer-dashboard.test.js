import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('founder command center is served at root without exposing protected data', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/'), {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Founder Command Center/);
  assert.match(html, /Founder API key/);
  assert.match(html, /\/api\/command/);
});

test('observer dashboard alternate route is available', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/observer'), {});
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Live Task Observer/);
  assert.match(html, /BATCH 2/);
  assert.match(html, /Founder API key/);
  assert.match(html, /\/api\/observer/);
});

test('command center alternate route is available', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/command-center'), {});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Founder Command Center/);
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
