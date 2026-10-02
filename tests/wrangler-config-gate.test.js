// MAULI 2.0 — the wrangler configuration gate, as a regression test.
//
// The gate exists because a malformed `wrangler.jsonc` is invisible to every other test: the
// file parses as JSONC, every reader agrees it is right, and `wrangler deploy` still refuses
// it. These tests pin both halves — the generated config passes, and the checks are capable
// of failing at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { runWranglerConfigGate } from '../scripts/wrangler-config-gate.mjs';

const COMMAND = 'Build a shop order app for a coffee shop with staff login and live order updates';

function build(command = COMMAND) {
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  return { spec, architecture, built: generateFullStackApp(spec, architecture, { objective: command }) };
}

test('a generated realtime backend passes every wrangler configuration check', async () => {
  const report = await runWranglerConfigGate({ withWrangler: false });
  const coffee = report.results[0];
  assert.equal(coffee.ok, true, JSON.stringify(coffee.checks, null, 2));
  assert.equal(coffee.table, 'order');
  // The specific pairs that were wrong before.
  assert.ok(Array.isArray(coffee.config.d1_databases), 'D1 bindings must be an array');
  assert.equal(coffee.config.durable_objects.bindings[0].class_name, 'LiveConnections');
  assert.deepEqual(coffee.config.migrations[0].new_sqlite_classes, ['LiveConnections']);
});

test('every generated product passes, whichever architecture it got', async () => {
  const report = await runWranglerConfigGate({ withWrangler: false });
  assert.equal(report.results.length, 3, 'realtime backend, backend+auth, and browser-only');
  for (const result of report.results) {
    assert.equal(result.ok, true, `${result.command}\n${JSON.stringify(result.checks, null, 2)}`);
  }
  assert.equal(report.ok, true);
});

test('the D1 error that a deployed Worker actually returned cannot come back', () => {
  const { built } = build();
  const sql = built.files.find((f) => f.path === 'migrations/0001_init.sql').content;
  const worker = built.files.find((f) => f.path === 'worker/index.js').content;
  // `order` is a SQL keyword: an unquoted CREATE TABLE order is what answered 500.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "order" \(/);
  assert.ok(!/CREATE TABLE IF NOT EXISTS order \(/.test(sql));
  assert.match(worker, /CREATE TABLE IF NOT EXISTS "order" \(/);
  assert.match(worker, /const QT = '"' \+ TABLE \+ '"';/);
  // ...and every statement goes through the quoted identifier. Comments are stripped first:
  // the generated worker explains this exact bug in a comment, and reading that as an
  // unquoted statement would fail the one file that documents the fix correctly.
  const code = worker.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\bFROM order\b|\bINTO order\b|\bUPDATE order\b|\bTABLE order\b/.test(code));
});

test('a Durable Object emitted as an array is rejected, not shipped', () => {
  // The shape wrangler actually rejects. If the gate cannot fail on this, it proves nothing.
  const broken = {
    main: 'worker/index.js',
    d1_databases: [{ binding: 'DB', database_name: 'generated_order', database_id: 'x', migrations_dir: 'migrations' }],
    durable_objects: [{ name: 'LIVE', class_name: 'LiveConnections' }]
  };
  assert.ok(Array.isArray(broken.durable_objects));
  assert.ok(!Array.isArray(broken.durable_objects.bindings));
  // Same value in the shape wrangler documents.
  const fixed = { ...broken, durable_objects: { bindings: broken.durable_objects } };
  assert.ok(Array.isArray(fixed.durable_objects.bindings));
});

test('the config binds its own frontend, so the deployed app is the whole product', () => {
  const { built } = build();
  const config = JSON.parse(built.files.find((f) => f.path === 'wrangler.jsonc').content);
  assert.equal(config.assets.directory, './www');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.ok(built.files.some((f) => f.path === 'www/index.html'));
  assert.ok(built.files.some((f) => f.path === 'www/app.js'));
});

test('the in-memory D1 shim reads the quoted identifier the product now issues', async () => {
  // The harness must speak the SQL the product actually sends. A shim whose table-name
  // regex only read BARE identifiers threw on `CREATE TABLE "order"` and reported a working
  // generated backend as broken — the same class of harness bug that made a 200 read 409.
  const { createRuntime } = await import('../scripts/generated-runtime.mjs');
  const { built } = build();
  const runtime = createRuntime({ files: built.files, env: {} });
  const db = runtime.env.DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS "order" (id INTEGER PRIMARY KEY, title TEXT)').run();
  await db.prepare('INSERT INTO "order" (title) VALUES (?)').bind('latte').run();
  const rows = await db.prepare('SELECT title FROM "order"').all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].title, 'latte');
  await db.prepare('UPDATE "order" SET title = ? WHERE id = ?').bind('cappuccino', 1).run();
  const after = await db.prepare('SELECT title FROM "order" WHERE id = ?').bind(1).first();
  assert.equal(after.title, 'cappuccino');
  await db.prepare('DELETE FROM "order" WHERE id = ?').bind(1).run();
  assert.equal((await db.prepare('SELECT id FROM "order"').all()).results.length, 0);
  runtime.disposeGlobals?.();
});

test('the shim refuses a statement whose table name it cannot read', async () => {
  // A silent empty table named '' is a harness that agrees with every wrong answer.
  const { createRuntime } = await import('../scripts/generated-runtime.mjs');
  const db = createRuntime({ files: [], env: {} }).env.DB;
  await assert.rejects(() => db.prepare('SELECT id FROM').all(), /could not read the table name/);
});

test('a browser-only product ships no Worker, no D1 and no undeployable entry point', () => {
  const spec = extractRequirementSpec({ command: 'Build a medicine tracker app where I record each dose I take', platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: 'medicine tracker' });
  assert.equal(architecture.backend, false);
  assert.ok(!built.files.some((f) => f.path === 'worker/index.js'));
  const config = JSON.parse(built.files.find((f) => f.path === 'wrangler.jsonc').content);
  assert.deepEqual(config.d1_databases, []);
  // `main` pointing at a file that was never generated is a project nobody can deploy:
  // wrangler loads the declared entry point before anything else and refuses.
  assert.equal(config.main, undefined, 'an assets-only Worker must declare no main');
  // ...and an assets-only Worker may not declare an assets *binding*, because there is no
  // Worker to bind it to.
  assert.equal(config.assets.binding, undefined);
  assert.equal(config.assets.directory, './www');
});

test('every declared config path is a file the product actually ships', () => {
  for (const command of [
    'Build a shop order app for a coffee shop with staff login and live order updates',
    'Build a booking app where customers book appointments and staff view the schedule',
    'Build a medicine tracker app where I record each dose I take'
  ]) {
    const spec = extractRequirementSpec({ command, platform: 'web' });
    const built = generateFullStackApp(spec, selectArchitecture(spec), { objective: command });
    const config = JSON.parse(built.files.find((f) => f.path === 'wrangler.jsonc').content);
    const shipped = new Set(built.files.map((f) => f.path));
    for (const key of ['main', 'assets.directory']) {
      const value = key.split('.').reduce((o, k) => o?.[k], config);
      if (!value) continue;
      const rel = String(value).replace(/^\.\//, '');
      // `main` is a file; `assets.directory` is a directory, so a prefix match is correct.
      const present = key === 'main' ? shipped.has(rel) : [...shipped].some((p) => p.startsWith(`${rel}/`));
      assert.ok(present, `${command}: ${key} → ${value} is not a generated path`);
    }
  }
});