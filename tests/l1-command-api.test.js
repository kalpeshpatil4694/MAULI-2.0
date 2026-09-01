import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const testEnv = {
  MAULI_TEST_MODE: 'true',
  SKIP_RESULT_PERSISTENCE: 'true'
};

test('L1 API exposes founder command execution route without API-key authentication', async () => {
  const request = new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'Create a simple e-commerce platform' })
  });

  const response = await worker.fetch(request, testEnv);
  const body = await response.json();

  assert.ok([200, 201].includes(response.status), `unexpected status: ${response.status}`);
  assert.ok(body?.data?.result?.project?.id, 'API should return a created project');
  assert.equal(body?.data?.resultFile?.skipped, true, 'isolated API test should skip GitHub Result persistence');
  assert.equal(body?.data?.resultFile?.testMode, true, 'isolated API test must be explicitly marked as test mode');
});

test('L1 API ignores legacy founder API-key headers', async () => {
  const request = new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer legacy-key'
    },
    body: JSON.stringify({ command: 'Create a simple e-commerce platform' })
  });

  const response = await worker.fetch(request, testEnv);
  assert.notEqual(response.status, 401);
});
