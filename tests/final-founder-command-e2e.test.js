import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('real founder command enters autonomous lifecycle through production API', async () => {
  const env = { FOUNDER_API_KEY: 'e2e-test-key', MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };
  const request = new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer e2e-test-key' },
    body: JSON.stringify({ command: 'मला एक e-commerce platform तयार करून द्या.' })
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.match(body.data.result.commandId, /^autonomous_[a-z0-9]+$/);
  assert.equal(body.data.result.lifecycle[0], 'received');
  assert.ok(body.data.result.lifecycle.length >= 2);
  assert.ok(body.data.result.autonomousState);
  assert.equal(body.data.resultFile.skipped, true);
});
