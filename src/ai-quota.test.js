import assert from 'node:assert/strict';
import { aiQuotaSnapshot, generateAI, code, AI_DAILY_REQUEST_LIMIT, AI_SAFE_REQUEST_LIMIT } from './ai.js';

function env() {
  return { AI: { async run() { return { response: 'ok' }; } } };
}

const e = env();
// The old budget was 20 requests for the whole day on a model that bills 204,805 neurons
// per M output tokens — roughly 17 three-file apps out of the 10,000 free neurons, which
// the pipeline hit constantly. Code now runs on a cheaper code model, so the local guard
// can cover the free neuron allowance instead of firing while there is budget left.
assert.equal(AI_DAILY_REQUEST_LIMIT, 100);
assert.equal(AI_SAFE_REQUEST_LIMIT, 90);
assert.equal(aiQuotaSnapshot(e).used, 0);

for (let i = 0; i < AI_DAILY_REQUEST_LIMIT; i++) await generateAI(e, [{ role: 'user', content: 'x' }]);
const snapshot = aiQuotaSnapshot(e);
assert.equal(snapshot.used, 100);
assert.equal(snapshot.status, 'limit_reached');
await assert.rejects(() => generateAI(e, [{ role: 'user', content: 'x' }]), /daily safety limit reached/);

// Code generation asks for the cheap code model first and falls back to the configured
// chat model when that model is unavailable, so one bad model id cannot cost a project
// its app (the old behaviour was an immediate silent template fallback).
const calls = [];
const fallbackEnv = {
  MAULI_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  AI: {
    async run(model) {
      calls.push(model);
      if (model !== '@cf/meta/llama-3.3-70b-instruct-fp8-fast') throw new Error('model unavailable');
      return { response: '{"files":[]}' };
    },
  },
};
assert.equal(await code(fallbackEnv, [{ role: 'user', content: 'build an app' }]), '{"files":[]}');
assert.deepEqual(calls, ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);

// An explicit model still wins, and a failure on the last option is reported.
const explicit = { AI: { async run(model) { calls.push(model); return { response: 'x' }; } } };
calls.length = 0;
await code(explicit, [{ role: 'user', content: 'x' }], { model: 'custom-model' });
assert.deepEqual(calls, ['custom-model']);
const both = { MAULI_MODEL: 'a', AI: { async run() { throw new Error('nope'); } } };
await assert.rejects(() => code(both, [{ role: 'user', content: 'x' }]), /nope/);
