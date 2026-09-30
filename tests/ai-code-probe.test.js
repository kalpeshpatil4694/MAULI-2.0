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
  assert.equal(result.fileCount, 4, 'the three generated files plus the synthesised manifest');
  assert.deepEqual(result.files.map(f => f.path).sort(), ['package.json', 'www/app.js', 'www/index.html', 'www/styles.css']);
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

test('an empty {} manifest is repaired rather than shipped', async () => {
  // The probe's prompt example literally showed "content":"{}", and the model obeyed: every
  // generated project carried a 2-byte manifest that cannot be installed or built. Rejecting
  // it would discard the whole app for a template fallback; repairing it delivers the code.
  const weakManifest = JSON.stringify({
    summary: 'Calculator',
    files: [
      { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>c</title><link rel="stylesheet" href="styles.css"></head><body><div id="d">0</div><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'x'.repeat(400) },
      { path: 'www/styles.css', content: 'y'.repeat(300) },
      { path: 'package.json', content: '{}' },
    ],
  });
  const result = await probeAiGeneration('Build a simple calculator web app', { env: fakeEnv(weakManifest) });
  assert.equal(result.generated, true, 'the app is kept');
  const manifest = result.files.find(f => f.path === 'package.json');
  assert.ok(manifest, 'a manifest is always present');
  assert.ok(manifest.bytes > 2, `the empty manifest must be repaired, got ${manifest.bytes} bytes`);
});

test('a real manifest from the model is left alone', async () => {
  const real = JSON.stringify({
    summary: 'Calculator',
    files: [
      { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>c</title><link rel="stylesheet" href="styles.css"></head><body><div id="d">0</div><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'x'.repeat(400) },
      { path: 'www/styles.css', content: 'y'.repeat(300) },
      { path: 'package.json', content: JSON.stringify({ name: 'calc', version: '2.0.0', dependencies: { serve: '^14' } }) },
    ],
  });
  const result = await probeAiGeneration('Build a simple calculator web app', { env: fakeEnv(real) });
  const manifest = result.files.find(f => f.path === 'package.json');
  assert.ok(manifest.bytes > 40, 'the model’s own manifest is preserved');
});

test('a missing manifest is added so the project can always be built', async () => {
  const noManifest = JSON.stringify({
    files: [
      { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>c</title><link rel="stylesheet" href="styles.css"></head><body><div id="d">0</div><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'x'.repeat(400) },
      { path: 'www/styles.css', content: 'y'.repeat(300) },
    ],
  });
  const result = await probeAiGeneration('Build a simple calculator web app', { env: fakeEnv(noManifest) });
  assert.ok(result.files.some(f => f.path === 'package.json'), 'a manifest is synthesised when absent');
});

test('includeContent returns the generated code, not just its size', async () => {
  // "Generated" is not the same as "delivered". Without the actual bytes the founder has
  // nothing to open, and the claim that the AI works rests on a summary line.
  const result = await probeAiGeneration('Build a simple calculator web app', { env: fakeEnv(GOOD_RESPONSE), includeContent: true });
  assert.equal(result.generated, true);
  const html = result.files.find(f => f.path === 'www/index.html');
  assert.match(html.content, /<!DOCTYPE html>/);
  assert.ok(html.content.length > 50, 'the real source comes back');
  const without = await probeAiGeneration('Build a simple calculator web app', { env: fakeEnv(GOOD_RESPONSE) });
  assert.equal(without.files.find(f => f.path === 'www/index.html').content, undefined,
    'the default response stays small');
});

test('a synthesised manifest is named after the project, not the instruction', async () => {
  // "build-a-pomodoro-timer-web-app-with-a-wo" describes the request, not the project.
  const noManifest = JSON.stringify({
    files: [
      { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>t</title><link rel="stylesheet" href="styles.css"></head><body><div id="d"></div><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'x'.repeat(400) },
      { path: 'www/styles.css', content: 'y'.repeat(300) },
    ],
  });
  const result = await probeAiGeneration('Build a simple pomodoro timer web app with a session counter', { env: fakeEnv(noManifest), includeContent: true });
  const manifest = JSON.parse(result.files.find(f => f.path === 'package.json').content);
  assert.equal(manifest.name, 'pomodoro-timer-session', 'instruction words are dropped, the subject is kept');
  assert.ok(!manifest.name.endsWith('-'), 'no mid-word truncation');
  assert.match(manifest.name, /^[a-z0-9-]+$/, 'a valid npm name');
});
