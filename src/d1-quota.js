const DAILY_ROW_WRITE_LIMIT = 100000;
const SAFETY_LIMIT = 90000;
const WARN_LIMIT = 70000;
const HIGH_LIMIT = 85000;

function dayKey(date = new Date()) { return date.toISOString().slice(0, 10); }

function state(env) {
  if (!env.__MAULI_D1_QUOTA) env.__MAULI_D1_QUOTA = { day: dayKey(), writes: 0 };
  const s = env.__MAULI_D1_QUOTA;
  const day = dayKey();
  if (s.day !== day) { s.day = day; s.writes = 0; }
  return s;
}

export function d1QuotaSnapshot(env) {
  const s = state(env);
  const used = Math.min(DAILY_ROW_WRITE_LIMIT, Math.max(0, Number(s.writes) || 0));
  const remaining = Math.max(0, DAILY_ROW_WRITE_LIMIT - used);
  const percent = Math.min(100, Number(((used / DAILY_ROW_WRITE_LIMIT) * 100).toFixed(2)));
  const status = used >= DAILY_ROW_WRITE_LIMIT ? 'limit_reached' : used >= SAFETY_LIMIT ? 'critical' : used >= HIGH_LIMIT ? 'high' : used >= WARN_LIMIT ? 'watch' : 'healthy';
  return { date: s.day, limit: DAILY_ROW_WRITE_LIMIT, used, remaining, percent, status, protectionMode: used >= SAFETY_LIMIT, source: 'MAULI tracked writes (not Cloudflare account meter)' };
}

// estimatedRows prevents a write from being started when its expected cost would cross the hard ceiling.
export function canWriteD1(env, critical = false, estimatedRows = 1) {
  const s = state(env);
  const estimate = Math.max(1, Number(estimatedRows) || 1);
  if (s.writes + estimate > DAILY_ROW_WRITE_LIMIT) return false;
  if (!critical && s.writes + estimate > SAFETY_LIMIT) return false;
  return true;
}

export function recordD1Write(env, rows = 1) {
  const s = state(env);
  s.writes = Math.min(DAILY_ROW_WRITE_LIMIT, Math.max(0, s.writes) + Math.max(1, Number(rows) || 1));
  return d1QuotaSnapshot(env);
}

export { DAILY_ROW_WRITE_LIMIT, SAFETY_LIMIT, WARN_LIMIT, HIGH_LIMIT };
