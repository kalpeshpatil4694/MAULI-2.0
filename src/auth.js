import { timingSafeEqual } from 'node:crypto';

const rateBuckets = new Map();
const WINDOW_MS = 60_000;
const LIMIT = 20;

function safeEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function clientKey(request) {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
}

export function checkRateLimit(request) {
  const key = clientKey(request);
  const current = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || current - bucket.started >= WINDOW_MS) {
    rateBuckets.set(key, { started:current, count:1 });
    return { ok:true, remaining:LIMIT - 1 };
  }
  bucket.count += 1;
  if (bucket.count > LIMIT) return { ok:false, status:429, error:'Rate limit exceeded', retryAfter:Math.ceil((WINDOW_MS - (current - bucket.started)) / 1000) };
  return { ok:true, remaining:LIMIT - bucket.count };
}

export function requireFounder(request, env) {
  const expected = env?.FOUNDER_API_KEY;
  if (!expected) return { ok:false, status:503, error:'Founder authorization is not configured' };
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!supplied || !safeEqual(supplied, expected)) return { ok:false, status:401, error:'Founder authorization required' };
  return { ok:true };
}

export function protectedPath(pathname) {
  return pathname === '/api/command' || pathname.startsWith('/api/approvals/');
}
