const productionHeaders = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'cache-control': 'no-store' };

export const now = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomUUID()}`;

export const ok = (data = {}, status = 200) => Response.json({ ok: true, data }, { status, headers: productionHeaders });
export const fail = (message, status = 400, details = undefined) => Response.json({ ok: false, error: { message, ...(details ? { details } : {}) } }, { status, headers: productionHeaders });

export function json(request) {
  const length = Number(request?.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(length) && length > 1048576) return Promise.resolve({});
  return request.json().catch(() => ({}));
}

export function route(path, method, expectedPath, expectedMethod = 'GET') {
  return method === expectedMethod && path === expectedPath;
}

export const capability = (name, description, tools = []) => ({ name, description, tools });
