import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { createRuntime, loadWorker, ShimSocket } from '../scripts/generated-runtime.mjs';

// A write has to REACH the connected clients.
//
// The Worker holds no sockets — the Durable Object does — so a write is delivered by asking
// the DO to broadcast. That handoff has broken in three different ways, and every one of them
// had the same symptom to the founder: the live channel looked connected and delivered
// nothing, while the deploy succeeded and every configuration check stayed green.
//
//   1. It used to travel over a private HTTP route written in TWO places in the template
//      (`https://mauli-live/broadcast` posted by the Worker, `/api/live/broadcast` matched by
//      the DO). When they disagreed the DO answered 404 and the write was dropped. It is now
//      a direct method call, so there is no route left to disagree about — and the test below
//      pins the delivery itself rather than the spelling of a path.
//   2. The journey built its OWN Durable Object instance while the write broadcast through
//      the runtime's. Two instances, two socket sets.
//   3. A closed socket stayed in the DO's set, because nothing invoked its webSocketClose.
const REALTIME_COMMAND = 'Build a shop order app for a coffee shop with staff login and live order updates';

function buildRealtimeApp() {
  const spec = extractRequirementSpec({ command: REALTIME_COMMAND, platform: 'web' });
  const architecture = selectArchitecture(spec);
  assert.equal(architecture.realtime, true, 'this product is the one that owes a live channel');
  return generateFullStackApp(spec, architecture, { objective: REALTIME_COMMAND });
}

/**
 * The half the Durable Object actually broadcasts on, which is not the half it returns.
 *
 * The generated Durable Object owns its own client set (`this.clients`) and registers the
 * SERVER half of the pair while returning the CLIENT half, so the observable socket is the
 * registered one — the ctx set, when the DO used the hibernation API, is the same list.
 */
function broadcastHalf(stub, response) {
  const own = stub?.clients instanceof Set ? [...stub.clients] : null;
  const registered = own ?? (typeof stub?.ctx?.getWebSockets === 'function' ? stub.ctx.getWebSockets() : []);
  return registered.find((s) => s !== response?.webSocket) ?? response?.webSocket ?? null;
}

/** Every socket the Durable Object currently holds. */
function liveSockets(stub) {
  if (stub?.clients instanceof Set) return [...stub.clients];
  return typeof stub?.ctx?.getWebSockets === 'function' ? stub.ctx.getWebSockets() : [];
}

async function openLiveClient(built, runtime, handler) {
  const response = await handler(
    new Request('https://generated.app/api/live', { headers: { Upgrade: 'websocket' } }),
    runtime.env, {}
  );
  const stub = runtime.env.LIVE.get(runtime.env.LIVE.idFromName('global'));
  return { response, stub, socket: broadcastHalf(stub, response) };
}

test('a write on one client really reaches the other through the Durable Object', async () => {
  const built = buildRealtimeApp();
  const runtime = createRuntime({ files: built.files });
  try {
    const loaded = await loadWorker(built.files, runtime);
    const handler = loaded.handler;
    const call = (method, path, body, token) => handler(new Request(`https://generated.app${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), runtime.env, {});

    // Two independent clients, connected BEFORE the write, exactly as the real-time
    // requirement is proven.
    const a = await openLiveClient(built, runtime, handler);
    const b = await openLiveClient(built, runtime, handler);
    assert.equal(a.response.status, 101, 'the live route must upgrade to a WebSocket');
    assert.equal(b.response.status, 101, 'both clients must upgrade');
    assert.ok(a.socket && b.socket, 'both clients must be observable');

    await call('POST', '/api/register', { email: 'live@verify.local', password: 'Verify-1234!' });
    const login = await (await call('POST', '/api/login', { email: 'live@verify.local', password: 'Verify-1234!' })).json();
    assert.ok(login.token, 'login must return a session token');

    const created = await call('POST', '/api/orders', { title: 'live broadcast proof', amount: 5 }, login.token);
    assert.equal(created.status, 201, 'the write itself must succeed');

    const onA = a.socket.messages.filter((m) => String(m).includes('live broadcast proof'));
    const onB = b.socket.messages.filter((m) => String(m).includes('live broadcast proof'));
    assert.equal(onA.length, 1, 'the first client must receive the write exactly once');
    assert.equal(onB.length, 1, 'the second client must receive the write exactly once');
  } finally {
    runtime.disposeGlobals();
    await runtime.dispose();
  }
});

// A socket's listeners ACCUMULATE. Storing one handler per type silently discarded every
// listener but the last, so a Durable Object registering both a message and a close handler
// kept only the close one and never heard the client it was serving.
test('socket listeners accumulate instead of overwriting each other', () => {
  const socket = new ShimSocket('client');
  const seen = [];
  socket.addEventListener('message', () => seen.push('first'));
  socket.addEventListener('message', () => seen.push('second'));
  socket.receive('hello');
  assert.deepEqual(seen, ['first', 'second'], 'a second message listener must not erase the first');
});

// A hibernation Durable Object is told when one of its sockets closes and drops it. Without
// that, a disconnected client keeps receiving broadcasts into a dead socket and the
// reconnected client appears to receive nothing — "reconnecting stopped working".
test('a closed socket is dropped from the Durable Object socket set', async () => {
  const built = buildRealtimeApp();
  const runtime = createRuntime({ files: built.files });
  try {
    const loaded = await loadWorker(built.files, runtime);
    const { stub } = await openLiveClient(built, runtime, loaded.handler);
    assert.equal(liveSockets(stub).length, 1, 'the connected client is registered');

    const registered = liveSockets(stub)[0];
    registered.close();
    assert.equal(liveSockets(stub).length, 0,
      'a closed client must leave the broadcast set, or every later write goes into a dead socket');
  } finally {
    runtime.disposeGlobals();
    await runtime.dispose();
  }
});

// Cloudflare gives every client of one Durable Object id exactly ONE instance. The journey
// used to build a private `new LiveConnections(...)`, which put its sockets in an instance
// the write never broadcast through.
test('every client of one Durable Object id reaches the same instance', async () => {
  const built = buildRealtimeApp();
  const runtime = createRuntime({ files: built.files });
  try {
    await loadWorker(built.files, runtime);
    const a = runtime.env.LIVE.get(runtime.env.LIVE.idFromName('global'));
    const b = runtime.env.LIVE.get(runtime.env.LIVE.idFromName('global'));
    assert.equal(a, b, 'two clients of one id must reach the same instance');
  } finally {
    runtime.disposeGlobals();
    await runtime.dispose();
  }
});