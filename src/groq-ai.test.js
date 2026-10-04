import assert from 'node:assert/strict';
import { generateAI, code, getAIConfig } from './ai.js';
import { groqGenerate, groqConfigured, groqModel, GroqConfigError, GROQ_DEFAULT_MODEL } from './groq-ai.js';

const messages = [{ role: 'user', content: 'build a todo app' }];

// A missing, blank or non-string key means Groq is simply not set up — never a runtime call.
assert.equal(groqConfigured({}), false);
assert.equal(groqConfigured({ GROQ_API_KEY: '' }), false);
assert.equal(groqConfigured({ GROQ_API_KEY: '   ' }), false);
assert.equal(groqConfigured({ GROQ_API_KEY: 12345 }), false);
assert.equal(groqConfigured({ GROQ_API_KEY: 'gsk_live' }), true);
assert.equal(groqConfigured({ MAULI_GROQ_KEY: 'gsk_live' }), true);
// The model is configurable but defaults to a Groq-hosted model.
assert.equal(groqModel({}, {}), GROQ_DEFAULT_MODEL);
assert.equal(groqModel({ MAULI_GROQ_MODEL: 'llama-3.1-8b-instant' }, {}), 'llama-3.1-8b-instant');
assert.equal(groqModel({ MAULI_GROQ_MODEL: 'llama-3.1-8b-instant' }, { groqModel: 'override' }), 'override');

// A missing key refuses without touching the network.
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error('network must not be reached'); };
try {
  await assert.rejects(() => groqGenerate({}, messages), GroqConfigError);
  await assert.rejects(() => groqGenerate({ GROQ_API_KEY: '  ' }, messages), /GROQ_API_KEY/);
  assert.equal(fetchCalls, 0, 'a missing key must not issue a Groq request');
} finally {
  globalThis.fetch = originalFetch;
}

/** Install a fetch stub that records the request and answers with `responder`. */
function withFetchStub(responder, run) {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? '{}') });
    return responder(url, init);
  };
  return Promise.resolve(run(calls)).finally(() => { globalThis.fetch = saved; });
}

const okResponse = (content) => new Response(
  JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } }
);

// The promised chain: Cloudflare Workers AI fails (here: the exhausted 4006 allowance) and
// the request is served by Groq before any deterministic template is reached.
await withFetchStub(
  () => okResponse('{"files":[{"path":"www/index.html","content":"<html></html>"}]}'),
  async (calls) => {
    const env = {
      GROQ_API_KEY: 'gsk_test_key',
      AI: { async run() { throw new Error('Workers AI daily free allocation exhausted (4006)'); } }
    };
    const out = await generateAI(env, messages, { maxTokens: 1200 });
    assert.equal(out, '{"files":[{"path":"www/index.html","content":"<html></html>"}]}');
    assert.equal(calls.length, 1, 'Cloudflare is tried first, then Groq exactly once');
    const [call] = calls;
    assert.match(call.url, /^https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions$/);
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.Authorization, 'Bearer gsk_test_key');
    assert.equal(call.body.model, GROQ_DEFAULT_MODEL);
    assert.equal(call.body.messages.length, 1);
    assert.equal(call.body.max_tokens, 1200);
  }
);

// Code generation routes through the same fallback, so a Groq key rescues a spent Workers AI
// allowance for the code path as well.
await withFetchStub(() => okResponse('{"files":[]}'), async (calls) => {
  const env = { GROQ_API_KEY: 'gsk_test_key', AI: { async run() { throw new Error('4006 exceeded'); } } };
  assert.equal(await code(env, messages), '{"files":[]}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.max_tokens, 1200);
});

// An explicit `provider: 'groq'` goes straight to Groq — Cloudflare is not attempted, so a
// caller can select the fallback deliberately.
await withFetchStub(() => okResponse('groq-only'), async (calls) => {
  let cloudflareCalled = false;
  const env = { GROQ_API_KEY: 'gsk_test_key', AI: { async run() { cloudflareCalled = true; return { response: 'cf' }; } } };
  assert.equal(await generateAI(env, messages, { provider: 'groq' }), 'groq-only');
  assert.equal(cloudflareCalled, false);
  assert.equal(calls.length, 1);
});

// A blank key with provider 'groq' is a configuration error, not a crash.
await withFetchStub(() => okResponse('never'), async (calls) => {
  await assert.rejects(() => generateAI({}, messages, { provider: 'groq' }), GroqConfigError);
  assert.equal(calls.length, 0);
});

// An invalid key (401) is reported clearly and never fabricated into content...
await withFetchStub(() => new Response('{"error":"invalid api key"}', { status: 401 }), async () => {
  await assert.rejects(() => groqGenerate({ GROQ_API_KEY: 'gsk_bad' }, messages), /rejected the API key/);
});
// ...and a rate limit names itself too.
await withFetchStub(() => new Response('rate limited', { status: 429 }), async () => {
  await assert.rejects(() => groqGenerate({ GROQ_API_KEY: 'gsk_busy' }, messages), /rate limit/);
});
// An empty completion is a failure, so the template fallback still runs.
await withFetchStub(() => okResponse('   '), async () => {
  await assert.rejects(() => groqGenerate({ GROQ_API_KEY: 'gsk_x' }, messages), /empty response/);
});

// When BOTH providers fail, the caller receives the Workers AI failure (the allowance the
// founder acts on) so the executor's deterministic template fallback decides what ships.
await withFetchStub(() => new Response('', { status: 401 }), async () => {
  const env = { GROQ_API_KEY: 'gsk_bad', AI: { async run() { throw new Error('Workers AI daily free allocation exhausted (4006)'); } } };
  await assert.rejects(() => generateAI(env, messages), /daily free allocation exhausted/);
});

// A Groq-only environment (no Workers AI binding at all) is still served: the missing binding
// is an ordinary Cloudflare failure, so the fallback answers instead of erroring out.
await withFetchStub(() => okResponse('from groq without a binding'), async (calls) => {
  assert.equal(await generateAI({ GROQ_API_KEY: 'gsk_test_key' }, messages), 'from groq without a binding');
  assert.equal(calls.length, 1);
});

// An unknown provider is still refused (the switch only accepts cloudflare and groq).
await assert.rejects(() => generateAI({}, messages, { provider: 'nope' }), /Unsupported AI provider: nope/);

// The config advertises the new chain.
assert.equal(getAIConfig({}).groqConfigured, false);
assert.equal(getAIConfig({ GROQ_API_KEY: 'gsk_live' }).groqConfigured, true);
assert.equal(getAIConfig({}).fallback, 'workers-ai -> groq -> deterministic-free-planner');
