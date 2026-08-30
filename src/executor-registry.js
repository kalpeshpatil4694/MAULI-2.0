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

// Built-in deterministic executor used by planning/lifecycle tests and by
// the orchestration layer before a specialized implementation is selected.
// It uses the governed health tool when available, preserving the original
// diagnostics contract without importing tools.js and recreating a cycle.
registerExecutor('internal.plan', async ({ task, callTool }) => {
  let diagnostics = { healthy: true };
  if (typeof callTool === 'function') {
    try {
      const health = await callTool('health.check', { type: 'planning-diagnostics' });
      if (health && typeof health === 'object') diagnostics = health;
    } catch (_) {
      // Planning remains deterministic when the optional health tool is not registered.
    }
  }
  return {
    type: 'plan',
    taskId: task?.id,
    output: 'Execution plan generated.',
    diagnostics,
    summary: String(task?.description || task?.title || 'Execution plan')
  };
}, {
  description: 'Safe internal planning executor',
  risk: 'low',
  scope: 'internal',
  capabilities: ['planning']
});
grantExecutor('internal.plan', 'internal');
