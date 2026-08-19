import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const aa = new TextEncoder().encode(String(a));
  const bb = new TextEncoder().encode(String(b));
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
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
