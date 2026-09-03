export const now = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomUUID()}`;

// Security headers for all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export const ok = (data = {}, status = 200) => Response.json({ ok: true, data }, { status, headers: SECURITY_HEADERS });
export const fail = (message, status = 400, details = undefined) => Response.json({ ok: false, error: { message, ...(details ? { details } : {}) } }, { status, headers: SECURITY_HEADERS });

export function json(request) {
  return request.json().catch(() => ({}));
}

// Input validation helpers
export function validateString(value, name, options = {}) {
  if (value == null || typeof value !== 'string') return { ok: false, error: `${name} is required and must be a string` };
  const trimmed = value.trim();
  if (options.minLength && trimmed.length < options.minLength) return { ok: false, error: `${name} must be at least ${options.minLength} characters` };
  if (options.maxLength && trimmed.length > options.maxLength) return { ok: false, error: `${name} must be at most ${options.maxLength} characters` };
  if (options.pattern && !options.pattern.test(trimmed)) return { ok: false, error: `${name} has invalid format` };
  return { ok: true, value: trimmed };
}

export function validateId(value, name = 'id') {
  if (!value || typeof value !== 'string') return { ok: false, error: `${name} is required` };
  if (value.length > 200) return { ok: false, error: `${name} is too long` };
  return { ok: true, value };
}

export function validateBody(body, fields = []) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Request body is required' };
  for (const field of fields) {
    if (field.required && (body[field.name] == null || body[field.name] === '')) {
      return { ok: false, error: `${field.name} is required` };
    }
  }
  return { ok: true };
}

// Rate-limited response with retry-after
export function rateLimited(retryAfter = 60) {
  return new Response(JSON.stringify({ ok: false, error: { message: 'Rate limit exceeded', retryAfter } }), {
    status: 429,
    headers: { ...SECURITY_HEADERS, 'Retry-After': String(retryAfter), 'Content-Type': 'application/json' },
  });
}

// CORS headers for API responses
export function corsHeaders(origin = '*') {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' };
}

// Safe JSON parse with fallback
export function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

// Sanitize string for display (prevent XSS)
export function sanitize(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function route(path, method, expectedPath, expectedMethod = 'GET') {
  return method === expectedMethod && path === expectedPath;
}

export const capability = (name, description, tools = []) => ({ name, description, tools });
