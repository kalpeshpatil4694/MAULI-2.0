import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { MAULI_TEST_MODE:'true', SKIP_RESULT_PERSISTENCE:'true' };

test('command API accepts a command without founder API-key authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/command', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({command:'test'})
  }), env);
  assert.notEqual(response.status, 401);
});

test('legacy bearer credentials do not control founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/command', {
    method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer wrong'},
    body:JSON.stringify({command:'test'})
  }), env);
  assert.notEqual(response.status, 401);
});
