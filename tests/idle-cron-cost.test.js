// Locks in the answer to "I ran no command and no project is running, so why did D1 usage
// climb?": a one-minute cron must not pay for a full scheduler bootstrap when nothing needs
// work, and dead task chains must be retired instead of ticking forever.
//
// The numbers asserted here are the contract: an idle cron minute is one row read plus one
// indexed existence probe, not a hydration of seven tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { retireStaleWork, recoverStuckProjects } from '../src/maintenance.js';
import {
  schedulerIdleGate,
  readSchedulerWake,
  writeSchedulerWake,
  markSchedulerWork,
  rowsChangedSince,
  schedulerHasLiveWork,
} from '../src/scheduler.js';

function resetStore(env = {}) {
  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = true;
  store.pendingWrites = new Set();
  store.versions = new Map();
  store.complete = new Map();
}

// Minimal D1 double that counts statements and rows read, so the cost of a quiet minute is
// measured rather than assumed. It understands only the two reads the gate is allowed to make
// plus the wake-row upsert; anything else is a statement the idle path should not be issuing.
function countingD1({ wake = null, dirty = false, fail = false } = {}) {
  const statements = [];
  let rowsRead = 0;
  const norm = sql => sql.replace(/\s+/g, ' ').trim();
  const DB = {
    prepare(rawSql) {
      statements.push(norm(rawSql));
      const stmt = {
        _args: [],
        bind(...args) { stmt._args = args; return stmt; },
        async first() {
          if (fail) throw new Error('D1 unavailable');
          const sql = norm(rawSql);
          if (sql.startsWith('SELECT data FROM entities WHERE type=? AND id=?')) {
            rowsRead += wake === null ? 0 : 1;
            return wake === null ? null : { data: JSON.stringify(wake) };
          }
          throw new Error(`unexpected idle statement: ${sql}`);
        },
        async all() {
          if (fail) throw new Error('D1 unavailable');
          const sql = norm(rawSql);
          if (sql.includes('UNION ALL') && sql.includes('updated_at>?')) {
            rowsRead += dirty ? 1 : 0;
            return { results: dirty ? [{ hit: 1 }] : [] };
          }
          throw new Error(`unexpected idle statement: ${sql}`);
        },
        async run() { return { meta: { rows_written: 1 } }; },
      };
      return stmt;
    },
  };
  return { DB, statements, rowsRead: () => rowsRead };
}

// A minute that is never the safety sweep, so the gate has to answer from real state.
const QUIET_MINUTE = Date.UTC(2026, 9, 26, 10, 7, 0);
const SWEEP_MINUTE = Date.UTC(2026, 9, 26, 10, 15, 0);

test('an idle cron minute costs one row read and one probe, not a hydration', async () => {
  const d1 = countingD1({ wake: { pending: false, reason: 'idle', at: '2026-10-26T10:00:00.000Z' } });
  const gate = await schedulerIdleGate({ DB: d1.DB }, { scheduledTime: QUIET_MINUTE, nowMs: QUIET_MINUTE });

  assert.equal(gate.run, false, 'nothing is pending and nothing changed, so there is no work to do');
  assert.equal(gate.reason, 'idle');
  assert.ok(d1.statements.length <= 2, `an idle minute must not run a sweep, ran ${d1.statements.length}: ${d1.statements.join(' | ')}`);
  assert.ok(d1.rowsRead() <= 4, `an idle minute must read a handful of rows, read ${d1.rowsRead()}`);
  // The expensive path is exactly what must NOT appear.
  assert.ok(!d1.statements.some(sql => /verifications|artifacts|agents/.test(sql)), 'no table hydration on an idle minute');
  assert.ok(!d1.statements.some(sql => /ORDER BY/.test(sql)), 'no ordered table scan on an idle minute');
});

test('pending work re-opens the full tick immediately', async () => {
  const d1 = countingD1({ wake: { pending: true, reason: 'founder-command', at: '2026-10-26T10:06:00.000Z' } });
  const gate = await schedulerIdleGate({ DB: d1.DB }, { scheduledTime: QUIET_MINUTE, nowMs: QUIET_MINUTE });
  assert.equal(gate.run, true);
  assert.equal(gate.reason, 'founder-command');
});

test('a missing marker means "work may exist" — never a silent idle', async () => {
  const d1 = countingD1({ wake: null });
  const gate = await schedulerIdleGate({ DB: d1.DB }, { scheduledTime: QUIET_MINUTE, nowMs: QUIET_MINUTE });
  assert.equal(gate.run, true);
  assert.equal(gate.reason, 'no-marker');
});

test('a marker that cannot be read never silences the scheduler (control)', async () => {
  const d1 = countingD1({ wake: null, fail: true });
  const gate = await schedulerIdleGate({ DB: d1.DB }, { scheduledTime: QUIET_MINUTE, nowMs: QUIET_MINUTE });
  assert.equal(gate.run, true, 'a D1 failure must fall back to running the tick, not to doing nothing');
});

test('rows written recently by any live table re-open the tick for five minutes', async () => {
  const d1 = countingD1({ wake: { pending: false, at: '2026-10-26T10:00:00.000Z' }, dirty: true });
  const gate = await schedulerIdleGate({ DB: d1.DB }, { scheduledTime: QUIET_MINUTE, nowMs: QUIET_MINUTE });
  assert.equal(gate.run, true);
  assert.equal(gate.reason, 'rows-changed');
});

test('the safety sweep runs without consulting D1 at all', async () => {
  const d1 = countingD1({ wake: { pending: false, at: '2026-10-26T10:00:00.000Z' } });
  const gate = await schedulerIdleGate({ DB: d1.DB }, { scheduledTime: SWEEP_MINUTE, nowMs: SWEEP_MINUTE });
  assert.equal(gate.run, true);
  assert.equal(gate.reason, 'safety-sweep');
  assert.equal(d1.statements.length, 0, 'the sweep is unconditional, so it needs no probe');
});

test('the dirty probe asks only the four live tables, one indexed range each', async () => {
  const d1 = countingD1({ dirty: false });
  assert.equal(await rowsChangedSince({ DB: d1.DB }, Date.now() - 300000), false);
  assert.equal(d1.statements.length, 1, 'one statement, not one per table');
  assert.match(d1.statements[0], /UNION ALL/);
  const bound = d1.statements[0].match(/type=\?/g) ?? [];
  assert.equal(bound.length, 4, 'projects/tasks/approvals/runs are the only tables that can create work');
  assert.doesNotMatch(d1.statements[0], /command_results|events|memory/, 'historical tables can never create work');
});

test('marking work is a no-op when the marker already says so', async () => {
  const d1 = countingD1({ wake: { pending: true, at: '2026-10-26T10:00:00.000Z' } });
  const unchanged = await markSchedulerWork({ DB: d1.DB }, 'founder-command', { previous: true });
  assert.equal(unchanged.written, false);
  assert.equal(d1.statements.length, 0, 'a repeated mark must not cost a D1 write');

  const changed = await markSchedulerWork({ DB: d1.DB }, 'founder-command', { previous: false });
  assert.equal(changed.written, true);
  assert.equal(d1.statements.length, 1);
});

test('writeSchedulerWake only writes on a transition', async () => {
  const d1 = countingD1();
  assert.equal((await writeSchedulerWake({ DB: d1.DB }, { pending: false, previous: false })).written, false);
  assert.equal((await writeSchedulerWake({ DB: d1.DB }, { pending: false, previous: true })).written, true);
  assert.equal(d1.statements.length, 1);
});

test('readSchedulerWake defaults to pending when there is no D1', async () => {
  const wake = await readSchedulerWake({});
  assert.equal(wake.pending, true);
  assert.equal(wake.known, false);
});

test('a dead chain is retired instead of ticking forever', async () => {
  resetStore({});
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  store.data.set('agents', new Map([['agent-security', { id: 'agent-security', state: 'assigned', currentTaskId: 'task-dead' }]]));
  store.data.set('tasks', new Map([
    ['task-dead', { id: 'task-dead', projectId: 'project-zombie', state: 'blocked', updatedAt: threeDaysAgo, agentId: 'agent-security', dependsOn: [] }],
    ['task-live', { id: 'task-live', projectId: 'project-live', state: 'queued', updatedAt: new Date().toISOString(), dependsOn: [] }],
  ]));

  const report = await retireStaleWork({});
  assert.deepEqual(report.retired.map(r => r.taskId), ['task-dead']);
  assert.equal(store.get('tasks', 'task-dead').state, 'failed', 'an abandoned task must become terminal');
  assert.match(store.get('tasks', 'task-dead').error, /Retired/);
  assert.equal(store.get('tasks', 'task-live').state, 'queued', 'fresh work is never touched');
  assert.equal(store.get('agents', 'agent-security').state, 'available', 'the agent is freed, not left assigned forever');
  assert.ok(store.events.some(event => event.type === 'scheduler.task_retired'), 'the retirement is auditable');

  const again = await retireStaleWork({});
  assert.deepEqual(again.retired, [], 'retirement is idempotent');
});

test('a project with a live run is never retired out from under its execution', async () => {
  resetStore({});
  const longAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  store.data.set('runs', new Map([['run-1', { id: 'run-1', taskId: 'task-working', state: 'running' }]]));
  store.data.set('tasks', new Map([
    ['task-working', { id: 'task-working', projectId: 'project-live', state: 'working', updatedAt: longAgo }],
  ]));

  const report = await retireStaleWork({});
  assert.deepEqual(report.retired, [], 'a running execution is progress, however old the row looks');
});

test('dry run reports without writing', async () => {
  resetStore({});
  const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  store.data.set('tasks', new Map([['task-old', { id: 'task-old', projectId: 'p1', state: 'queued', updatedAt: stale }]]));

  const report = await retireStaleWork({}, { dryRun: true });
  assert.equal(report.retired.length, 1);
  assert.equal(store.get('tasks', 'task-old').state, 'queued', 'a dry run changes nothing');
});

test('retirement survives recovery: a zombie project is failed, not revived', async () => {
  resetStore({});
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  store.data.set('projects', new Map([
    ['project-zombie', { id: 'project-zombie', state: 'active', name: 'zombie', createdAt: fiveDaysAgo, updatedAt: fiveDaysAgo }],
  ]));
  store.data.set('tasks', new Map([
    ['task-a', { id: 'task-a', projectId: 'project-zombie', state: 'blocked', dependsOn: [], updatedAt: fiveDaysAgo }],
    ['task-b', { id: 'task-b', projectId: 'project-zombie', state: 'assigned', dependsOn: ['task-a'], updatedAt: fiveDaysAgo }],
  ]));

  // This is exactly what runMaintenance does: retire dead chains first, then recover.
  const retirement = await retireStaleWork({});
  assert.equal(retirement.retired.length, 2);
  const recovery = await recoverStuckProjects({ dryRun: false });

  // Recovery used to call approveProject(), which re-queued every 'failed' task whose
  // dependencies were also 'failed' — the retirement was undone in the same pass and the
  // zombie chain kept ticking. Retirement must be terminal.
  assert.equal(store.get('tasks', 'task-a').state, 'failed', 'recovery must not resurrect a retired task');
  assert.equal(store.get('tasks', 'task-b').state, 'failed', 'recovery must not resurrect a retired task');
  assert.equal(store.get('projects', 'project-zombie').state, 'failed', 'the zombie project must be finalized, not re-queued');
  assert.ok(!recovery.reports.some(report => report.verdict === 'requeued'), 'a fully retired chain is never re-queued');
  assert.ok(store.events.some(event => event.type === 'project.recovered' && event.payload?.to === 'failed'));
});

// An account that has spent its daily write budget refuses critical writes from the guard. The
// retirement must then say so, instead of changing memory and leaving D1 holding the zombie.
function exhaustedBudgetEnv() {
  const day = new Date().toISOString().slice(0, 10);
  return {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return { data: JSON.stringify({ day, reads: 0, writes: 100000 }) }; },
          async all() { return { results: [] }; },
          async run() { return { meta: { rows_written: 1 } }; },
        };
      },
    },
  };
}

test('a retirement the write budget refuses is reported deferred, not retired', async () => {
  resetStore({});
  const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  store.data.set('tasks', new Map([['task-zombie', { id: 'task-zombie', projectId: 'p1', state: 'blocked', dependsOn: [], updatedAt: stale }]]));

  const report = await retireStaleWork(exhaustedBudgetEnv());
  assert.deepEqual(report.retired, [], 'nothing was written, so nothing may be claimed as retired');
  assert.deepEqual(report.deferred.map(r => r.taskId), ['task-zombie']);
  assert.match(report.reason, /write budget/);
  assert.equal(store.get('tasks', 'task-zombie').state, 'blocked', 'memory must not claim a state D1 never received');
});

test('a project retired for having no tasks is deferred too when writes are refused', async () => {
  resetStore(exhaustedBudgetEnv());
  const stale = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  store.data.set('projects', new Map([['project-no-tasks', { id: 'project-no-tasks', state: 'queued', createdAt: stale, updatedAt: stale }]]));

  const report = await recoverStuckProjects({ dryRun: false });
  const verdict = report.reports.find(r => r.projectId === 'project-no-tasks');
  assert.equal(verdict.verdict, 'retire_deferred');
  assert.equal(store.get('projects', 'project-no-tasks').state, 'queued', 'the project row is what the dashboard reads; it must not change in memory alone');
});

test('a chain that cannot move stops holding the fast path open', async () => {
  resetStore({});
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  store.data.set('projects', new Map([['p-zombie', { id: 'p-zombie', state: 'active', updatedAt: fiveDaysAgo }]]));
  store.data.set('tasks', new Map([['t-blocked', { id: 't-blocked', projectId: 'p-zombie', state: 'blocked', updatedAt: fiveDaysAgo }]]));
  assert.equal(schedulerHasLiveWork({}), false, 'a dead chain keeps the marker idle instead of hydrating every minute; the safety sweep still acts on it');

  store.data.set('tasks', new Map([['t-fresh', { id: 't-fresh', projectId: 'p-zombie', state: 'queued', updatedAt: new Date().toISOString() }]]));
  assert.equal(schedulerHasLiveWork({}), true, 'fresh work always re-opens the tick');

  resetStore({});
  store.data.set('projects', new Map([['p-old', { id: 'p-old', state: 'active', updatedAt: fiveDaysAgo }]]));
  store.data.set('tasks', new Map([['t-working', { id: 't-working', projectId: 'p-old', state: 'working', updatedAt: fiveDaysAgo }]]));
  store.data.set('runs', new Map([['r1', { id: 'r1', taskId: 't-working', state: 'running' }]]));
  assert.equal(schedulerHasLiveWork({}), true, 'a live execution is progress, however old the row looks');
});

test('live work is detected from the scheduler view without a query', async () => {
  resetStore({});
  assert.equal(schedulerHasLiveWork(), false);
  store.data.set('tasks', new Map([['t1', { id: 't1', state: 'blocked' }]]));
  assert.equal(schedulerHasLiveWork(), true);

  resetStore({});
  store.data.set('projects', new Map([['p1', { id: 'p1', state: 'awaiting_approval' }]]));
  assert.equal(schedulerHasLiveWork(), false, 'a human gate is not scheduler work — the approval route marks it');

  store.data.set('approvals', new Map([['a1', { id: 'a1', state: 'pending' }]]));
  assert.equal(schedulerHasLiveWork(), true);
});
