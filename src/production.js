import { now } from './core.js';

const DEFAULTS = Object.freeze({ maxRequestBytes: 1048576, maxEvents: 500, maxProjectsInState: 200, maxTasksInState: 1000, maxArtifactsInState: 500, requestTimeoutMs: 30000 });

function boundedInt(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; }

export function productionConfig(env = {}) {
  return {
    maxRequestBytes: boundedInt(env.MAULI_MAX_REQUEST_BYTES, DEFAULTS.maxRequestBytes, 16384, 10485760),
    maxEvents: boundedInt(env.MAULI_MAX_EVENTS, DEFAULTS.maxEvents, 1, 5000),
    maxProjectsInState: boundedInt(env.MAULI_MAX_PROJECTS_STATE, DEFAULTS.maxProjectsInState, 1, 1000),
    maxTasksInState: boundedInt(env.MAULI_MAX_TASKS_STATE, DEFAULTS.maxTasksInState, 1, 5000),
    maxArtifactsInState: boundedInt(env.MAULI_MAX_ARTIFACTS_STATE, DEFAULTS.maxArtifactsInState, 1, 2000),
    requestTimeoutMs: boundedInt(env.MAULI_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs, 1000, 120000)
  };
}

export function requestId(request) {
  const supplied = request?.headers?.get?.('x-request-id');
  if (supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)) return supplied;
  return `req_${crypto.randomUUID()}`;
}

export function securityHeaders() {
  return { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cache-control': 'no-store' };
}

export function productionSnapshot({ env = {}, recoveredRuns = [], store } = {}) {
  const config = productionConfig(env);
  const events = typeof store?.recentEvents === 'function' ? store.recentEvents(config.maxEvents) : [];
  return { service: 'mauli2.0', environment: env.ENVIRONMENT ?? 'unknown', persistence: Boolean(env?.DB && typeof env.DB.prepare === 'function'), ai: Boolean(env?.AI), recoveredRuns: Array.isArray(recoveredRuns) ? recoveredRuns.length : 0, eventCount: events.length, limits: config, timestamp: now() };
}

export function isProductionHealthy(snapshot) { return Boolean(snapshot?.persistence && snapshot?.environment && snapshot?.service === 'mauli2.0'); }
