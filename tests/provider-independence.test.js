import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatibleAdapter, registerConfiguredModels } from '../src/provider-independence.js';
import { modelRegistry } from '../src/model-registry.js';

test('OpenAI-compatible adapter sends standard request and extracts message content', async () => {
  let request;
  const adapter = createOpenAICompatibleAdapter({ endpoint: 'https://provider.test/v1/chat/completions', apiKey: 'secret-key', fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'provider response' } }] }) }; } });
  const result = await adapter.generate({ model: 'provider-model', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(result, 'provider response');
  assert.equal(request.url, 'https://provider.test/v1/chat/completions');
  assert.equal(request.options.headers.authorization, 'Bearer secret-key');
});

test('provider adapter redacts secrets from transport errors', async () => {
  const adapter = createOpenAICompatibleAdapter({ endpoint: 'https://provider.test', apiKey: 'secret-key', fetchImpl: async () => { throw new Error('authorization=secret-key failed'); } });
  await assert.rejects(() => adapter.generate({ model: 'provider-model', messages: [] }), error => { assert.match(error.message, /REDACTED/); assert.doesNotMatch(error.message, /secret-key/); return true; });
});

test('configured provider models register without changing the canonical Cloudflare model', () => {
  const id = 'openai-compatible/test-model';
  registerConfiguredModels({ MAULI_PROVIDER_MODELS_JSON: JSON.stringify([{ id, provider: 'openai-compatible', capabilities: ['planning'], contextWindow: 8192, reasoningScore: 70, codingScore: 70, qualityScore: 75, speedScore: 70, costScore: 60, reliabilityScore: 75, riskLevel: 'normal', enabled: true }]) });
  assert.equal(modelRegistry.get(id).provider, 'openai-compatible');
  assert.ok(modelRegistry.get('@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
});
