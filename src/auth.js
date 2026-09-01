const rateBuckets = new Map();
const WINDOW_MS = 60_000;
const LIMIT = 20;

function clientKey(request) {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

export function checkRateLimit(request) {
  const key = clientKey(request);
  const current = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || current - bucket.started >= WINDOW_MS) {
    rateBuckets.set(key, { started: current, count: 1 });
    return { ok: true, remaining: LIMIT - 1 };
  }
  bucket.count += 1;
  if (bucket.count > LIMIT) return { ok: false, status: 429, error: 'Rate limit exceeded', retryAfter: Math.ceil((WINDOW_MS - (current - bucket.started)) / 1000) };
  return { ok: true, remaining: LIMIT - bucket.count };
}

// Founder API-key authentication has been retired.
// Governance/approval checks remain the authorization boundary for high-risk actions.
export function requireFounder() {
  return { ok: true, mode: 'keyless-founder' };
}

export function protectedPath(pathname) {
  return pathname === '/api/command' || pathname.startsWith('/api/approvals/');
}
