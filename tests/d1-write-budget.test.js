import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { ensureBuiltinTools, listTools } from '../src/tools.js';
import { seedAgents } from '../src/agents.js';
import { pruneEvents } from '../src/db.js';
import { recordD1Write, d1WriteSourcesSnapshot } from '../src/d1-quota.js';

// Minimal D1 double that counts rows_written, so tests can assert exactly how many
// rows each code path spends against the 100K/day free-tier budget.
function countingD1({ events = [] } = {}) {
  const inserts = { entities: 0, events: 0 };
  const entities = new Map(); // `${type}:${id}` -> row
  const norm = sql => sql.replace(/\s+/g, ' ').trim();
  const stmt = rawSql => {
    let args = [];
    return {
      bind(...a) { args = a; return this; },
      async all() { return { results: [], meta: { rows_read: 0 } }; },
      async first() { return null; },
      async run() {
        const sql = norm(rawSql);
        if (sql.startsWith('INSERT INTO entities')) {
          inserts.entities++;
          entities.set(`${args[0]}:${args[1]}`, { type: args[0], id: args[1], data: args[2], created_at: args[3], updated_at: args[4] });
          return { meta: { rows_written: 1 } };
        }
        if (sql.startsWith('INSERT INTO events')) {
          inserts.events++;
          events.push({ id: args[0], type: args[1], payload: args[2], created_at: args[3] });
          return { meta: { rows_written: 1 } };
        }
        return { meta: { rows_written: 0 } };
      }
    };
  };
  return { DB: { prepare: stmt }, inserts, entities, events };
}

function resetStore(env) {
  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;
  store.pendingWrites = new Set();
  store.persistenceErrors = [];
}

test('re-registering the built-in tools on a warm isolate writes no D1 rows', async () => {
  const db = countingD1();
  const env = { DB: db.DB };
  resetStore(env);

  ensureBuiltinTools();
  await store.flush();
  const firstPass = db.inserts.entities;
  assert.ok(firstPass >= 30, `expected the full tool registry to be persisted once (got ${firstPass})`);

  // Production path: every isolate start runs hydrate() -> ensureBuiltinTools() again.
  // registeredAt must stay stable or every tool row looks "changed" and gets re-upserted
  // (~32 rows_written per isolate start, one of the biggest daily write amplifiers).
  ensureBuiltinTools();
  ensureBuiltinTools();
  await store.flush();
  assert.equal(db.inserts.entities, firstPass, 'unchanged tool re-registration must not spend rows_written');
  assert.ok(listTools().length >= 30, 'tool registry is intact');
});

test('telemetry events whose entity already has a row stay out of D1', async () => {
  const db = countingD1();
  const env = { DB: db.DB };
  resetStore(env);

  store.addEvent('agent.updated', { id: 'agent-builtin-qa-agent' });
  store.addEvent('execution.started', { id: 'run_1' });
  store.addEvent('memory.created', { id: 'mem_1' });
  store.addEvent('chat.user_message', { messageId: 'msg_1' });
  await store.flush();
  assert.equal(db.inserts.events, 0, 'redundant telemetry events must not be persisted');
  assert.equal(store.recentEvents(10).length, 4, 'the in-memory live feed still receives them');

  store.addEvent('task.completed', { id: 'task_1' });
  store.addEvent('command.completed', { runId: 'command_1' });
  await store.flush();
  assert.equal(db.inserts.events, 2, 'lifecycle audit events are still persisted');
});

test('a second seedAgents inside the heartbeat window writes nothing', async () => {
  const db = countingD1();
  const env = { DB: db.DB };
  resetStore(env);
  store.hydrated = true;

  seedAgents();
  await store.flush();
  const firstPass = db.inserts.entities;
  assert.equal(firstPass, 18, 'first hydration persists the 18 built-in agents');

  seedAgents();
  await store.flush();
  assert.equal(db.inserts.entities, firstPass, 'fresh heartbeats must not be rewritten');
});

test('write accounting attributes rows to their source', () => {
  const env = {};
  recordD1Write(env, 4, 'entity:tasks');
  recordD1Write(env, 2, 'event:task.completed');
  recordD1Write(env, 3, 'entity:tasks');

  const snapshot = d1WriteSourcesSnapshot(env);
  assert.equal(snapshot.isolateWrites, 9);
  const tasks = snapshot.top.find(entry => entry.source === 'entity:tasks');
  assert.equal(tasks?.rows, 7, 'rows accumulate per source');
  assert.ok(snapshot.top.some(entry => entry.source === 'event:task.completed' && entry.rows === 2));
});

// Functional guard on the prune write budget: deletes count against rows_written, so
// a single maintenance run may never consume most of the 100K/day allowance.
test('pruneEvents stays inside its daily rows_written cap', async () => {
  const now = Date.now();
  const events = Array.from({ length: 20000 }, (_, i) => ({
    id: `evt-${i}`,
    type: 'test',
    payload: {},
    created_at: new Date(now - (20000 - i) * 1000).toISOString()
  }));
  const entities = new Map();
  const norm = sql => sql.replace(/\s+/g, ' ').trim();
  const DB = {
    prepare(rawSql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() {
          const sql = norm(rawSql);
          if (sql.includes('SELECT data FROM entities WHERE type=? AND id=?')) {
            const row = entities.get(`${args[0]}:${args[1]}`);
            return row ? { data: row.data } : null;
          }
          if (sql.includes('SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1 OFFSET')) {
            const sorted = [...events].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            const row = sorted[Number(args[0])];
            return row ? { created_at: row.created_at } : null;
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          const sql = norm(rawSql);
          if (sql.startsWith('INSERT INTO entities')) {
            entities.set(`${args[0]}:${args[1]}`, { data: args[2] });
            return { meta: { rows_written: 1 } };
          }
          if (sql.startsWith('DELETE FROM events WHERE id IN (SELECT id FROM events')) {
            const [cutoff, limit] = args;
            const stale = events.filter(e => e.created_at < cutoff).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).slice(0, limit);
            for (const row of stale) events.splice(events.indexOf(row), 1);
            return { meta: { rows_written: stale.length } };
          }
          return { meta: { rows_written: 0 } };
        }
      };
      return stmt;
    }
  };

  const result = await pruneEvents({ DB });
  assert.equal(result.pruned, 12000, 'the daily delete budget stops the run');
  assert.equal(events.length, 8000, 'the excess above keep is removed up to the cap only');
  assert.ok(result.pruned <= 12000, 'maintenance can never spend 80% of the write budget in one day');
});
