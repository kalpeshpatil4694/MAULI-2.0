import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { dedupeAgents } from '../src/maintenance.js';
import { pruneEvents, pruneOldResults } from '../src/db.js';
import app from '../src/index.js';

// Minimal stateful D1 double. It enforces the real D1 rules that broke production:
//  - a statement may not bind more than 100 parameters
//  - the free tier allows only ~50 queries per invocation
// and it actually deletes rows so chunking/pruning behaviour is observable.
function mockD1({ entities = {}, events = [] } = {}) {
  const calls = [];
  let rowsRead = 0;
  const norm = sql => sql.replace(/\s+/g, ' ').trim();
  const rowsOf = type => (entities[type] ??= []);
  const updated = row => row.updatedAt ?? row.updated_at;
  const sortedEvents = () => [...events].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const select = (rawSql, args) => {
    const sql = norm(rawSql);
    if (sql.includes('SELECT data FROM entities WHERE type=? AND id=?')) {
      const row = rowsOf(args[0]).find(r => r.id === args[1]);
      if (!row) return [];
      return [{ data: typeof row.data === 'string' ? row.data : JSON.stringify(row) }];
    }
    if (sql.startsWith('SELECT id, data FROM entities WHERE type = ?')) {
      return rowsOf(args[0]).map(row => ({ id: row.id, data: typeof row.data === 'string' ? row.data : JSON.stringify(row) }));
    }
    if (sql.startsWith('SELECT data FROM entities WHERE type = ?')) {
      const rows = [...rowsOf(args[0])].sort((a, b) => (updated(a) < updated(b) ? 1 : -1));
      return (sql.includes('LIMIT') ? rows.slice(0, Number(args[1])) : rows).map(row => ({ data: JSON.stringify(row) }));
    }
    if (sql.includes('SELECT updated_at FROM entities WHERE type=? ORDER BY updated_at DESC LIMIT 1 OFFSET')) {
      const rows = [...rowsOf(args[0])].sort((a, b) => (updated(a) < updated(b) ? 1 : -1));
      const row = rows[Number(args[1])];
      return row ? [{ updated_at: updated(row) }] : [];
    }
    if (sql.includes('FROM (SELECT payload FROM events')) {
      const window = sortedEvents().slice(0, Number(args[0]));
      return [{ cnt: window.length, bytes: window.reduce((s, e) => s + JSON.stringify(e.payload).length, 0) }];
    }
    if (sql.includes('SELECT id,type,payload,created_at FROM events')) {
      return sortedEvents().slice(0, Number(args[0])).map(e => ({ ...e, payload: JSON.stringify(e.payload) }));
    }
    if (sql.includes('SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1 OFFSET')) {
      const row = sortedEvents()[Number(args[0])];
      return row ? [{ created_at: row.created_at }] : [];
    }
    return [];
  };

  const remove = (rawSql, args) => {
    const sql = norm(rawSql);
    if (sql.startsWith('DELETE FROM events WHERE id IN (SELECT id FROM events')) {
      const [cutoff, limit] = args;
      const stale = events.filter(e => e.created_at < cutoff).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, limit);
      for (const row of stale) events.splice(events.indexOf(row), 1);
      return stale.length;
    }
    if (sql.startsWith('DELETE FROM entities WHERE type=? AND id IN (SELECT id FROM entities')) {
      const [type, , cutoff, limit] = args;
      const rows = rowsOf(type).filter(r => updated(r) < cutoff).sort((a, b) => (updated(a) < updated(b) ? -1 : 1)).slice(0, limit);
      for (const row of rows) rowsOf(type).splice(rowsOf(type).indexOf(row), 1);
      return rows.length;
    }
    if (sql.startsWith("DELETE FROM entities WHERE type = 'agents' AND id IN")) {
      const ids = new Set(args);
      const rows = rowsOf('agents');
      for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id)) rows.splice(i, 1);
      return ids.size;
    }
    if (sql.startsWith('INSERT INTO entities')) {
      const [type, id, data, createdAt, updatedAt] = args;
      const rows = rowsOf(type);
      const index = rows.findIndex(r => r.id === id);
      const row = { id, data, createdAt, updatedAt };
      if (index >= 0) rows[index] = row; else rows.push(row);
      return 1;
    }
    return 1;
  };

  const DB = {
    prepare(rawSql) {
      calls.push(rawSql);
      const stmt = {
        _args: [],
        bind(...args) {
          assert.ok(args.length <= 100, `D1 rejects statements binding more than 100 parameters (got ${args.length})`);
          stmt._args = args;
          return stmt;
        },
        async all() {
          const results = select(rawSql, stmt._args);
          rowsRead += results.length;
          return { results };
        },
        async first() {
          const results = select(rawSql, stmt._args);
          rowsRead += results.length;
          return results[0] ?? null;
        },
        async run() {
          return { meta: { rows_written: remove(rawSql, stmt._args) } };
        }
      };
      return stmt;
    }
  };
  return { DB, calls, events, entities, rowsRead: () => rowsRead };
}

function resetStore(env) {
  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;
  store.pendingWrites = new Set();
}

function isoEvents(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    type: 'test',
    payload: { i },
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
  }));
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

test('agent dedupe cleans duplicate names even when the table has fewer than 40 rows', async () => {
  const duplicateName = 'QA Agent';
  const rich = { id: 'agent-rich', name: duplicateName, state: 'available', metadata: { learning: { testing: { attempts: 3 } } }, updatedAt: '2026-09-25T00:00:00.000Z' };
  const empty = { id: 'agent-empty', name: duplicateName, state: 'available', metadata: {}, updatedAt: '2026-09-24T00:00:00.000Z' };
  const db = mockD1({ entities: { agents: [rich, empty] } });
  const env = { DB: db.DB };
  resetStore(env);
  store.hydrated = true;
  store.data.set('agents', new Map(db.entities.agents.map(agent => [agent.id, agent])));

  const result = await dedupeAgents(env);

  assert.equal(result.deduped, 1);
  assert.equal(result.kept, 1);
  assert.deepEqual(db.entities.agents.map(agent => agent.id), ['agent-rich']);
});

test('pruneEvents deletes in a few set-based statements without scanning the table', async () => {
  const db = mockD1({ events: isoEvents(500) });
  const env = { DB: db.DB };

  const result = await pruneEvents(env, { keep: 100, batchLimit: 250, maxStatements: 3, minIntervalMs: 0 });

  assert.equal(result.pruned, 400, 'everything above the keep threshold is removed');
  assert.equal(db.events.length, 100);
  assert.ok(!db.calls.some(sql => sql.includes('COUNT(*) FROM events')), 'pruning must not full-scan the events table');
  const deletes = db.calls.filter(sql => sql.startsWith('DELETE FROM events'));
  assert.ok(deletes.length <= 3, `prune stays within the per-invocation query budget (${deletes.length} statements)`);
});

test('pruneEvents honours its cooldown via the shared D1 stamp', async () => {
  const db = mockD1({ events: isoEvents(500) });
  const env = { DB: db.DB };

  await pruneEvents(env, { keep: 100, batchLimit: 250, maxStatements: 3, minIntervalMs: 60_000 });
  const second = await pruneEvents(env, { keep: 100, batchLimit: 250, maxStatements: 3, minIntervalMs: 60_000 });

  assert.equal(second.pruned, 0);
  assert.equal(second.reason, 'cooldown', 'cooldown survives isolate recycling because it lives in D1');
});

test('pruneOldResults reclaims oversized command results and stale runs', async () => {
  const results = Array.from({ length: 500 }, (_, i) => ({ id: `res-${i}`, data: 'x'.repeat(64), updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
  const runs = Array.from({ length: 100 }, (_, i) => ({ id: `run-${i}`, updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() }));
  const db = mockD1({ entities: { command_results: results, runs } });
  const env = { DB: db.DB };

  const outcome = await pruneOldResults(env, { keep: { command_results: 300, runs: 400 }, batchLimit: 4000, maxStatements: 3, minIntervalMs: 0 });

  assert.equal(outcome.command_results, 200);
  assert.equal(db.entities.command_results.length, 300);
  assert.equal(outcome.runs, 0, 'runs below the keep threshold are untouched');
  assert.ok(!db.calls.some(sql => sql.includes('COUNT(*)')), 'pruning must not count whole tables');
});

test('GET /api/state on a cold isolate reads a bounded, cached window instead of all of D1', async () => {
  const agents = Array.from({ length: 2560 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i % 18}`, updatedAt: '2026-01-01' }));
  const tasks = Array.from({ length: 527 }, (_, i) => ({ id: `task-${i}`, projectId: `proj-${i % 74}`, state: 'completed', updatedAt: '2026-01-01' }));
  const projects = Array.from({ length: 74 }, (_, i) => ({ id: `proj-${i}`, name: `Project ${i}`, updatedAt: '2026-01-01' }));
  const approvals = Array.from({ length: 7 }, (_, i) => ({ id: `appr-${i}`, updatedAt: '2026-01-01' }));
  const db = mockD1({ entities: { agents, tasks, projects, approvals }, events: isoEvents(50) });
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
