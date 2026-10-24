const DAILY_ROW_READ_LIMIT = 5000000;
const DAILY_ROW_WRITE_LIMIT = 100000;
const SAFETY_LIMIT = 75000;
const SHARED_SAFE_LIMIT = 90000;
const WARN_LIMIT = 70000;
const HIGH_LIMIT = 85000;
// Cloudflare meters rows_read / rows_written for the WHOLE ACCOUNT and a Worker runs in many
// isolates at once. Every per-isolate counter above therefore reported "healthy, 0/100000"
// while the account meter read 117.47k/100k and 5.08M/5M — the limits were being crossed with
// no component aware of it, and once crossed EVERY read/write fails, which is why the product
// stalled instead of degrading. These ratios leave real headroom for work that must still
// happen (a task completing, the founder opening a project) before the account ceiling:
// above them only critical traffic is allowed, and it stops short of the hard limit.
const ACCOUNT_READ_GUARD_RATIO = 0.85;
const ACCOUNT_WRITE_GUARD_RATIO = 0.85;
const ACCOUNT_CRITICAL_WRITE_RATIO = 0.97;
const ACCOUNT_BUDGET_ID = 'account_budget';
const ACCOUNT_BUDGET_TTL_MS = 30_000;
// The ledger is one tiny row shared by every isolate, so it survives recycling and can bound
// the account. Flushing it costs one rows_written, so it is batched instead of written per
// event; 60s and a few hundred accumulated rows keep that overhead under 1% of the budget.
const ACCOUNT_LEDGER_FLUSH_MS = 60_000;
const ACCOUNT_LEDGER_FLUSH_WRITES = 200;
const ACCOUNT_LEDGER_FLUSH_READS = 100_000;

function dayKey(date = new Date()) { return date.toISOString().slice(0, 10); }

function state(env) {
  if (!env.__MAULI_D1_QUOTA) env.__MAULI_D1_QUOTA = { day: dayKey(), reads: 0, writes: 0, reserved: 0, bySource: {} };
  const s = env.__MAULI_D1_QUOTA;
  if (!s.bySource) s.bySource = {};
  const day = dayKey();
  if (s.day !== day) { s.day = day; s.reads = 0; s.writes = 0; s.reserved = 0; s.bySource = {}; s.blocked = null; }
  return s;
}

// Cloudflare's account-level free-tier ceiling. MAULI's own counter only sees the writes
// this isolate issued, so it happily reported "healthy, 0/100000" while D1 was rejecting
// every single write with this error. Nothing in the product could tell the difference
// between "no work happened" and "no work could be recorded" — the dashboard just stalled
// and projects looked stuck. Recognising the error turns a silent stall into a visible,
// attributable, self-clearing state.
const ACCOUNT_WRITE_LIMIT_RE = /exceeded D1'?s free tier daily row write limit|daily row write limit/i;

export function noteD1WriteBlocked(env, error) {
  const message = error?.message ?? String(error ?? '');
  if (!ACCOUNT_WRITE_LIMIT_RE.test(message)) return false;
  const s = state(env);
  if (!s.blocked) s.blocked = { reason: message.slice(0, 300), at: new Date().toISOString(), source: 'cloudflare-account' };
  return true;
}

export function d1WriteBlockedSnapshot(env) {
  const s = state(env);
  return s.blocked ? { ...s.blocked, day: s.day, resetsAt: `${s.day}T24:00:00Z` } : null;
}

export function d1ReadQuotaSnapshot(env) {
  const s = state(env);
  const used = Math.min(DAILY_ROW_READ_LIMIT, Math.max(0, Number(s.reads) || 0));
  const remaining = Math.max(0, DAILY_ROW_READ_LIMIT - used);
  const percent = Math.min(100, Number(((used / DAILY_ROW_READ_LIMIT) * 100).toFixed(2)));
  const status = used >= DAILY_ROW_READ_LIMIT ? 'limit_reached' : used >= 4500000 ? 'critical' : used >= 4000000 ? 'high' : used >= 3500000 ? 'watch' : 'healthy';
  return { date:s.day, limit:DAILY_ROW_READ_LIMIT, used, remaining, percent, status, protectionMode:used>=4000000, source:'MAULI tracked reads (not Cloudflare account meter)' };
}
export function recordD1Read(env, rows=0) {
  const s=state(env);
  const n=Math.max(0,Number(rows)||0);
  s.reads=Math.min(DAILY_ROW_READ_LIMIT,Math.max(0,s.reads)+n);
  noteAccountRead(env,n);
  return d1ReadQuotaSnapshot(env);
}

// ── Account-wide daily ledger ─────────────────────────────────────────────
// One row (`stats/account_budget`) records the day's rows_read / rows_written as reported by
// every isolate that flushed. It is approximate by design — a delta lost to a cancelled
// invocation just means the guard is slightly conservative — and it is the only place a
// Worker can learn the ACCOUNT total instead of its own.
function accountLocal(env) {
  if (!env.__MAULI_ACCOUNT_BUDGET) env.__MAULI_ACCOUNT_BUDGET = { day: dayKey(), reads: 0, writes: 0, ledger: null, ledgerAt: 0, lastFlush: Date.now(), flushing: null };
  const s = env.__MAULI_ACCOUNT_BUDGET;
  if (s.day !== dayKey()) { s.day = dayKey(); s.reads = 0; s.writes = 0; s.ledger = null; s.ledgerAt = 0; s.lastFlush = 0; }
  return s;
}
function accountTotals(s) {
  const ledger = s.ledger ?? { reads: 0, writes: 0 };
  return { day: s.day, reads: ledger.reads + s.reads, writes: ledger.writes + s.writes };
}
// Best-effort ledger read. A failure (no D1, a mock without first(), the read limit already
// reached) must never block production work: it returns this isolate's own counters.
async function refreshLedger(env, s) {
  try {
    const row = await env.DB.prepare('SELECT data FROM entities WHERE type=? AND id=?').bind('stats', ACCOUNT_BUDGET_ID).first();
    const data = row?.data ? JSON.parse(row.data) : null;
    // A row from another day is yesterday's usage: the account meter resets at midnight UTC.
    s.ledger = data && data.day === s.day ? { reads: Number(data.reads) || 0, writes: Number(data.writes) || 0 } : { reads: 0, writes: 0 };
    s.ledgerAt = Date.now();
  } catch (_) {
    // Leave whatever ledger we had; the local counters still count.
  }
  return s.ledger ?? { reads: 0, writes: 0 };
}
export async function accountBudget(env, { fresh = false } = {}) {
  const s = accountLocal(env);
  const nowMs = Date.now();
  if (fresh || !s.ledger || (nowMs - s.ledgerAt) >= ACCOUNT_BUDGET_TTL_MS) await refreshLedger(env, s);
  return { ...accountTotals(s), readLimit: DAILY_ROW_READ_LIMIT, writeLimit: DAILY_ROW_WRITE_LIMIT, source: 'mauli-account-ledger' };
}
export async function flushAccountBudget(env, { force = false } = {}) {
  const s = accountLocal(env);
  if (s.flushing) return s.flushing;
  if (!s.reads && !s.writes) return null;
  if (!force && (Date.now() - s.lastFlush) < ACCOUNT_LEDGER_FLUSH_MS) return null;
  const reads = s.reads, writes = s.writes;
  s.lastFlush = Date.now();
  s.flushing = (async () => {
    try {
      // Read the ledger row itself (not accountBudget, which already includes the pending
      // delta) or the flushed rows would be counted twice.
      const base = await refreshLedger(env, s);
      const stamp = new Date().toISOString();
      const next = { day: s.day, reads: base.reads + reads, writes: base.writes + writes, updatedAt: stamp };
      await env.DB.prepare('INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
        .bind('stats', ACCOUNT_BUDGET_ID, JSON.stringify(next), stamp, stamp).run();
      // Only the flushed delta is cleared, so concurrent reads keep accumulating correctly.
      s.reads = Math.max(0, s.reads - reads);
      s.writes = Math.max(0, s.writes - writes);
      s.ledger = { reads: next.reads, writes: next.writes };
      s.ledgerAt = Date.now();
    } catch (_) {
      // Ledger write failed — the local counters still bound this isolate.
    } finally { s.flushing = null; }
  })();
  return s.flushing;
}
// A busted threshold alone would leave a quiet isolate's usage out of the shared ledger
// forever, so time also triggers a flush: at most one extra row per minute while the isolate
// is doing work, which keeps the account total within about a minute of the truth.
function ledgerFlushDue(s) {
  return s.reads >= ACCOUNT_LEDGER_FLUSH_READS
    || s.writes >= ACCOUNT_LEDGER_FLUSH_WRITES
    || ((s.reads || s.writes) && (Date.now() - s.lastFlush) >= ACCOUNT_LEDGER_FLUSH_MS);
}
function noteAccountRead(env, rows) {
  const n = Math.max(0, Number(rows) || 0);
  if (!n) return;
  const s = accountLocal(env);
  s.reads += n;
  if (ledgerFlushDue(s)) flushAccountBudget(env);
}
function noteAccountWrite(env, rows) {
  // A rejected compare-and-set writes 0 rows; counting it as 1 would inflate the shared
  // ledger that decides when optional writes have to stop.
  const n = Math.max(0, Number(rows) || 0);
  if (!n) return;
  const s = accountLocal(env);
  s.writes += n;
  if (ledgerFlushDue(s)) flushAccountBudget(env);
}
// Optional reads (dashboard counters, polling refreshes, the cold-state snapshot) are the
// traffic that can be dropped without losing work. When the account is 85% through its daily
// reads they stop and serve whatever is cached, so the remaining budget is spent on hydration,
// execution and the founder's own project screens instead of on background polling.
export async function optionalReadAllowed(env) {
  const budget = await accountBudget(env);
  return budget.reads < DAILY_ROW_READ_LIMIT * ACCOUNT_READ_GUARD_RATIO;
}
export async function optionalWriteAllowed(env, { critical = false } = {}) {
  const budget = await accountBudget(env);
  const ceiling = critical ? DAILY_ROW_WRITE_LIMIT * ACCOUNT_CRITICAL_WRITE_RATIO : DAILY_ROW_WRITE_LIMIT * ACCOUNT_WRITE_GUARD_RATIO;
  return budget.writes < ceiling;
}

export function d1QuotaSnapshot(env) {
  const s = state(env);
  const used = Math.min(DAILY_ROW_WRITE_LIMIT, Math.max(0, Number(s.writes) || 0));
  const remaining = Math.max(0, DAILY_ROW_WRITE_LIMIT - used);
  const percent = Math.min(100, Number(((used / DAILY_ROW_WRITE_LIMIT) * 100).toFixed(2)));
  const status = s.blocked ? 'account_limit_reached' : used >= DAILY_ROW_WRITE_LIMIT ? 'limit_reached' : used >= SHARED_SAFE_LIMIT ? 'critical' : used >= HIGH_LIMIT ? 'high' : used >= WARN_LIMIT ? 'watch' : 'healthy';
  return {
    date: s.day, limit: DAILY_ROW_WRITE_LIMIT, used, remaining, percent, status,
    protectionMode: used >= SAFETY_LIMIT || Boolean(s.blocked),
    blocked: s.blocked ?? null,
    source: 'MAULI tracked writes (not Cloudflare account meter)',
  };
}

// estimatedRows prevents a write from being started when its expected cost would cross the hard ceiling.
export async function reserveD1Rows(env, estimatedRows = 1, critical = false) {
  // Persistent reservations were removed because they were themselves D1 writes and
  // accumulated across Worker isolates without being released. That could block a
  // new founder project even when the real account rows_written usage was still low.
  // Cloudflare remains authoritative for the account-level limit; this local guard
  // only prevents writes from crossing MAULI's own safety ceiling.
  const estimate = Math.max(1, Number(estimatedRows) || 1);
  if (!canWriteD1(env, critical, estimate)) return false;
  // The per-isolate ceiling above cannot see writes issued by the other isolates. Refuse
  // optional writes once the shared ledger is near the account's hard daily limit, so the
  // remaining rows are left for the transitions that actually finish work.
  if (!(await optionalWriteAllowed(env, { critical }))) return false;
  return true;
}

export function canWriteD1(env, critical = false, estimatedRows = 1) {
  const s = state(env);
  const estimate = Math.max(1, Number(estimatedRows) || 1);
  // Once Cloudflare has rejected a write for the account-level daily ceiling, every
  // further write is refused the same way. Stop paying for attempts that cannot land;
  // the day rollover in state() clears this automatically at midnight UTC.
  if (s.blocked) return false;
  if (s.writes + estimate > DAILY_ROW_WRITE_LIMIT) return false;
  // Non-critical writes must remain strictly below the safety ceiling.
  // Critical writes may continue up to the Cloudflare hard daily limit.
  if (!critical && s.writes + estimate >= SAFETY_LIMIT) return false;
  return true;
}

export function recordD1Write(env, rows = 1, source = 'other') {
  const s = state(env);
  const n = Math.max(1, Number(rows) || 1);
  s.writes = Math.min(DAILY_ROW_WRITE_LIMIT, Math.max(0, s.writes) + n);
  noteAccountWrite(env, n);
  // Per-source attribution (this isolate only) so /api/health shows WHERE rows_written
  // goes: entity:tasks, event:task.completed, prune:events, ... Costs nothing extra.
  const key = String(source || 'other');
  s.bySource[key] = (Number(s.bySource[key]) || 0) + n;
  return d1QuotaSnapshot(env);
}

export function d1WriteSourcesSnapshot(env) {
  const s = state(env);
  const top = Object.entries(s.bySource)
    .map(([source, rows]) => ({ source, rows }))
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 25);
  return { date: s.day, isolateWrites: s.writes, top, source: 'MAULI tracked writes by source (this isolate, not Cloudflare account meter)' };
}

export { DAILY_ROW_READ_LIMIT, DAILY_ROW_WRITE_LIMIT, SAFETY_LIMIT, WARN_LIMIT, HIGH_LIMIT };