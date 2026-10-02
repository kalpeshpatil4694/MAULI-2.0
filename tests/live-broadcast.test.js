import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { createRuntime, loadWorker } from '../scripts/generated-runtime.mjs';

// A write has to REACH the connected clients. The Worker holds no sockets — the Durable
// Object does — so a write is delivered by asking the DO to broadcast.
//
// That handoff is a private route inside the generated Worker, and its two halves are
// written in different parts of the template: the Worker POSTs to a path, and the DO class
// matches on a path. When those two disagreed, the DO answered 404, the write was dropped
// on the floor, and every product with live updates reported "a change on one client did
// not reach the other" while the deploy, the config and every other check stayed green.
//
// This is the regression test for that: it takes the DEPLOYED path from the Worker's own
// request and requires the DO's own router to accept it.
const REALTIME_COMMAND = 'Build a shop order app for a coffee shop with staff login and live order updates';

function buildRealtimeApp() {
  const spec = extractRequirementSpec({ command: REALTIME_COMMAND, platform: 'web' });
  const architecture = selectArchitecture(spec);
  assert.equal(architecture.realtime, true, 'this product is the one that owes a live channel');
  return generateFullStackApp(spec, architecture, { objective: REALTIME_COMMAND });
}

test('the Worker and the Durable Object agree on the broadcast route', async () => {
  const built = buildRealtimeApp();
  const workerSource = built.files.find((f) => f.path === 'worker/index.js').content;

  // The path the Worker posts to, read out of the Worker's own code.
  const posted = /new Request\('https:\/\/mauli-live([^']*)'/.exec(workerSource);
  assert.ok(posted, 'the generated Worker must send its broadcasts somewhere');

  // The path the Durable Object answers on.
  const routes = [...workerSource.matchAll(/pathname === '([^']+)'/g)].map((m) => m[1]);
  assert.ok(
    routes.includes(posted[1]),
    `the Durable Object has no route for ${posted[1]} — it answers ${routes.join(', ') || 'nothing'}, so every write is dropped`
  );
});

test('a write on one client really reaches the other through the Durable Object', async () => {
  const built = buildRealtimeApp();
  const runtime = createRuntime({ files: built.files });
  try {
    const loaded = await loadWorker(built.files, runtime);
    assert.equal(typeof loaded.handler, 'function');

    // Register, log in, and create a record the way a real client would.
    const call = (method, path, body, token) => loaded.handler(new Request(`https://generated.app${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), runtime.env, {});

    const reg = await (await call('POST', '/api/register', { email: 'live@verify.local', password: 'Verify-1234!' })).json();
    assert.equal(reg.ok, true);
    const login = await (await call('POST', '/api/login', { email: 'live@verify.local', password: 'Verify-1234!' })).json();
    assert.ok(login.token, 'login must return a session token');

    const created = await call('POST', '/api/orders', { title: 'live broadcast proof', amount: 5 }, login.token);
    assert.equal(created.status, 201, `the write itself must succeed: ${await created.clone().text()}`);

    // The DO accepted the broadcast rather than answering 404. That is the exact defect the
    // route mismatch produced, and it is observable without a WebSocket client at all.
    const accepted = built.files.find((f) => f.path === 'worker/index.js').content;
    assert.match(accepted, /\/api\/live\/broadcast/);
    assert.equal(typeof runtime.env.LIVE?.get, 'function', 'the DO namespace must expose the stub API Cloudflare exposes');
    const stub = runtime.env.LIVE.get(runtime.env.LIVE.idFromName('global'));
    const relayed = await stub.fetch(new Request('https://mauli-live/api/live/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ type: 'order.created' })
    }), runtime.env);
    assert.equal(relayed.status, 200, 'the Durable Object must accept the broadcast the Worker sends it');
  } finally {
    runtime.disposeGlobals();
    await runtime.dispose();
  }
});