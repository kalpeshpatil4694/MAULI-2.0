import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
// The production command handler (worker.js calls this; see tests/l1-command-api.test.js for
// why it is imported from its own module rather than from src/worker.js).
import { handleFounderCommand } from '../src/command-endpoint.js';

test('health endpoint exposes service health contract', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/health'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.service, 'mauli2.0');
  assert.equal(body.data.status, 'healthy');
});

test('unknown route returns 404 contract', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/unknown'), {});
  assert.equal(response.status, 404);
});

test('command endpoint rejects missing founder command', async () => {
  const response = await handleFounderCommand(new Request('https://mauli.test/api/command', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  }), {}, {});
  assert.equal(response.status, 400);
});
