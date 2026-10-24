// The account's D1 meters are shared by every Worker isolate, and the dashboard used to spend
// them as if they were free:
//
//   • the Projects table's task counters ran SIX correlated COUNT(*) subqueries per project on
//     every 5 s dashboard tick (measured live: 5.08M rows read against a 5M/day allowance);
//   • a project screen loaded EVERY task row (up to 1500) to show one project's dozen;
//   • writes across isolates were guarded only by a per-isolate counter, so the account meter
//     read 117.47k / 100k while every isolate still believed it had budget.
//
// These tests pin the replacements: one grouped read (or none at all when this isolate already
// holds the table), a per-project indexed read, and a shared daily ledger that refuses optional
// traffic before the hard ceiling is reached instead of after everything starts failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { projectTaskSummary, __resetProjectTaskSummaryCache, __resetD1TaskCache } from '../src/index.js';
import { accountBudget, optionalReadAllowed, optionalWriteAllowed, reserveD1Rows, flushAccountBudget, recordD1Read, recordD1Write } from '../src/d1-quota.js';
import app from '../src/index.js';

const DAY = new Date().toISOString().slice(0, 10);
const norm = sql => String(sql).replace(/\s+/g, ' ').trim();

function ledgerEnv({ reads = 0, writes = 0, rows = [] } = {}) {
  const statements = [];
  const env = {
    statements,
    DB: {
      prepare(sql) {
        statements.push(norm(sql));
        const stmt = {
          bind(...args) { stmt.args = args; return stmt; },
          async first() {
            if (/FROM entities WHERE type=\? AND id=\?/.test(norm(sql)) && stmt.args?.[0] === 'stats') {
              // A ledger row from another day must be treated as zero: the meter resets at 00:00 UTC.
              return { data: JSON.stringify({ day: DAY, reads, writes }) };
            }
            return null;
          },
          async all() { return { results: rows, meta: { rows_read: rows.length } }; },
          async run() { return { meta: { rows_written: 1 } }; }
        };
        return stmt;
      }
    }
  };
  return env;
}

function hydratedStore(types) {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  store.hydrated = true;
  store.complete = new Map();
  for (const type of types) store.complete.set(type, true);
}

test('a hydrated isolate derives project task counts from memory with no D1 read at all', async () => {
  __resetProjectTaskSummaryCache();
  hydratedStore(['tasks']);
  store.data.set('tasks', new Map([
    ['t1', { id: 't1', projectId: 'p1', state: 'completed' }],
    ['t2', { id: 't2', projectId: 'p1', state: 'queued' }],
    ['t3', { id: 't3', projectId: 'p2', state: 'blocked' }]
  ]));
  const env = ledgerEnv();
  const summary = await projectTaskSummary(env, [{ id: 'p1' }, { id: 'p2' }]);

  assert.deepEqual(summary.get('p1'), { total: 2, completed: 1, failed: 0, running: 0, pending: 1, blocked: 0 });
  assert.deepEqual(summary.get('p2'), { total: 1, completed: 0, failed: 0, running: 0, pending: 0, blocked: 1 });
  assert.deepEqual(env.statements, [], 'a complete in-memory task table must not cost a D1 read');
  store.complete = new Map();
});

test('a cold isolate counts tasks with ONE grouped pass, not six subqueries per project', async () => {
  __resetProjectTaskSummaryCache();
  store.configure(null);
  store.data = new Map();
  store.hydrated = false;
  store.complete = new Map();
  const env = ledgerEnv({
    rows: [
      { project_id: 'p1', state: 'completed', cnt: 12 },
      { project_id: 'p1', state: 'blocked', cnt: 2 },
      { project_id: 'p2', state: 'working', cnt: 1 }
    ]
  });

  const summary = await projectTaskSummary(env, [{ id: 'p1' }, { id: 'p2' }]);

  assert.deepEqual(summary.get('p1'), { total: 14, completed: 12, failed: 0, running: 0, pending: 0, blocked: 2 });
  assert.deepEqual(summary.get('p2'), { total: 1, completed: 0, failed: 0, running: 1, pending: 0, blocked: 0 });
  const taskStatements = env.statements.filter(sql => /FROM entities WHERE type='tasks'/.test(sql) && !/AND id=\?/.test(sql));
  assert.equal(taskStatements.length, 1, `one grouped read, saw ${taskStatements.length}`);
  assert.match(taskStatements[0], /GROUP BY project_id, state/);
  assert.doesNotMatch(taskStatements[0], /\(SELECT COUNT\(\*\)/, 'the correlated per-project subqueries are gone');
});

test('the account ledger is shared: once it is near the ceiling optional writes are refused', async () => {
  const nearCeiling = ledgerEnv({ writes: 92_000 });
  assert.equal(await optionalWriteAllowed(nearCeiling), false,
    '85% of the account write budget must stop optional writes');
  assert.equal(await reserveD1Rows(nearCeiling, 1, false), false);

  const stillCritical = ledgerEnv({ writes: 92_000 });
  assert.equal(await optionalWriteAllowed(stillCritical, { critical: true }), true,
    'a critical transition may still land below the critical ceiling');
  assert.equal(await reserveD1Rows(stillCritical, 1, true), true);

  const pastCritical = ledgerEnv({ writes: 99_000 });
  assert.equal(await reserveD1Rows(pastCritical, 1, true), false,
    'even critical writes stop short of the hard limit');

  const fresh = ledgerEnv({ writes: 10_000 });
  assert.equal(await reserveD1Rows(fresh, 1, false), true);
});

test('usage is written to the shared ledger once, and the flushed delta is cleared', async () => {
  let stored = null;
  let inserts = 0;
  const env = {
    DB: {
      prepare(sql) {
        const stmt = {
          bind(...args) { stmt.args = args; return stmt; },
          async first() { return stored ? { data: JSON.stringify(stored) } : null; },
          async all() { return { results: [], meta: { rows_read: 0 } }; },
          async run() {
            if (/^INSERT INTO entities/.test(norm(sql))) {
              inserts += 1;
              stored = JSON.parse(stmt.args[2]);
              return { meta: { rows_written: 1 } };
            }
            return { meta: { rows_written: 0 } };
          }
        };
        return stmt;
      }
    }
  };

  recordD1Read(env, 1200);
  recordD1Write(env, 3, 'entity:tasks');
  await flushAccountBudget(env, { force: true });

  assert.equal(inserts, 1, 'one ledger row for the whole batch');
  assert.equal(stored.day, DAY);
  assert.equal(stored.reads, 1200);
  assert.equal(stored.writes, 3);

  // The delta is cleared, so a second flush has nothing to say and writes nothing.
  assert.equal(await flushAccountBudget(env, { force: true }), null);
  assert.equal(inserts, 1);

  // …and the next burst is ADDED to the ledger rather than replacing it.
  recordD1Read(env, 400);
  await flushAccountBudget(env, { force: true });
  assert.equal(stored.reads, 1600);
  assert.equal(stored.writes, 3);
  const budget = await accountBudget(env, { fresh: true });
  assert.equal(budget.reads, 1600);
  assert.equal(budget.writes, 3);
});

test('optional reads stop at the read guard so hydration and execution keep the rest', async () => {
  const healthy = ledgerEnv({ reads: 1_000_000 });
  assert.equal(await optionalReadAllowed(healthy), true);
  const budget = await accountBudget(healthy);
  assert.equal(budget.readLimit, 5_000_000);
  assert.equal(budget.reads, 1_000_000);

  const exhausted = ledgerEnv({ reads: 4_600_000 });
  assert.equal(await optionalReadAllowed(exhausted), false,
    'past 85% of the daily reads, background counters must serve cache instead of new queries');

  // A tighter local counter is also reported so the dashboard can show WHY it went quiet.
  const summary = await accountBudget(ledgerEnv({ reads: 4_600_000, writes: 91_000 }));
  assert.equal(summary.reads, 4_600_000);
  assert.equal(summary.writes, 91_000);
});

test('project progress reads only that project\'s tasks through the projectId index', async () => {
  __resetD1TaskCache();
  const pid = 'project_indexed_reads';
  const statements = [];
  const tasks = [
    { id: 'k1', projectId: pid, title: 'Plan', state: 'completed', dependsOn: [], createdAt: new Date().toISOString() },
    { id: 'k2', projectId: pid, title: 'Build', state: 'working', dependsOn: [], createdAt: new Date().toISOString() }
  ];
  const env = {
    DB: {
      prepare(sql) {
        statements.push(norm(sql));
        const stmt = {
          bind(...args) { stmt.args = args; return stmt; },
          async all() {
            if (/FROM entities WHERE type = \? AND json_extract\(data, '\$\.projectId'\) = \?/.test(norm(sql))) {
              return { results: tasks.map(task => ({ data: JSON.stringify(task) })), meta: { rows_read: tasks.length } };
            }
            return { results: [], meta: { rows_read: 0 } };
          },
          async first() { return null; },
          async run() { return { meta: { rows_written: 0 } }; }
        };
        return stmt;
      }
    }
  };
  store.configure(env);
  store.data = new Map();
  store.hydrated = true;
  store.complete = new Map([['tasks', true]]);

  const res = await app.fetch(new Request(`https://mauli.test/api/project-progress/${pid}`), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const progress = (await res.json()).data.progress;
  assert.equal(progress.tasks.total, 2);
  assert.equal(progress.tasks.completed, 1);

  const taskReads = statements.filter(sql => /FROM entities WHERE type = \?/.test(sql) && /projectId/.test(sql));
  assert.equal(taskReads.length, 1, 'one indexed per-project read');
  assert.match(taskReads[0], /LIMIT \?/, 'and it is bounded');
  assert.doesNotMatch(statements.join('\n'), /SELECT data FROM entities WHERE type = \? ORDER BY updated_at DESC LIMIT \?/,
    'the old whole-table task read must be gone');
});
