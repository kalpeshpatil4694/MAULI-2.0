export const now = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomUUID()}`;

export const ok = (data = {}, status = 200) => Response.json({ ok: true, ...data }, { status });
export const fail = (message, status = 400, details = undefined) => Response.json({ ok: false, error: { message, ...(details ? { details } : {}) } }, { status });

export function json(request) {
  return request.json().catch(() => ({}));
}

export function route(path, method, expectedPath, expectedMethod = 'GET') {
  return method === expectedMethod && path === expectedPath;
}

export const capability = (name, description, tools = []) => ({ name, description, tools });
