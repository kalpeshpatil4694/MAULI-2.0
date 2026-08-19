import { now } from './core.js';

/**
 * Provider-neutral execution adapter.
 * L1 can use a local/open-source runner later; paid/cloud runners remain optional.
 */
const adapters = new Map();

export function registerExecutionAdapter(name, adapter) {
  if (!name || !adapter || typeof adapter.execute !== 'function') throw new Error('Invalid execution adapter');
  adapters.set(name, adapter);
  return { name, registeredAt: now() };
}

export function listExecutionAdapters() {
  return [...adapters.entries()].map(([name, adapter]) => ({
    name,
    capabilities: adapter.capabilities ?? [],
    cost: adapter.cost ?? 'unknown',
    available: typeof adapter.available === 'function' ? Boolean(adapter.available()) : true
  }));
}

export function getExecutionAdapter(name) {
  return adapters.get(name) ?? null;
}

export async function executeWithAdapter(name, request = {}) {
  const adapter = getExecutionAdapter(name);
  if (!adapter) throw new Error(`Execution adapter not registered: ${name}`);
  if (typeof adapter.available === 'function' && !adapter.available(request)) throw new Error(`Execution adapter unavailable: ${name}`);
  return adapter.execute(request);
}

registerExecutionAdapter('artifact-only', {
  capabilities: ['artifact-validation', 'metadata'],
  cost: 'zero',
  available: () => true,
  execute: async ({ artifact }) => ({
    adapter: 'artifact-only',
    status: artifact ? 'accepted' : 'rejected',
    executed: false,
    reason: artifact ? 'Artifact recorded; no arbitrary code execution in Worker.' : 'Artifact missing'
  })
});
