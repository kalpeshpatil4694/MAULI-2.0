import test from 'node:test';
import assert from 'node:assert/strict';
// The production founder-command handler — the module worker.js calls for POST /api/command.
// These tests assert that the deployed command route is not gated on a legacy bearer token, so
// they must drive the route that is actually deployed. See tests/l1-command-api.test.js for why
// the handler is imported from its own module rather than from src/worker.js.
import { handleFounderCommand } from '../src/command-endpoint.js';

const env = { MAULI_TEST_MODE:'true', SKIP_RESULT_PERSISTENCE:'true' };

function commandRequest(headers = {}) {
  return new Request('https://mauli.test/api/command', {
    method:'POST',
    headers:{'content-type':'application/json', ...headers},
    body:JSON.stringify({command:'test'})
  });
}

test('command API accepts a command without founder API-key authorization', async () => {
  const response = await handleFounderCommand(commandRequest(), env, {});
  assert.notEqual(response.status, 401);
});

test('legacy bearer credentials do not control founder authorization', async () => {
  const response = await handleFounderCommand(commandRequest({authorization:'Bearer wrong'}), env, {});
  assert.notEqual(response.status, 401);
});
