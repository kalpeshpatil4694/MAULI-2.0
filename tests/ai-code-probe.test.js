// The AI code path is normally only reachable through the scheduler, which cannot start
// until the project row exists. While D1 writes are refused — the account's daily
// rows_written ceiling, for instance — there is therefore no way to tell "the AI generated
// an app" from "the AI failed and a template was used instead": both end as a completed
// project with one artifact, and the founder is told nothing.
//
// probeAiGeneration() answers that question by running the identical prompt, parsing and
// validation loop against the real binding while persisting nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeAiGeneration } from '../src/functional-code-executor.js';
import { store } from '../src/store.js';

function fakeEnv(response) {
  const calls = [];
  return {
    calls,
    AI: { async run(model, payload) { calls.push({ model, payload }); return { response }; } },
  };
}

const GOOD_RESPONSE = JSON.stringify({
  summary: 'A working calculator',
  files: [
    { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>Calculator</title><link rel="stylesheet" href="styles.css"></head><body><div id="disp">0</div><script src="app.js"></script></body></html>' },
    { path: 'www/app.js', content: 'x'.repeat(400) },
    { path: 'www/styles.css', content: 'y'.repeat(300) },
  ],
});

test('the probe reports a missing AI binding instead of pretending to generate', async () => {
  const result = await probeAiGeneration('Build a calculator', { env: {} });
  assert.equal(result.available, false);
  assert.equal(result.generated, undefined, 'no binding is not a generated app');
  assert.equal(result.reason, 'no-ai-binding');
});

test('a usable model response is reported as generated, with the files it returned', async () => {
  const env = fakeEnv(GOOD_RESPONSE);
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.available, true);
  assert.equal(result.generated, true);
  assert.equal(result.fileCount, 3);
  assert.deepEqual(result.files.map(f => f.path).sort(), ['www/app.js', 'www/index.html', 'www/styles.css']);
  assert.equal(result.hasPlaceholder, false);
  assert.match(result.preview, /<!DOCTYPE html>/, 'the real generated HTML comes back, not a label');
  assert.equal(env.calls.length, 1, 'one AI request was made');
  assert.match(env.calls[0].model, /qwen/, 'the configured code model is the one exercised');
});

test('output the executor would reject is not reported as success', async () => {
  // Only an index.html: the executor requires app.js and styles.css too, so claiming
  // "the AI works" here would be exactly the false positive this route exists to remove.
  const weak = JSON.stringify({ files: [{ path: 'www/index.html', content: '<!DOCTYPE html><html><body>hi</body></html>' }] });
  const result = await probeAiGeneration('Build a calculator web app', { env: fakeEnv(weak) });
  assert.equal(result.generated, false);
  assert.ok(result.error, 'the reason it fell through must be reported');
});

test('an unparseable response is reported as a failure with the model error', async () => {
  const result = await probeAiGeneration('Build a calculator web app', { env: fakeEnv('not json at all') });
  assert.equal(result.available, true);
  assert.equal(result.generated, false);
  assert.ok(result.error);
});

test('a thrown model error is reported rather than crashing the probe', async () => {
  const env = { AI: { async run() { throw new Error('model unavailable'); } } };
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.generated, false);
  assert.match(result.error, /model unavailable/);
});

test('the probe writes nothing to the store', async () => {
  // The entire value of the route is that it is answerable while writes are refused.
  store.configure(null);
  store.data = new Map();
  store.events = [];
  const before = { puts: 0, events: store.events.length };
  const originalPut = store.put.bind(store);
  store.put = (...args) => { before.puts++; return originalPut(...args); };
  try {
    await probeAiGeneration('Build a personal website', { env: fakeEnv(GOOD_RESPONSE) });
  } finally {
    store.put = originalPut;
  }
  assert.equal(before.puts, 0, 'no entity may be persisted by the probe');
  assert.equal(store.events.length, before.events, 'no event may be emitted by the probe');
});
