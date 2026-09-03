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

function clientKey(request) {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

export function checkRateLimit(request, options = {}) {
  cleanupBuckets();
  const key = clientKey(request);
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

export function checkCommandRateLimit(request) {
  return checkRateLimit(request, { limit: COMMAND_LIMIT });
}

export function rateLimitHeaders(result) {
  if (!result || !result.ok) return {};
  return {
    'X-RateLimit-Limit': String(result.limit ?? LIMIT),
    'X-RateLimit-Remaining': String(result.remaining ?? 0),
    'X-RateLimit-Reset': String(Math.ceil((result.resetMs ?? WINDOW_MS) / 1000)),
  };
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

// Founder API-key authentication has been retired.
// Governance/approval checks remain the authorization boundary for high-risk actions.
export function requireFounder() {
  return { ok: true, mode: 'keyless-founder' };
}

export function protectedPath(pathname) {
  return pathname === '/api/command' || pathname.startsWith('/api/approvals/');
}
