import test from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDER_COMMANDS, chainProjectId } from '../scripts/acceptance-chain.mjs';
import { waitForDeployment, schemaHashSuffix } from '../scripts/deploy-executor.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { createRuntime, loadWorker } from '../scripts/generated-runtime.mjs';

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
  assert.match(ready.reason, /did not serve its own \/api\/health/);
});

// A freshly created workers.dev subdomain is reachable at the edge before the route serves.
// Cloudflare answers that window with its OWN error page — a real HTTP 404 that is not the
// application. The first version of this wait accepted any response and accepted it as proof
// of health, so the acceptance run probed a non-existent app and reported 404 on every route.
test('Cloudflare edge error pages are NOT a served deployment', async () => {
  const server = await startStubWorker({
    '/api/health': [404, '<!DOCTYPE html><title>Error 1001</title>DNS resolution error'],
    '/api/orders': [404, '<!DOCTYPE html><title>Error 1101</title>Worker threw exception']
  });
  try {
    const ready = await waitForDeployment(server.url, { attempts: 1, intervalMs: 0 });
    assert.equal(ready.ready, false, 'an HTML error page from the edge is not the app answering');
    assert.match(ready.reason, /edge is serving its error page/);
  } finally { server.close(); }
});

test('a 200 without the generated app JSON is refused', async () => {
  const server = await startStubWorker({ '/api/health': [200, 'OK'] });
  try {
    const ready = await waitForDeployment(server.url, { attempts: 1, intervalMs: 0 });
    assert.equal(ready.ready, false);
  } finally { server.close(); }
});

test('the wait recovers once the edge starts serving the real app', async () => {
  // First answer is Cloudflare's error page; the second is the deployment.
  let hits = 0;
  const server = await startStubWorker({
    '/api/health': () => (++hits === 1
      ? [404, '<!DOCTYPE html><title>Error 1001</title>']
      : [200, '{"ok":true,"service":"Order"}'])
  });
  try {
    const ready = await waitForDeployment(server.url, { attempts: 4, intervalMs: 5 });
    assert.equal(ready.ready, true, 'the wait must keep polling instead of accepting the first answer');
    assert.equal(ready.service, 'Order');
  } finally { server.close(); }
});

test('a Worker that answers 501 on /api/live is a DEPLOYMENT defect, not a broken product', async () => {
  // The coffee-shop product requires live updates. A 501 means the LIVE Durable Object
  // binding was never deployed — reporting that as a product FAIL sends the founder to hunt
  // a bug in their own app that is actually in Cloudflare's configuration.
  const server = await startStubWorker({
    '/api/health': [200, '{"ok":true,"service":"Order"}'],
    '/api/live': [501, '{"ok":false,"error":{"message":"Live updates are not configured for this deployment"}}']
  });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: true, attempts: 1, intervalMs: 0 });
    assert.equal(ready.ready, false);
    assert.match(ready.reason, /no LIVE Durable Object binding/);
    assert.match(ready.reason, /not a product failure/);
  } finally { server.close(); }
});

test('the live-route wait keeps polling while the new version propagates', async () => {
  // On the run that failed, the coffee-shop Worker HAD deployed with `env.LIVE (LiveConnections)`
  // in wrangler's binding table, and the acceptance still recorded "no LIVE Durable Object
  // binding". A freshly deployed Worker can keep serving the PREVIOUS version's /api/health for
  // a moment, so the single /api/live probe read 501 from the OLD Worker. A 501 is only
  // conclusive once the whole window has elapsed, so the probe belongs INSIDE the poll.
  let calls = 0;
  const server = await startStubWorker({
    '/api/health': [200, '{"ok":true,"service":"Order"}'],
    '/api/live': () => {
      calls += 1;
      return calls < 3
        ? [501, '{"ok":false,"error":{"message":"Live updates are not configured for this deployment"}}']
        : [426, 'Expected a WebSocket upgrade'];
    }
  });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: true, attempts: 8, intervalMs: 5 });
    assert.equal(ready.ready, true, 'a transient 501 from the previous version must not fail a working deployment');
    assert.equal(ready.liveStatus, 426);
    assert.ok(calls >= 3, 'the wait must have retried the live route');
  } finally { server.close(); }
});

test('a realtime Worker whose live route answers is ready', async () => {
  // The wait probes /api/live with a plain fetch, which carries no Upgrade header, so a
  // working Durable Object answers 426 "Expected a WebSocket upgrade" — not 101. Only the
  // 501 "binding not deployed" answer is a defect.
  const server = await startStubWorker({
    '/api/health': [200, '{"ok":true,"service":"Order"}'],
    '/api/live': [426, 'Expected a WebSocket upgrade']
  });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: true, attempts: 1, intervalMs: 0 });
    assert.equal(ready.ready, true);
    assert.equal(ready.liveStatus, 426);
  } finally { server.close(); }
});

test('a backend product is not required to have a live route at all', async () => {
  const server = await startStubWorker({ '/api/health': [200, '{"ok":true,"service":"Booking"}'] });
  try {
    const ready = await waitForDeployment(server.url, { requiresRealtime: false, attempts: 1, intervalMs: 0 });
    assert.equal(ready.ready, true);
    assert.equal(ready.service, 'Booking');
  } finally { server.close(); }
});

// The migration and the Worker's own request-time DDL must describe the SAME table. The
// deploy executor applies the migration to the real D1 BEFORE deploying, so a migration that
// omits a column the Worker writes creates the table without it; `CREATE TABLE IF NOT EXISTS`
// in the Worker is then a no-op, and every insert fails with `D1_ERROR: no such column: due`.
// The in-process harness never saw it because it runs the Worker's own DDL and never applies
// the migration — so the defect existed only on the deployed product.
test('the generated migration creates the due column the Worker writes', () => {
  const command = 'Build a booking app where customers book appointments and staff view the schedule';
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  const worker = built.files.find((f) => f.path === 'worker/index.js').content;
  const migration = built.files.find((f) => f.path === 'migrations/0001_init.sql').content;
  assert.match(worker, /const DUE = ", due"/, 'this product schedules, so the Worker writes the column');
  assert.match(migration, /due TEXT/, 'the migration must create every column the Worker writes');
});

test('the deployed database is versioned by the schema, so a changed migration gets a fresh one', async () => {
  // D1's runtime `ALTER TABLE` is a silent no-op through the Worker binding, a migration is
  // applied only once, and `CREATE TABLE IF NOT EXISTS` never alters an existing table. A
  // database that predates a column therefore cannot be repaired from inside the Worker, so the
  // deploy executor derives the database NAME from a digest of the generated migrations: a
  // schema change deploys alongside a database that matches it, and an unchanged schema reuses
  // the same database — so a repair keeps the founder's data.
  const root = await mkdtemp(join(tmpdir(), 'mauli-schema-'));
  const withDue = 'CREATE TABLE IF NOT EXISTS "booking" (id INTEGER PRIMARY KEY, title TEXT, due TEXT);\n';
  const withoutDue = 'CREATE TABLE IF NOT EXISTS "booking" (id INTEGER PRIMARY KEY, title TEXT);\n';
  try {
    await mkdir(join(root, 'migrations'), { recursive: true });
    await writeFile(join(root, 'migrations', '0001_init.sql'), withDue);
    const a = await schemaHashSuffix(root);
    const b = await schemaHashSuffix(root);
    assert.equal(a, b, 'the same schema must resolve to the same database, so a repair keeps its data');
    assert.match(a, /^-[0-9a-f]{10}$/, 'the suffix is a bounded digest that keeps the database name valid');
    await writeFile(join(root, 'migrations', '0001_init.sql'), withoutDue);
    assert.notEqual(a, await schemaHashSuffix(root), 'a changed migration must resolve to a different database');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// A class the config declares as a SQLite-backed Durable Object but that does not extend
// the runtime base is not a Durable Object to workerd. The deploy SUCCEEDS, wrangler's dry
// run reports env.LIVE as a bound Durable Object, and at runtime the binding is simply
// absent -- the deployed app answers /api/live with 501 while every configuration check
// passes. No static check could see this; only executing the generated Worker can.
test('the generated Durable Object extends the runtime base class it is declared as', async () => {
  const command = 'Build a shop order app for a coffee shop with staff login and live order updates';
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  const worker = built.files.find((f) => f.path === 'worker/index.js');
  const config = built.files.find((f) => f.path === 'wrangler.jsonc').content;
  const parsed = JSON.parse(config);
  assert.equal(parsed.exports.LiveConnections.type, 'durable-object');
  assert.equal(parsed.exports.LiveConnections.storage, 'sqlite');
  assert.match(worker.content, /export class LiveConnections extends DurableObject/,
    'a new_sqlite_classes DO that does not extend DurableObject deploys but never binds');

  // And it must really execute: the class has to answer the live route itself.
  const runtime = createRuntime({ files: built.files });
  try {
    const loaded = await loadWorker(built.files, runtime);
    assert.equal(typeof loaded.handler, 'function');
    assert.equal(typeof runtime.env.LIVE?.fetch, 'function', 'the DO binding must reach the Worker');
    const res = await loaded.handler(
      new Request('https://generated.app/api/live', { headers: { Upgrade: 'websocket' } }),
      runtime.env, {}
    );
    assert.equal(res.status, 101, 'the Durable Object itself must answer the live route');
  } finally {
    runtime.disposeGlobals();
    await runtime.dispose();
  }
});

// --- tiny real HTTP stub, so the wait is exercised over a socket -----------------------

import { createServer } from 'node:http';

async function startStubWorker(routes) {
  const server = createServer((req, res) => {
    const entry = routes[req.url.split('?')[0]];
    if (!entry) { res.statusCode = 404; res.end('not found'); return; }
    const [status, body] = typeof entry === 'function' ? entry() : entry;
    res.statusCode = status;
    res.setHeader('Content-Type', status === 101 ? 'application/json' : (String(body).startsWith('<') ? 'text/html' : 'application/json'));
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}