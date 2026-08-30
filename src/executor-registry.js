const handlers = new Map();
const permissions = new Map();

export function registerExecutor(name, handler, meta = {}) {
  if (!name || typeof handler !== 'function') throw new Error('Executor name and handler are required');
  handlers.set(name, { handler, ...meta });
}

export function listExecutors() {
  return [...handlers.entries()].map(([name, x]) => ({
    name,
    description: x.description ?? '',
    risk: x.risk ?? 'normal',
    capabilities: x.capabilities ?? []
  }));
}

export function getExecutor(name) {
  return handlers.get(name);
}

export function grantExecutor(name, scope = 'internal') {
  permissions.set(name, scope);
  return { name, scope };
}

export function getExecutorScope(name, fallback = 'internal') {
  return permissions.get(name) ?? fallback;
}
