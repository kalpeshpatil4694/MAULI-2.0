// Regression: a stale isolate must not roll back newer state.
//
// MAULI runs many isolates. Each hydrates its own copy of a row and writes the WHOLE row
// back on every change, so the row is last-writer-wins on content, not on recency. Live
// symptom (2026-09-30): a command reached 5/13 tasks completed, then dropped back to 0/13 —
// an isolate that had hydrated the task list earlier wrote its old copy back over the
// completed rows, the tasks were re-claimed, and the project never converged.
//
// d1Put therefore guards the UPDATE with the version the writer actually read. A stale
// writer is rejected (rows_written 0) and the newer truth survives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { d1Put } from '../src/db.js';
import { store } from '../src/store.js';

// Minimal D1 double that models the upsert + compare-and-set semantics the SQL relies on.
// It only understands what d1Put issues: INSERT ... ON CONFLICT DO UPDATE [WHERE ...].
function fakeD1() {
  const rows = new Map();
  const calls = [];
  return {
    rows, calls,
    prepare(sql) {
      return {
        bind(...b) {
          return {
            async run() {
              calls.push(sql);
              const [type, id, data, createdAt, updatedAt, expected] = b;
              const key = `${type}::${id}`;
              const existing = rows.get(key);
              if (!existing) { rows.set(key, { data, updated_at: updatedAt }); return { meta: { rows_written: 1 } }; }
              if (expected !== undefined && existing.updated_at !== expected) {
                // The WHERE on DO UPDATE did not match: the row moved on. 0 rows written.
                return { meta: { rows_written: 0 } };
              }
              rows.set(key, { data, updated_at: updatedAt });
              return { meta: { rows_written: 1 } };
            },
          };
        },
      };
    },
  };
}

const env = fakeD1 ? { DB: fakeD1() } : null;

test('a write built on the current version lands', async () => {
  const db = fakeD1();
  const first = await d1Put({ DB: db }, 'tasks', { id: 't1', state: 'queued' });
  const second = await d1Put({ DB: db }, 'tasks', { id: 't1', state: 'working' }, { expectedUpdatedAt: first.updatedAt });
  assert.ok(!second._d1WriteStale, 'a fresh write must not be treated as stale');
  assert.equal(JSON.parse(db.rows.get('tasks::t1').data).state, 'working');
});

test('a stale write cannot roll a row back to an older state', async () => {
  const db = fakeD1();
  // Two isolates hydrate the same row at the same version.
  const readA = await d1Put({ DB: db }, 'tasks', { id: 't1', state: 'queued' });
  const isolateBVersion = readA.updatedAt;

  // Isolate A completes the task.
  await d1Put({ DB: db }, 'tasks', { id: 't1', state: 'completed' }, { expectedUpdatedAt: readA.updatedAt });

  // Isolate B, still holding its stale copy, writes it back. This must be rejected.
  const staleWrite = await d1Put({ DB: db }, 'tasks', { id: 't1', state: 'queued' }, { expectedUpdatedAt: isolateBVersion });
  assert.equal(staleWrite._d1WriteStale, true, 'the stale write must be reported as rejected');
  assert.equal(JSON.parse(db.rows.get('tasks::t1').data).state, 'completed',
    'the completed state must survive a stale write from another isolate');
});

test('a new row is always inserted, with no version to compare against', async () => {
  const db = fakeD1();
  const created = await d1Put({ DB: db }, 'projects', { id: 'p1', state: 'queued' }, { expectedUpdatedAt: null });
  assert.ok(!created._d1WriteStale);
  assert.equal(JSON.parse(db.rows.get('projects::p1').data).state, 'queued');
});

test('store.put forwards the version it read so the write can be rejected', async () => {
  const db = fakeD1();
  store.configure({ DB: db });
  store.data = new Map();
  store.events = [];

  const first = store.put('tasks', { id: 't2', state: 'queued' });
  await Promise.all([...store.pendingWrites]);
  const updated = store.put('tasks', { ...first, state: 'working' });
  await Promise.all([...store.pendingWrites]);
  assert.equal(JSON.parse(db.rows.get('tasks::t2').data).state, 'working');

  // Simulate a second isolate holding an older copy and writing it back into this store.
  const stale = { ...first, state: 'queued' };
  const staleBucket = store.data.get('tasks');
  staleBucket.set('t2', stale);
  store.put('tasks', { ...stale, state: 'queued' });
  await Promise.all([...store.pendingWrites]);

  assert.equal(JSON.parse(db.rows.get('tasks::t2').data).state, 'working',
    'D1 must keep the newer state even when a stale copy is written through the store');
  store.configure(null);
});
