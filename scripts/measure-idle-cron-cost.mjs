#!/usr/bin/env node
// Measures what a QUIET cron minute costs in D1 rows, before and after the idle gate.
//
// Why this exists: Cloudflare bills rows_read/rows_written per account per day and the free
// tier hard-fails the whole product when it is crossed. "No command, no project, still using
// the limit" is exactly the failure this number explains, so it is measured rather than
// asserted: an in-memory D1 double is seeded with a realistic account (projects, live tasks,
// agents, approvals, runs, verifications, artifacts, events) and the two code paths are run
// over it while every statement and returned row is counted.
//
//   node scripts/measure-idle-cron-cost.mjs
import { store } from '../src/store.js';
import { runMaintenance } from '../src/maintenance.js';
import { schedulerIdleGate } from '../src/scheduler.js';

const DAY = 24 * 3600 * 1000;

function iso(offsetMs = 0) { return new Date(Date.now() + offsetMs).toISOString(); }

// A stateful-enough D1 double. It keeps rows per entity type and returns what the scheduler's
// own queries ask for, counting rows returned (the meter Cloudflare bills) as it goes.
function seededD1({ projects = 40, tasks = 300, agents = 60, approvals = 27, runs = 0, verifications = 200, artifacts = 200, events = 3000 } = {}) {
  const entities = new Map();
  const bucket = (type) => { if (!entities.has(type)) entities.set(type, []); return entities.get(type); };
  const old = iso(-8 * DAY);
  for (let i = 0; i < projects; i++) {
    bucket('projects').push({ id: `project_${i}`, data: JSON.stringify({ id: `project_${i}`, state: i < 3 ? 'active' : 'completed', founderCommand: 'build something', createdAt: old, updatedAt: old }) });
  }
  const liveStates = ['queued', 'assigned', 'working', 'verifying', 'blocked'];
  for (let i = 0; i < tasks; i++) {
    const state = i < 12 ? liveStates[i % liveStates.length] : 'completed';
    bucket('tasks').push({ id: `task_${i}`, data: JSON.stringify({ id: `task_${i}`, projectId: `project_${i % projects}`, state, dependsOn: [], updatedAt: old }) });
  }
  for (let i = 0; i < agents; i++) bucket('agents').push({ id: `agent_${i}`, data: JSON.stringify({ id: `agent_${i}`, name: `Agent ${i}`, state: 'available' }) });
  for (let i = 0; i < approvals; i++) bucket('approvals').push({ id: `approval_${i}`, data: JSON.stringify({ id: `approval_${i}`, state: 'approved', projectId: `project_${i % projects}` }) });
  for (let i = 0; i < runs; i++) bucket('runs').push({ id: `run_${i}`, data: JSON.stringify({ id: `run_${i}`, state: 'completed' }) });
  for (let i = 0; i < verifications; i++) bucket('verifications').push({ id: `verification_${i}`, data: JSON.stringify({ id: `verification_${i}`, passed: true }) });
  for (let i = 0; i < artifacts; i++) bucket('artifacts').push({ id: `artifact_${i}`, data: JSON.stringify({ id: `artifact_${i}`, path: `f${i}.js` }) });
  const eventRows = Array.from({ length: events }, (_, i) => ({ id: `evt_${i}`, type: 'task.completed', payload: '{}', created_at: new Date(Date.now() - i * 60_000).toISOString() }));

  const meter = { statements: 0, rowsRead: 0, statementsBySql: new Map() };
  const norm = (sql) => sql.replace(/\s+/g, ' ').trim();
  const rowsFor = (type) => bucket(type);

  const DB = {
    prepare(rawSql) {
      const sql = norm(rawSql);
      meter.statements += 1;
      meter.statementsBySql.set(sql, (meter.statementsBySql.get(sql) ?? 0) + 1);
      const stmt = {
        _args: [],
        bind(...args) { stmt._args = args; return stmt; },
        async all() {
          const args = stmt._args;
          let rows = [];
          if (sql.includes("json_extract(data, '$.state') IN")) {
            const [type, ...rest] = args;
            const limit = Number(rest.pop());
            const states = new Set(rest.map(String));
            rows = rowsFor(type).filter((row) => states.has(JSON.parse(row.data).state)).slice(0, limit);
          } else if (sql.includes('type = ?') && sql.includes('ORDER BY')) {
            const [type, limit] = args;
            rows = rowsFor(type).slice(0, limit === undefined ? undefined : Number(limit));
          } else if (sql.includes('updated_at >')) {
            const [type, after, limit] = args;
            rows = rowsFor(type).filter((row) => (JSON.parse(row.data).updatedAt ?? '') > after).slice(0, Number(limit) || rowsFor(type).length);
          } else if (sql.includes('FROM events')) {
            rows = eventRows.slice(0, Number(args[0]) || eventRows.length);
          } else if (sql.includes('UNION ALL')) {
            rows = [];
          }
          meter.rowsRead += rows.length;
          return { results: rows, meta: { rows_read: rows.length } };
        },
        async first() {
          const args = stmt._args;
          if (sql.includes('WHERE type=? AND id=?')) {
            const row = rowsFor(args[0]).find((r) => r.id === args[1]);
            meter.rowsRead += row ? 1 : 0;
            return row ?? null;
          }
          if (sql.includes('FROM events')) {
            const row = eventRows[Number(args[0]) ?? 0] ?? null;
            meter.rowsRead += row ? 1 : 0;
            return row ? { created_at: row.created_at } : null;
          }
          meter.rowsRead += 0;
          return null;
        },
        async run() { return { meta: { rows_written: 1 } }; },
      };
      return stmt;
    },
  };
  return { DB, meter, entities };
}

function reset(env) {
  store.configure(env);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;
  store.pendingWrites = new Set();
  store.versions = new Map();
  store.syncWatermarks = new Map();
  store.complete = new Map();
}

const QUIET_MINUTE = (() => { const d = new Date(); d.setUTCMinutes(7, 0, 0); return d.getTime(); })();

async function measureBefore() {
  const { DB, meter } = seededD1();
  const env = { DB };
  reset(env);
  // What every quiet cron invocation used to do: full scheduler bootstrap, incremental sync,
  // then the maintenance sweep and both prune probes.
  await store.hydrateScheduler();
  await store.syncFromD1(['projects', 'tasks', 'approvals', 'runs', 'verifications', 'executions', 'artifacts']);
  await runMaintenance(env, { scheduledTime: QUIET_MINUTE });
  const before = { statements: meter.statements, rowsRead: meter.rowsRead };
  await store.flush().catch(() => null);
  return before;
}

async function measureAfter() {
  const { DB, meter, entities } = seededD1();
  // The marker a previous tick left behind: nothing is pending.
  entities.set('stats', [{ id: 'scheduler_wake', data: JSON.stringify({ pending: false, reason: 'idle', at: iso(-60_000) }) }]);
  const env = { DB };
  reset(env);
  // The gate answers first. A quiet minute stops here — no hydration, no sync, no prune.
  const gate = await schedulerIdleGate(env, { scheduledTime: QUIET_MINUTE });
  const after = { statements: meter.statements, rowsRead: meter.rowsRead, gate };
  await store.flush().catch(() => null);
  return after;
}

const before = await measureBefore();
const after = await measureAfter();
const now = { statements: after.statements, rowsRead: after.rowsRead };

const per = (value) => `${value} (${(value * 1440).toLocaleString()}/day at one tick a minute)`;
console.log('Idle cron minute, seeded with 40 projects / 300 tasks / 60 agents / 200 verifications / 200 artifacts:');
console.log(`  before: ${String(before.statements).padStart(3)} statements, ${per(before.rowsRead)} rows read`);
console.log(`  after : ${String(now.statements).padStart(3)} statements, ${per(now.rowsRead)} rows read   (gate: ${after.gate.reason})`);
// A whole idle day is not 1,440 cheap minutes: the safety sweep still runs a full tick every
// 15 minutes so time-only transitions (an expired lease, a retry backoff) are seen. Report
// the day honestly rather than only the cheap minute.
const SWEEPS_PER_DAY = 96;
const quietPerDay = (1440 - SWEEPS_PER_DAY) * now.rowsRead + SWEEPS_PER_DAY * before.rowsRead;
const saved = before.rowsRead ? Math.round((1 - quietPerDay / (1440 * before.rowsRead)) * 100) : 0;
console.log(`  idle day: ${quietPerDay.toLocaleString()} rows read with the gate vs ${(1440 * before.rowsRead).toLocaleString()} without it (${saved}% lower)`);
if (after.gate.run) {
  console.log(`WARNING: the gate opened (${after.gate.reason}), so this is not a quiet minute.`);
  process.exitCode = 1;
}

