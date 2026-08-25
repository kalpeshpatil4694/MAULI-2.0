import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('L1 API accepts founder command for asynchronous execution', async () => {
  const env = {
    FOUNDER_API_KEY: 'test-founder-key',
    MAULI_TEST_MODE: 'true',
    SKIP_RESULT_PERSISTENCE: 'true'
  };
  const request = new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: {'content-type':'application/json', authorization:'Bearer test-founder-key'},
    body: JSON.stringify({command:'Create a simple e-commerce platform'})
  });
  const response = await worker.fetch(request, env);
  const body = await response.json();
  assert.equal(response.status,202);
  assert.ok(body?.data?.commandId, 'API should return a persistent command id');
  assert.equal(body?.data?.state,'accepted');
  assert.equal(body?.data?.command,'Create a simple e-commerce platform');
});

test('L1 API rejects founder command without authentication', async () => {
  const request = new Request('https://mauli.test/api/command', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'Create a simple e-commerce platform'})});
  const response = await worker.fetch(request, {FOUNDER_API_KEY:'required-key',MAULI_TEST_MODE:'true',SKIP_RESULT_PERSISTENCE:'true'});
  assert.equal(response.status,401);
});
