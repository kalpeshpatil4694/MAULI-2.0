import test from 'node:test';
import assert from 'node:assert/strict';
// The PRODUCTION founder-command handler.
//
// It is imported from its own module, not from src/worker.js, because worker.js re-exports the
// Durable Object class and therefore cannot be imported under Node at all (`cloudflare:workers`
// has no Node implementation). src/command-endpoint.js is the exact module worker.js calls, so
// importing it exercises the handler that runs in production rather than a look-alike.
//
// This file used to import src/index.js and assert a 201 with an inline result. That handler
// was unreachable in production — worker.js intercepts POST /api/command before delegating — so
// the suite was verifying a program the founder never ran. It has been removed.
import { handleFounderCommand } from '../src/command-endpoint.js';

const testEnv = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };

function commandRequest(body, headers = {}) {
  return new Request('https://mauli.test/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('the production command endpoint queues the founder command and hands off to the scheduler', async () => {
  let schedulerHandoffs = 0;
  const ctx = { waitUntil() { schedulerHandoffs += 1; } };

  const response = await handleFounderCommand(
    commandRequest({ command: 'Create a simple e-commerce platform' }),
    testEnv,
    ctx
  );
  const body = await response.json();

  assert.equal(response.status, 202, `a queued command is 202 Accepted, got ${response.status}`);
  assert.equal(body?.data?.result?.status, 'queued');
  assert.equal(body?.data?.result?.execution, 'scheduler', 'execution must be owned by the scheduler');
  assert.ok(body?.data?.result?.runId, 'a durable run id must be issued');
  assert.ok(body?.data?.result?.project?.id, 'a project must be created');
  assert.equal(body?.data?.resultFile?.skipped, true, 'isolated test must skip GitHub Result persistence');
  assert.equal(body?.data?.resultFile?.testMode, true, 'isolated test must be marked as test mode');
  assert.equal(schedulerHandoffs, 1, 'a queued command must hand off to the scheduler');
});

test('the production command endpoint ignores legacy founder API-key headers', async () => {
  const response = await handleFounderCommand(
    commandRequest({ command: 'Create a simple e-commerce platform' }, { authorization: 'Bearer legacy-key' }),
    testEnv,
    {}
  );
  assert.notEqual(response.status, 401);
});
