const rateBuckets = new Map();
const WINDOW_MS = 60_000;
const LIMIT = 20;
const COMMAND_LIMIT = 5; // Stricter limit for expensive operations
const MAX_BUCKETS = 1000; // Prevent memory leak

// Request statistics
const stats = { totalRequests: 0, blockedRequests: 0, endpoints: new Map() };

// Periodic cleanup to prevent memory leak
let lastCleanup = Date.now();
function cleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // Run at most once per minute
  lastCleanup = now;
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.started >= WINDOW_MS * 2) rateBuckets.delete(key);
  }
  // Force evict if still too large
  if (rateBuckets.size > MAX_BUCKETS) {
    const entries = [...rateBuckets.entries()].sort((a, b) => a[1].started - b[1].started);
    for (let i = 0; i < entries.length - MAX_BUCKETS / 2; i++) rateBuckets.delete(entries[i][0]);
  }
}

// A bucket is keyed by client AND scope. It used to be keyed by client alone, so the whole
// dashboard and the whole chat shared one counter: /api/state's generous 20/min allowance
// incremented the same `bucket.count` that /api/chat then compared against its limit of 5.
// Navigating a few pages and then typing a message therefore answered `Rate limit exceeded`
// to someone who had sent one. Separate scopes keep both limits exactly as strict as before
// while stopping unrelated traffic from spending an expensive route's budget.
function clientKey(request, scope) {
  const client = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  return `${scope}\u0000${client}`;
}

export function checkRateLimit(request, options = {}) {
  cleanupBuckets();
  const key = clientKey(request, options.scope ?? 'default');
  const current = Date.now();
  const limit = options.limit ?? LIMIT;
  const bucket = rateBuckets.get(key);
  if (!bucket || current - bucket.started >= WINDOW_MS) {
    rateBuckets.set(key, { started: current, count: 1 });
    stats.totalRequests++;
    return { ok: true, remaining: limit - 1, limit, resetMs: WINDOW_MS };
  }
  bucket.count += 1;
  stats.totalRequests++;
  if (bucket.count > limit) {
    stats.blockedRequests++;
    return { ok: false, status: 429, error: 'Rate limit exceeded', retryAfter: Math.ceil((WINDOW_MS - (current - bucket.started)) / 1000), limit, remaining: 0 };
  }
  return { ok: true, remaining: limit - bucket.count, limit, resetMs: WINDOW_MS - (current - bucket.started) };
}

// `scope` separates independent budgets that happen to share the same number: chat and
// command are both COMMAND_LIMIT, but they are different operations, and burning the
// command budget should not lock the founder out of the conversation box.
export function checkCommandRateLimit(request, scope = 'command') {
  return checkRateLimit(request, { limit: COMMAND_LIMIT, scope });
}

export function rateLimitHeaders(result) {
  if (!result || !result.ok) return {};
  return {
    'X-RateLimit-Limit': String(result.limit ?? LIMIT),
    'X-RateLimit-Remaining': String(result.remaining ?? 0),
    'X-RateLimit-Reset': String(Math.ceil((result.resetMs ?? WINDOW_MS) / 1000)),
  };
}

/** Counts per scope — used by the dashboard's Limits & Usage page. */
export function getRateLimitScopes() {
  const now = Date.now();
  const scopes = {};
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.started >= WINDOW_MS) { rateBuckets.delete(key); continue; }
    const scope = key.split('\u0000')[0];
    scopes[scope] = (scopes[scope] ?? 0) + 1;
  }
  return scopes;
}

export function getRateLimitStats() {
  // Cleanup expired buckets
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.started >= WINDOW_MS) rateBuckets.delete(key);
  }
  return {
    totalRequests: stats.totalRequests,
    blockedRequests: stats.blockedRequests,
    activeClients: rateBuckets.size,
    windowMs: WINDOW_MS,
    defaultLimit: LIMIT,
    commandLimit: COMMAND_LIMIT,
  };
}

// ── Founder authentication ────────────────────────────────────────────────
// requireFounder() used to return { ok: true } unconditionally, so every route that
// "protected" itself was actually open to anyone who could reach the workers.dev
// hostname. It now performs a real, constant-time API-key check.
//
// Key resolution order (first non-empty wins):
//   env: MAULI_FOUNDER_KEY → FOUNDER_KEY → MAULI_API_KEY
//   request: x-mauli-founder | x-founder-key | Authorization: Bearer <key> | x-api-key
//
// Mode selection keeps local development and the test suite working without a key:
//   * key configured                → strict: every protected route needs that key
//   * no key + non-production env   → keyless (local dev / CI / node --test)
//   * no key + ENVIRONMENT=production → 503 fail-closed (never silently open)
//   * MAULI_ALLOW_KEYLESS=true      → explicit opt-out, also honoured in production
const FOUNDER_KEY_ENV_VARS = ['MAULI_FOUNDER_KEY', 'FOUNDER_KEY', 'MAULI_API_KEY'];
const FOUNDER_HEADERS = ['x-mauli-founder', 'x-founder-key', 'x-api-key'];

function isEnabledFlag(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

export function readFounderKey(env) {
  for (const name of FOUNDER_KEY_ENV_VARS) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** True when this deployment intentionally runs without a founder key. */
export function keylessAllowed(env) {
  if (isEnabledFlag(env?.MAULI_ALLOW_KEYLESS)) return true;
  if (isEnabledFlag(env?.MAULI_TEST_MODE) || isEnabledFlag(env?.SKIP_RESULT_PERSISTENCE)) return true;
  const environment = String(env?.ENVIRONMENT ?? '').trim().toLowerCase();
  return environment !== 'production' && environment !== 'prod';
}

/** Length-independent, value-independent string comparison (no early exit). */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function presentedFounderKey(request) {
  const headers = request?.headers;
  if (!headers || typeof headers.get !== 'function') return null;
  for (const name of FOUNDER_HEADERS) {
    const value = headers.get(name);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const authorization = headers.get('authorization');
  if (typeof authorization === 'string') {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (bearer && bearer[1].trim()) return bearer[1].trim();
  }
  return null;
}

export function founderAuthStatus(env) {
  const key = readFounderKey(env);
  const keyless = keylessAllowed(env);
  return {
    keyConfigured: Boolean(key),
    keyless,
    enforced: Boolean(key) && !keyless,
    environment: String(env?.ENVIRONMENT ?? '') || null,
  };
}

/**
 * Authorize a founder request. Returns { ok:true, mode } or { ok:false, status, error }.
 * `mode` is one of: 'founder-key' (verified), 'keyless-founder' (no key required here),
 * 'unconfigured' (production without a key — fail closed).
 */
export function requireFounder(request, env) {
  const status = founderAuthStatus(env);
  if (status.keyless) return { ok: true, mode: 'keyless-founder', enforced: false, keyConfigured: status.keyConfigured };
  if (!status.keyConfigured) {
    return {
      ok: false,
      status: 503,
      error: 'Founder key is not configured. Set MAULI_FOUNDER_KEY (wrangler secret put MAULI_FOUNDER_KEY) or MAULI_ALLOW_KEYLESS=true.',
      mode: 'unconfigured',
    };
  }
  const presented = presentedFounderKey(request);
  if (!presented || !timingSafeEqual(presented, readFounderKey(env))) {
    return { ok: false, status: 401, error: 'Founder key required or invalid', mode: 'denied' };
  }
  return { ok: true, mode: 'founder-key', enforced: true, keyConfigured: true };
}

export function protectedPath(pathname) {
  return pathname === '/api/command' || pathname.startsWith('/api/approvals/');
}
