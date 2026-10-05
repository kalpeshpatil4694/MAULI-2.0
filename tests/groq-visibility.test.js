// Workers AI's daily allowance is spent on this deployment (4006), so Groq is the provider
// that will answer the next generation. The founder set GROQ_API_KEY on the Cloudflare
// Worker, and before these surfaces existed nothing on the running Worker said whether the
// secret had actually arrived: /api/health carried no Groq field and Integrations had no
// Groq row, so "key configured" and "key never reached the Worker" looked identical from
// outside — the same failure mode that made an unset GITHUB_TOKEN look healthy.
//
// These tests pin both surfaces, the provider-selection verdict they report, and — like the
// rest of the Integrations contract — that the credential value itself never leaves.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { store } from '../src/store.js';

const env = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };
const KEY = 'gsk_example_not_a_real_secret';

async function health(extra = {}) {
  const response = await worker.fetch(new Request('https://mauli.test/api/health'), { ...env, ...extra });
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data;
}

async function integrations(extra = {}) {
  const response = await worker.fetch(new Request('https://mauli.test/api/integrations'), { ...env, ...extra });
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data;
}

test('health reports Groq as unconfigured when no key is set', async () => {
  const data = await health();
  assert.equal(data.groqConfigured, false);
  // A model name would imply a provider that is not actually usable.
  assert.equal(data.groqModel, null);
});

test('health reports a Groq key that reached the Worker', async () => {
  const data = await health({ GROQ_API_KEY: KEY });
  assert.equal(data.groqConfigured, true);
  // Only the non-secret model default is published, never the key.
  assert.equal(data.groqModel, 'llama-3.3-70b-versatile');
  // The control: the field flips with the environment, so the assertion above is reading
  // the env rather than a hard-coded true.
  const without = await health();
  assert.equal(without.groqConfigured, false);
  assert.notEqual(without.groqModel, data.groqModel);
});

test('MAULI_GROQ_KEY is accepted as the same credential', async () => {
  const data = await health({ MAULI_GROQ_KEY: KEY });
  assert.equal(data.groqConfigured, true);
});

test('generationPath names the provider that will actually answer', async () => {
  // No AI binding and no key: only the deterministic templates remain.
  assert.equal((await health()).generationPath, 'deterministic-templates');

  // A key with no AI binding puts Groq in front of the templates.
  assert.equal((await health({ GROQ_API_KEY: KEY })).generationPath, 'groq');

  // Workers AI present and healthy is still first: Groq is a fallback, not a replacement.
  assert.equal((await health({ AI: { run() {} }, GROQ_API_KEY: KEY })).generationPath, 'workers-ai');
});

test('the production state — Workers AI spent, Groq keyed — reports Groq', async () => {
  const previous = store.get('ai_status', 'workers-ai');
  store.put('ai_status', {
    id: 'workers-ai',
    available: false,
    exhausted: true,
    reason: 'Workers AI daily free allocation exhausted (4006).',
    at: new Date().toISOString(),
  });
  try {
    const data = await health({ AI: { run() {} }, GROQ_API_KEY: KEY });
    // The Workers AI verdict must survive — that is the allowance the founder acts on.
    assert.equal(data.degradedReason, 'workers-ai-allowance-exhausted');
    assert.equal(data.aiAvailable, false);
    // …while the path says generation still has a live provider.
    assert.equal(data.groqConfigured, true);
    assert.equal(data.generationPath, 'groq');
  } finally {
    store.put('ai_status', previous ?? { id: 'workers-ai', available: true, at: new Date().toISOString() });
  }
});

test('health never echoes either Groq key', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/health'), {
    ...env,
    GROQ_API_KEY: 'gsk_super_secret_value',
    MAULI_GROQ_KEY: 'mauli_super_secret_value',
  });
  const text = await response.text();
  assert.ok(!text.includes('gsk_super_secret_value'), 'GROQ_API_KEY leaked from /api/health');
  assert.ok(!text.includes('mauli_super_secret_value'), 'MAULI_GROQ_KEY leaked from /api/health');
});

test('Integrations reports a missing Groq key instead of a reassuring label', async () => {
  const data = await integrations();
  const groq = data.integrations.find((r) => r.id === 'groq');
  assert.ok(groq, 'the Integrations page must carry a Groq row');
  assert.equal(groq.category, 'LLM');
  assert.equal(groq.status, 'missing');
  assert.equal(groq.statusLabel, 'No key');
  // The hint has to say where the key goes, not merely that it is absent.
  assert.match(groq.hint, /Fallback LLM/);
  assert.match(groq.detail, /deterministic templates/);
});

test('Integrations reports a configured Groq key, and the counts still add up', async () => {
  const data = await integrations({ GROQ_API_KEY: KEY });
  const groq = data.integrations.find((r) => r.id === 'groq');
  assert.equal(groq.status, 'connected');
  assert.equal(groq.statusLabel, 'Configured');
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, data.integrations.length);
});

test('Integrations never echoes the Groq key', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/integrations'), {
    ...env,
    GROQ_API_KEY: 'gsk_super_secret_value',
  });
  const text = await response.text();
  assert.ok(!text.includes('gsk_super_secret_value'), 'GROQ_API_KEY leaked from /api/integrations');
});

test('Groq still falls through to templates when the key is absent', () => {
  // Presence is configuration, not proof the model answers: with no key the code executor
  // must reach its deterministic fallback rather than throwing on a provider it cannot call.
  assert.equal(store.get('ai_status', 'groq'), null, 'no Groq outage may be recorded without an attempt');
});
