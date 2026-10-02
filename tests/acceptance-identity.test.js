import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDER_COMMANDS, chainProjectId } from '../scripts/acceptance-chain.mjs';
import { waitForDeployment } from '../scripts/deploy-executor.mjs';

// THE DEPLOY JOB FAILED FOR A REASON NO TEST HAD.
//
// `L1 validation` was green and `Deploy tested revision` was red on six consecutive runs of
// main. The code was correct; the deployment boundary was not. Two defects sat there:
//
//   1. `chain_${base64url(command).slice(0,10)}` — base64url drops the characters it cannot
//      encode, so it reads from the front, and all three founder commands begin "Build a ".
//      Every product collapsed to `chain_qnvpbgqgys`. The deploy executor derives the Worker
//      name from the project id, so three products deployed to ONE Worker and the last
//      deployment silently replaced the previous one's URL.
//   2. The deploy executor returned the URL the moment `wrangler deploy` exited, which means
//      "uploaded", not "serving this version". The acceptance runner then probed whatever the
//      edge had cached — often the previous project's Worker.

test('every founder command gets its OWN project id', () => {
  const ids = FOUNDER_COMMANDS.map(chainProjectId);
  assert.equal(new Set(ids).size, FOUNDER_COMMANDS.length,
    `founder commands collided onto one project id: ${ids.join(', ')}`);
});

test('the project id is a stable, Cloudflare-safe name', () => {
  const id = chainProjectId(FOUNDER_COMMANDS[0]);
  assert.equal(id, chainProjectId(FOUNDER_COMMANDS[0]), 'the id must be stable so a repaired product redeploys to the same URL');
  assert.match(id, /^[a-z0-9-]+$/, 'the id becomes part of a Worker name and must be a valid one');
  assert.ok(id.length <= 40, 'the deploy executor truncates the Worker name at 40 characters; a longer id would collide again');
});

test('the derivation reads the whole command, not its first ten characters', () => {
  // Two commands that share a prefix used to be indistinguishable.
  const a = chainProjectId('Build a shop order app for a coffee shop with staff login and live order updates');
  const b = chainProjectId('Build a shop order app for a tea stall with staff login and live order updates');
  assert.notEqual(a, b);
});

test('an unreachable deployment is refused instead of handed to the acceptance runner', async () => {
  const ready = await waitForDeployment('http://127.0.0.1:1', { attempts: 1, intervalMs: 0 });
  assert.equal(ready.ready, false);
  assert.match(ready.reason, /did not answer on \/api\/health/);
});

test('a Worker that answers 501 on /api/live is a DEPLOYMENT defect, not a broken product', async () => {
  // The coffee-shop product requires live updates. A 501 means the LIVE Durable Object
  // binding was never deployed — reporting that as a product FAIL sends the founder to hunt
  // a bug in their own app that is actually in Cloudflare's configuration.
  const server = await startStubWorker({
    '/api/health': [200, '{"ok":true}'],
    '/api/live': [501, 'Durable Object binding not deployed']
  });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: true, attempts: 1 });
    assert.equal(ready.ready, false);
    assert.match(ready.reason, /no LIVE Durable Object binding/);
    assert.match(ready.reason, /not a product failure/);
  } finally { server.close(); }
});

test('a realtime Worker whose live route answers is ready', async () => {
  const server = await startStubWorker({
    '/api/health': [200, '{"ok":true}'],
    '/api/live': [200, '{"ok":true}']
  });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: true, attempts: 1 });
    assert.equal(ready.ready, true);
    assert.equal(ready.liveStatus, 200);
  } finally { server.close(); }
});

test('a backend product is not required to have a live route at all', async () => {
  const server = await startStubWorker({ '/api/health': [200, '{"ok":true}'] });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: false, attempts: 1 });
    assert.equal(ready.ready, true);
  } finally { server.close(); }
});

// --- tiny real HTTP stub, so the wait is exercised over a socket -----------------------

import { createServer } from 'node:http';

async function startStubWorker(routes) {
  const server = createServer((req, res) => {
    const route = routes[req.url.split('?')[0]];
    if (!route) { res.statusCode = 404; res.end('not found'); return; }
    res.statusCode = route[0];
    res.setHeader('Content-Type', 'application/json');
    res.end(route[1]);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}