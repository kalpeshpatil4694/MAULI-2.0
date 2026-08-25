import { registerModelProvider, listModelProviders } from './model-provider.js';

function clean(value) { return String(value ?? '').trim(); }
function secretFreeError(message) { return new Error(clean(message).replace(/(api[-_ ]?key|authorization|bearer|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')); }

export function createOpenAICompatibleAdapter({ endpoint, apiKey, fetchImpl = fetch, providerName = 'openai-compatible' } = {}) {
  const url = clean(endpoint);
  const key = clean(apiKey);
  if (!url) throw new Error('Provider endpoint is required');
  return {
    async generate({ messages = [], model, options = {} } = {}) {
      if (!model) throw new Error('Provider model is required');
      const headers = { 'content-type': 'application/json' };
      if (key) headers.authorization = `Bearer ${key}`;
      let response;
      try {
        response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ model, messages, temperature: options.temperature ?? 0.2, max_tokens: options.maxTokens ?? 1200 }) });
      } catch (error) {
        throw secretFreeError(`${providerName} request failed: ${error?.message ?? error}`);
      }
      if (!response?.ok) {
        const text = await response.text().catch(() => '');
        throw secretFreeError(`${providerName} returned HTTP ${response?.status ?? 0}: ${text.slice(0, 300)}`);
      }
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content ?? body?.response ?? body?.output_text;
      if (content == null) throw new Error(`${providerName} returned no usable response`);
      return content;
    }
  };
}

export function createLocalAdapter(generateImpl) {
  if (typeof generateImpl !== 'function') throw new Error('Local provider implementation is required');
  return { generate: async context => generateImpl(context) };
}

export function registerConfiguredProviders(env, { fetchImpl = fetch } = {}) {
  const registered = [];
  const endpoint = clean(env?.MAULI_OPENAI_COMPATIBLE_ENDPOINT);
  const apiKey = clean(env?.MAULI_OPENAI_COMPATIBLE_API_KEY);
  if (endpoint) {
    registerModelProvider('openai-compatible', createOpenAICompatibleAdapter({ endpoint, apiKey, fetchImpl }));
    registered.push('openai-compatible');
  }
  return { registered, available: [...new Set([...listModelProviders(), ...registered])] };
}

export function providerSnapshot() {
  const providers = listModelProviders().sort();
  return { providers, count: providers.length };
}
