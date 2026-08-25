import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('real founder command enters autonomous lifecycle through production API', async () => {
  const env = {FOUNDER_API_KEY:'e2e-test-key',MAULI_TEST_MODE:'true',SKIP_RESULT_PERSISTENCE:'true'};
  const request = new Request('https://mauli.test/api/command', {method:'POST',headers:{'content-type':'application/json',authorization:'Bearer e2e-test-key'},body:JSON.stringify({command:'मला एक e-commerce platform तयार करून द्या.'})});
  const response = await worker.fetch(request,env);
  assert.equal(response.status,202);
  const body = await response.json();
  assert.ok(body.data.commandId);
  assert.match(body.data.commandId,/^cmd_[0-9a-f-]{36}$/);
  assert.equal(body.data.state,'accepted');
  assert.equal(body.data.command,'मला एक e-commerce platform तयार करून द्या.');
});
