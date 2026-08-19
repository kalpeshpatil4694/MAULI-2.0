import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { FOUNDER_API_KEY:'test-founder-key' };

test('command API rejects missing founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/command', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({command:'test'}) }), env);
  assert.equal(response.status, 401);
});

test('command API rejects invalid founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/command', { method:'POST', headers:{'content-type':'application/json','authorization':'Bearer wrong'}, body:JSON.stringify({command:'test'}) }), env);
  assert.equal(response.status, 401);
});

test('command API accepts valid founder authorization', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/command', { method:'POST', headers:{'content-type':'application/json','authorization':'Bearer test-founder-key'}, body:JSON.stringify({command:'test'}) }), env);
  assert.notEqual(response.status, 401);
});
