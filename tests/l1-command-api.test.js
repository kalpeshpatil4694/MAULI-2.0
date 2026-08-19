import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('L1 API exposes founder command execution route', async () => {
  const env = {
    FOUNDER_API_KEY: 'test-founder-key'
  };

  const request = new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer test-founder-key'
    },
    body: JSON.stringify({ command: 'Create a simple e-commerce platform' })
  });

  const response = await worker.fetch(request, env);
  const body = await response.json();

  assert.ok([200, 201].includes(response.status), `unexpected status: ${response.status}`);
  assert.ok(body?.data?.result?.project?.id, 'API should return a created project');
});

test('L1 API rejects founder command without authentication', async () => {
  const request = new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'Create a simple e-commerce platform' })
  });

  const response = await worker.fetch(request, { FOUNDER_API_KEY: 'required-key' });
  assert.equal(response.status, 401);
});
