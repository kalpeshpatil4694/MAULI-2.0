import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { pruneEvents } from '../src/db.js';
import app from '../src/index.js';

// Minimal D1 double. It also enforces the real D1 rule that a statement may not bind
// more than 100 parameters, so a chunked-delete regression fails loudly.
function mockD1({ entities = {}, events = [] } = {}) {
  const calls = [];
  let rowsRead = 0;
  const sortedEvents = () => [...events].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const select = (sql, args) => {
    if (sql.includes('FROM entities WHERE type = ?')) {
      const rows = entities[args[0]] ?? [];
      const limited = sql.includes('LIMIT') ? rows.slice(0, Number(args[1]) || rows.length) : rows;
      return limited.map(data => ({ data: JSON.stringify(data) }));
    }
    if (sql.includes('FROM (SELECT payload FROM events')) {
      const limit = Number(args[0]);
      const window = sortedEvents().slice(0, limit);
      return [{ cnt: window.length, bytes: window.reduce((s, e) => s + JSON.stringify(e.payload).length, 0) }];
    }
    if (sql.includes('SELECT id,type,payload,created_at FROM events')) {
      return sortedEvents().slice(0, Number(args[0])).map(e => ({ ...e, payload: JSON.stringify(e.payload) }));
    }
    if (sql.includes('SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1 OFFSET')) {
      const row = sortedEvents()[Number(args[0])];
      return row ? [{ created_at: row.created_at }] : [];
    }
    if (sql.includes('SELECT id FROM events WHERE created_at <')) {
      const stale = events.filter(e => e.created_at < args[0]).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return stale.slice(0, Number(args[1])).map(e => ({ id: e.id }));
    }
    return [];
  };
  const DB = {
    prepare(sql) {
      calls.push(sql);
      const stmt = {
        _args: [],
        bind(...args) {
          assert.ok(args.length <= 100, `D1 rejects statements with more than 100 bound parameters (got ${args.length}): ${sql.slice(0, 80)}`);
          stmt._args = args;
          return stmt;
        },
        async all() {
          const results = select(sql, stmt._args);
          rowsRead += results.length;
          return { results };
        },
        async first() {
          const results = select(sql, stmt._args);
          rowsRead += results.length;
          return results[0] ?? null;
        },
        async run() {
          return { meta: { rows_written: 1 } };
        }
      };
      return stmt;
    }
  };
  return { DB, calls, rowsRead: () => rowsRead };
}

function resetStore(env) {
  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;
  store.pendingWrites = new Set();
}

test('cold isolate seeding never inserts duplicate agent rows into D1', () => {
  const db = mockD1({ entities: { agents: [] } });
  const env = { DB: db.DB };
  resetStore(env);

  seedAgents();
  seedAgents();

  const inserts = db.calls.filter(sql => sql.startsWith('INSERT INTO entities'));
  assert.equal(inserts.length, 0, 'seeding before hydration must not write agent rows to D1');
  assert.equal(store.list('agents').length, 18);
  assert.ok(store.list('agents').every(agent => agent.id.startsWith('agent-builtin-')), 'built-in agents use deterministic ids so re-seeding upserts instead of duplicating');
});

test('seeding an already-hydrated store reuses the existing D1 agent identity', () => {
  const existing = store.list('agents').map((agent, index) => ({ ...agent, id: `agent-old-${index}` }));
  const db = mockD1({ entities: { agents: existing } });
  const env = { DB: db.DB };
  resetStore(env);
  store.hydrated = true;
  for (const agent of existing) store.data.set('agents', (store.data.get('agents') ?? new Map()).set(agent.id, agent));

  seedAgents();

  assert.equal(store.list('agents').length, 18, 'no new agent rows when every built-in already exists');
  assert.ok(store.list('agents').every(agent => agent.id.startsWith('agent-old-')), 'existing ids are kept');
});

test('pruneEvents bounds its scan and chunks deletes under the parameter limit', async () => {
  const events = Array.from({ length: 500 }, (_, i) => ({
    id: `evt-${i}`,
    type: 'test',
    payload: { i },
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
  }));
  const db = mockD1({ entities: {}, events });
  const env = { DB: db.DB };

  const result = await pruneEvents(env, { keep: 100, batchLimit: 250, minIntervalMs: 0 });

  assert.equal(result.pruned, 250);
  assert.ok(!db.calls.some(sql => sql.includes('COUNT(*) FROM events')), 'pruning must not full-scan the events table');
  const deletes = db.calls.filter(sql => sql.startsWith('DELETE FROM events'));
  assert.ok(deletes.length > 1, 'deletes are chunked rather than one oversized IN list');
});

test('GET /api/state on a cold isolate reads a bounded, cached window instead of all of D1', async () => {
  const agents = Array.from({ length: 2560 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i % 18}`, updatedAt: '2026-01-01' }));
  const tasks = Array.from({ length: 527 }, (_, i) => ({ id: `task-${i}`, projectId: `proj-${i % 74}`, state: 'completed' }));
  const projects = Array.from({ length: 74 }, (_, i) => ({ id: `proj-${i}`, name: `Project ${i}` }));
  const approvals = Array.from({ length: 7 }, (_, i) => ({ id: `appr-${i}` }));
  const events = Array.from({ length: 50 }, (_, i) => ({ id: `evt-${i}`, type: 't', payload: {}, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
  const db = mockD1({ entities: { agents, tasks, projects, approvals }, events });
  const env = { DB: db.DB };
  resetStore(env);

  const ctx = { waitUntil() {} };
  const first = await app.fetch(new Request('https://mauli.test/api/state'), env, ctx);
  const body = await first.json();
  assert.equal(first.status, 200);
  assert.ok(body.data.agents.length <= 200, 'agent list is capped');
  assert.ok(body.data.tasks.length <= 600, 'task list is capped');

  const afterFirst = db.rowsRead();
  await app.fetch(new Request('https://mauli.test/api/state'), env, ctx);
  assert.equal(db.rowsRead(), afterFirst, 'a repeat poll inside the cache window reads no extra rows');

  // The old code re-read every row of every table on every 60s poll (~3.2K rows => the
  // whole 5M/day budget). Bounded reads must stay an order of magnitude below that.
  assert.ok(db.rowsRead() < 2000, `cold-isolate state reads stay bounded (read ${db.rowsRead()} rows)`);
});
