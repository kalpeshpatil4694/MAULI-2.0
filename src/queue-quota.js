// Cloudflare Queues Free-plan safety guard.
// These counters are MAULI-local per-isolate protection, not Cloudflare's account meter.
const QUEUE_DAILY_OPERATION_LIMIT = 10000;
const QUEUE_SAFE_OPERATION_LIMIT = 8000;
const QUEUE_WARN_OPERATION_LIMIT = 7000;
const QUEUE_HIGH_OPERATION_LIMIT = 8500;
const QUEUE_CRITICAL_OPERATION_LIMIT = 9000;
const QUEUE_MAX_SAFE_MESSAGE_BYTES = 64 * 1024;

function dayKey(date = new Date()) { return date.toISOString().slice(0, 10); }

function queueState(env) {
  if (!env.__MAULI_QUEUE_QUOTA) env.__MAULI_QUEUE_QUOTA = { day: dayKey(), operations: 0 };
  const state = env.__MAULI_QUEUE_QUOTA;
  const day = dayKey();
  if (state.day !== day) { state.day = day; state.operations = 0; }
  return state;
}

export function queueQuotaSnapshot(env) {
  const state = queueState(env);
  const used = Math.min(QUEUE_DAILY_OPERATION_LIMIT, Math.max(0, Number(state.operations) || 0));
  const remaining = Math.max(0, QUEUE_DAILY_OPERATION_LIMIT - used);
  const status = used >= QUEUE_DAILY_OPERATION_LIMIT ? 'limit_reached'
    : used >= QUEUE_CRITICAL_OPERATION_LIMIT ? 'critical'
    : used >= QUEUE_HIGH_OPERATION_LIMIT ? 'high'
    : used >= QUEUE_WARN_OPERATION_LIMIT ? 'watch'
    : 'healthy';
  return {
    date: state.day,
    limit: QUEUE_DAILY_OPERATION_LIMIT,
    safeLimit: QUEUE_SAFE_OPERATION_LIMIT,
    used,
    remaining,
    percent: Number(((used / QUEUE_DAILY_OPERATION_LIMIT) * 100).toFixed(2)),
    status,
    protectionMode: used >= QUEUE_SAFE_OPERATION_LIMIT,
    source: 'MAULI tracked Queue operations (not Cloudflare account meter)'
  };
}

// Queue charges operations per 64 KiB of message data. MAULI intentionally
// caps a single message at 64 KiB so one logical send cannot consume multiple
// daily operations unexpectedly.
export function queuePayloadBytes(payload) {
  if (payload == null) return 0;
  if (typeof payload === 'string') return new TextEncoder().encode(payload).byteLength;
  if (payload instanceof Uint8Array) return payload.byteLength;
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

export function validateQueuePayload(payload) {
  const bytes = queuePayloadBytes(payload);
  return {
    ok: bytes <= QUEUE_MAX_SAFE_MESSAGE_BYTES,
    bytes,
    maxBytes: QUEUE_MAX_SAFE_MESSAGE_BYTES,
    operationUnits: Math.max(1, Math.ceil(bytes / QUEUE_MAX_SAFE_MESSAGE_BYTES))
  };
}

export function canUseQueue(env, { critical = false, operations = 1, payload = null } = {}) {
  const state = queueState(env);
  const units = Math.max(1, Number(operations) || 1);
  const payloadCheck = payload == null ? { ok: true, bytes: 0, maxBytes: QUEUE_MAX_SAFE_MESSAGE_BYTES, operationUnits: units } : validateQueuePayload(payload);
  if (!payloadCheck.ok) return false;
  if (state.operations + units > QUEUE_DAILY_OPERATION_LIMIT) return false;
  if (!critical && state.operations + units > QUEUE_SAFE_OPERATION_LIMIT) return false;
  return true;
}

export function recordQueueOperation(env, operations = 1) {
  const state = queueState(env);
  state.operations = Math.min(QUEUE_DAILY_OPERATION_LIMIT, Math.max(0, state.operations) + Math.max(1, Number(operations) || 1));
  return queueQuotaSnapshot(env);
}

export function reserveQueueOperation(env, options = {}) {
  const units = Math.max(1, Number(options.operations) || 1);
  if (!canUseQueue(env, { ...options, operations: units })) return false;
  recordQueueOperation(env, units);
  return true;
}

export {
  QUEUE_DAILY_OPERATION_LIMIT,
  QUEUE_SAFE_OPERATION_LIMIT,
  QUEUE_WARN_OPERATION_LIMIT,
  QUEUE_HIGH_OPERATION_LIMIT,
  QUEUE_CRITICAL_OPERATION_LIMIT,
  QUEUE_MAX_SAFE_MESSAGE_BYTES
};
