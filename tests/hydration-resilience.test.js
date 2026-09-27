// Regression tests for the real cause of the dashboard showing 0 projects / 0 tasks:
// store.hydrate() aborted on the first failed table, and hydrateOnce() swallowed the
// error, so the isolate stayed unhydrated forever. /api/state then reported the empty
// in-memory store as fact. Hydration must now survive per-table failures, and must not
// claim to be hydrated when a counter-driving table is missing.
import test from 'node:test';
import assert from 'node:assert/strict';

// Each test gets a fresh module graph: hydrated/noteHydrateFailure state is module-level.
let loadCounter = 0;
async function freshWorker() {
  loadCounter += 1;
  // index.js resolves './store.js' without the cache-busting query, so the store must be
  // imported the same way. Importing it with the query yields a second instance and the
  // assertions would read a different store than the one app.fetch() mutates.
  const [{ default: app }, { store }] = await Promise.all([
    import(`../src/index.js?t=${loadCounter}`),
    import('../src/store.js'),
  ]);
  store.hydrated = false;
  store.data.clear();
  store.hydrateErrors.length = 0;
  store.hydrateFailures.length = 0;
  return { app, store };
}

function makeD1({ rows = {}, failTypes = [], failOnce = [] } = {}) {
  const seen = {};
  const isEntity = (sql) => sql.replace(/\s+/g, ' ').includes('FROM entities');
  return {
    seen,
    DB: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            async all() {
              const type = args[0];
              if (!isEntity(sql)) return { results: [], meta: { rows_read: 1 } };
              seen[type] = (seen[type] ?? 0) + 1;
              if (failTypes.includes(type)) throw new Error(`D1_ERROR: table ${type} is locked`);
              if (failOnce.includes(type) && seen[type] === 1) throw new Error('D1_ERROR: request timeout');
              const list = rows[type] ?? [];
              const limit = sql.includes('LIMIT') ? Number(args[1]) : list.length;
              return { results: list.slice(0, limit).map((r) => ({ data: JSON.stringify(r) })), meta: { rows_read: list.length } };
            },
            async first() { return null; },
            async run() { return { meta: { rows_written: 0 } }; },
          }),
        };
      },
      exec: async () => ({ meta: {} }),
      batch: async () => [],
    },
  };
}

function makeEnv(DB) {
  const pending = [];
  return { DB, __pending: pending, __ctx: { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); } } };
}

const ROWS = {
  agents: [{ id: 'a1', name: 'API Agent', updatedAt: '2026-01-01' }],
  projects: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}`, updatedAt: '2026-01-01' })),
  tasks: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, projectId: `p${i % 6}`, state: 'completed', updatedAt: '2026-01-01' })),
  artifacts: [{ id: 'ar1', updatedAt: '2026-01-01' }],
  approvals: [],
  tools: [],
  command_results: [],
  memory: [],
  runs: [],
  verifications: [],
  executions: [],
  builds: [],
};

async function settle(store, env) {
  await Promise.all(env.__pending ?? []);
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (store._hydrating) { try { await store._hydrating; } catch {} return; }
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('a non-critical table failure no longer aborts hydration', async () => {
  const { DB, seen } = makeD1({ rows: ROWS, failTypes: ['command_results'] });
  const env = makeEnv(DB);
  const { app, store } = await freshWorker();
  store.configure(env);

  const hydrated = await store.hydrateOnce();
  await settle(store, env);

  assert.equal(seen.command_results > 0, true, 'the failing table was read');
  assert.equal(hydrated, true, 'a non-critical table must not block hydration');
  assert.equal(store.hydrated, true, 'the store must advertise itself hydrated');
  // The tables that do drive the dashboard are all present.
  assert.equal(store.list('projects').length, 6);
  assert.equal(store.list('tasks').length, 9);
  assert.equal(store.list('agents').length, 1);
  // And the failure is still recorded rather than swallowed.
  assert.ok(store.hydrateErrors.some((e) => e.type === 'command_results'), 'the failure must be recorded');

  const health = await (await app.fetch(new Request('https://mauli.test/api/health'), env, env.__ctx)).json();
  const sr = health.data.stateReads;
  assert.ok((sr.hydrateErrors || []).some((e) => e.type === 'command_results'), '/api/health must report it');
});

test('hydration keeps the counters working when a critical table fails', async () => {
  const { DB } = makeD1({ rows: ROWS, failTypes: ['artifacts'] });
  const env = makeEnv(DB);
  const { app, store } = await freshWorker();
  store.configure(env);

  await store.hydrateOnce();
  await settle(store, env);

  // Claiming hydrated=true with an empty artifacts table is what rendered 0 counters.
  assert.equal(store.hydrated, false, 'a critical table failure must not be called hydrated');
  assert.deepEqual(store.hydrateFailures, ['artifacts'], 'the failing critical table is named');
  assert.ok(store.hydrateErrors.some((e) => e.type === 'artifacts' && /locked/.test(e.reason)));

  // The other collections are still loaded, so a fresh page still shows real data.
  const { body } = await (async () => {
    const res = await app.fetch(new Request('https://mauli.test/api/state'), env, env.__ctx);
    return { status: res.status, body: await res.json() };
  })();
  assert.equal(body.data.degraded, true, 'the payload must be flagged degraded');
  assert.match(body.data.degradedReason, /artifacts/);
  assert.equal(body.data.projects.length, 6, 'projects still render');
  assert.equal(body.data.tasks.length, 9, 'tasks still render');
});

test('a critical table that succeeds on the second attempt counts as hydrated', async () => {
  const { DB, seen } = makeD1({ rows: ROWS, failOnce: ['tasks'] });
  const env = makeEnv(DB);
  const { store } = await freshWorker();
  store.configure(env);

  const hydrated = await store.hydrateOnce();
  await settle(store, env);

  assert.ok(seen.tasks >= 2, 'the failed read must be retried');
  assert.equal(hydrated, true, 'a recovered retry still yields a hydrated store');
  assert.equal(store.list('tasks').length, 9, 'the retry returned the real rows');
  // The transient failure must remain visible instead of being laundered into a clean run.
  assert.ok(store.hydrateErrors.some((e) => e.type === 'tasks' && e.recovered === true));
});
