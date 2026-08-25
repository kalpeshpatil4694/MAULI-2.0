export const MODEL_PROVIDER_ADAPTERS = new Map();

export function registerModelProvider(name, adapter) {
  if (!name || typeof name !== 'string') throw new Error('Provider name is required');
  if (!adapter || typeof adapter.generate !== 'function') throw new Error(`Provider adapter for ${name} must expose generate()`);
  MODEL_PROVIDER_ADAPTERS.set(name, adapter);
  return adapter;
}

export function listModelProviders() { return [...MODEL_PROVIDER_ADAPTERS.keys()]; }

export async function generateWithProvider(provider, context = {}) {
  const adapter = MODEL_PROVIDER_ADAPTERS.get(provider);
  if (!adapter) throw new Error(`Unsupported AI provider: ${provider}`);
  return adapter.generate(context);
}
