// Proves the state-read diagnostics are functional, not just present: when D1 rejects a
// query the worker must record the real error, expose it on /api/health, and still serve
// a usable (degraded) payload rather than an empty one.
import test from 'node:test';
import assert from 'node:assert/strict';

// The worker keeps its state snapshot in a module-level cache, so every test loads a
// fresh copy of the module graph. Otherwise one test's snapshot satisfies the next.
let loadCounter = 0;
async function freshWorker() {
  loadCounter += 1;
  const [{ default: app }, { store }] = await Promise.all([
    import(`../src/index.js?t=${loadCounter}`),
    // Without the query: index.js resolves './store.js' bare, so a queried import would
    // create a second store that app.fetch() never sees.
    import('../src/store.js'),
  ]);
  store.hydrated = false;
  store.data.clear();
  store.hydrateErrors.length = 0;
  store.hydrateFailures.length = 0;
  return { app, store };
}

const isEntitySelect = (sql) => sql.replace(/\s+/g, ' ').includes('FROM entities');

// Minimal D1 double. `failOnce` throws on the first matching read, so a test can prove
// the retry path as well as the unrecovered path.
function makeD1({ rows = {}, failTypes = [], failOnce = [] } = {}) {
  const seen = {};
  return {
    seen,
    DB: {
      prepare(sql) {
        return {
          bind: (...args) => ({
            async all() {
              const type = args[0];
              if (!isEntitySelect(sql)) return { results: [], meta: { rows_read: 1 } };
              seen[type] = (seen[type] ?? 0) + 1;
              if (failTypes.includes(type)) throw new Error('D1_ERROR: too many subrequests: SQLITE_ERROR');
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

async function hit(app, env, path = '/api/state') {
  const res = await app.fetch(new Request(`https://mauli.test${path}`), env, env.__ctx ?? { waitUntil() {} });
  return { status: res.status, body: await res.json() };
}

// Hydration runs in the background via ctx.waitUntil, so a health check taken
// immediately after /api/state can still land mid-hydration. Settle it first.
async function settleHydration(store, env, timeoutMs = 4000) {
  await Promise.all(env.__pending ?? []);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (store.hydrated || store.hydrateErrors.length || store.hydrateFailures.length) return;
    if (store._hydrating) { try { await store._hydrating; } catch {} return; }
    await new Promise((r) => setTimeout(r, 20));
  }
}

function makeEnv(DB) {
  const pending = [];
  return { DB, __pending: pending, __ctx: { waitUntil(p) { pending.push(Promise.resolve(p).catch(() => {})); } } };
}

const BASE_ROWS = {
  tasks: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, projectId: 'p1', state: 'completed', updatedAt: '2026-01-01' })),
  agents: [{ id: 'a1', name: 'API Agent', updatedAt: '2026-01-01' }],
  artifacts: [{ id: 'ar1', updatedAt: '2026-01-01' }],
  projects: [{ id: 'p1', name: 'P', updatedAt: '2026-01-01' }],
};

test('a D1 read failure is recorded, reported on /api/health, and never blanks the payload', async () => {
  const { DB } = makeD1({ rows: BASE_ROWS, failTypes: ['projects'] });
  const env = makeEnv(DB);
  const { app } = await freshWorker();

  const { status, body } = await hit(app, env);
  assert.equal(status, 200, 'a failed read must not turn into a 500');

  const data = body.data;
  assert.equal(data.degraded, true, 'the payload must be flagged degraded');
  assert.equal(data.degradedReason, 'projects', 'the failing collection must be named');
  // The collections that did read must still be served.
  assert.equal(data.tasks.length, 5);
  assert.equal(data.agents.length, 1);
  assert.equal(data.artifacts.length, 1);
  assert.equal(data.projects.length, 0, 'the failed collection is empty but flagged, not silently zero');

  const { body: health } = await hit(app, env, '/api/health');
  const sr = health.data.stateReads;
  assert.ok(sr.degradedCount > 0, 'the failure must be counted');
  assert.match(sr.lastReason, /projects: D1_ERROR: too many subrequests/);
  assert.equal(sr.readFailures.projects.recovered, false, 'an unrecovered read is not a retry recovery');
  assert.match(sr.readFailures.projects.reason, /D1_ERROR/);
});

test('a read that fails once and succeeds on retry is recorded as recovered, not hidden', async () => {
  const { DB, seen } = makeD1({ rows: BASE_ROWS, failOnce: ['tasks'] });
  const env = makeEnv(DB);
  const { app, store } = await freshWorker();

  const { status, body } = await hit(app, env);
  assert.equal(status, 200);
  assert.ok(seen.tasks >= 1, 'the tasks read must have run');
  assert.equal(body.data.degraded, false, 'a recovered retry yields a healthy payload');
  assert.equal(body.data.tasks.length, 5, 'the retry returned real data');
  assert.equal(body.data.projects.length, 1);

  await settleHydration(store, env);

  const { body: health } = await hit(app, env, '/api/health');
  const sr = health.data.stateReads;
  // The transient failure must not vanish: it is recorded either by the snapshot retry
  // (recoveredCount) or by the hydration retry (hydrateErrors), never swallowed.
  const recovered = Number(sr.recoveredCount || 0)
    + (sr.hydrateErrors || []).filter((e) => e.recovered).length;
  assert.ok(recovered >= 1, 'the transient failure must remain visible');
  const recorded = [
    sr.readFailures.tasks,
    ...(sr.hydrateErrors || []).filter((e) => e.type === 'tasks'),
  ];
  assert.ok(recorded.some((r) => r && /request timeout/.test(r.reason)), 'the real D1 message must be kept');
  assert.ok(
    (sr.readFailures.tasks?.recovered === true)
      || (sr.hydrateErrors || []).some((e) => e.type === 'tasks' && e.recovered),
    'a recovered read must be labelled as recovered, not as a clean success'
  );
});
