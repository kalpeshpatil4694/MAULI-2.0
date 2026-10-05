// The AI code path is normally only reachable through the scheduler, which cannot start
// until the project row exists. While D1 writes are refused — the account's daily
// rows_written ceiling, for instance — there is therefore no way to tell "the AI generated
// an app" from "the AI failed and a template was used instead": both end as a completed
// project with one artifact, and the founder is told nothing.
//
// probeAiGeneration() answers that question by running the identical path the executor runs —
// per-file generation with fidelity repair — while persisting nothing. The model answers each
// request with the raw source of the one file asked for; package.json and README.md are
// synthesised locally and are never requested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { probeAiGeneration } from '../src/functional-code-executor.js';
import { store } from '../src/store.js';

const PER_FILE_MARKER = 'Output ONLY the raw contents of ';

const SOURCES = {
  'www/index.html': '<!DOCTYPE html><html><head><title>Calculator</title><link rel="stylesheet" href="styles.css"></head><body><div id="display">0</div><button onclick="press(1)">1</button><button onclick="clearDisplay()">C</button><script src="app.js"></script></body></html>',
  'www/app.js': 'var v="0";function render(){document.getElementById("display").textContent=v;localStorage.setItem("calc",v);}function press(n){v=String(n);render();}function clearDisplay(){v="0";render();}render();',
  'www/styles.css': 'body{font-family:system-ui;background:#0b1120;color:#fff}button{padding:8px 12px;border-radius:6px}',
};

/**
 * A model that answers a per-file request with raw source for the file asked for. `overrides`
 * replaces a specific file's answer (to simulate prose, a shell, or a failure).
 */
function perFileEnv(overrides = {}) {
  const calls = [];
  return {
    calls,
    AI: {
      async run(model, payload) {
        const user = (payload.messages ?? []).map(m => m.content).join('\n');
        calls.push({ model, payload });
        const path = Object.keys(SOURCES).find(p => user.includes(PER_FILE_MARKER + p));
        return { response: overrides[path] ?? SOURCES[path] ?? 'not a file' };
      },
    },
  };
}

test('the probe reports a missing AI binding instead of pretending to generate', async () => {
  const result = await probeAiGeneration('Build a calculator', { env: {} });
  assert.equal(result.available, false);
  assert.equal(result.generated, undefined, 'no binding is not a generated app');
  assert.equal(result.reason, 'no-ai-binding');
});

test('a usable model response is reported as generated, with the files it returned', async () => {
  const env = perFileEnv();
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.available, true);
  assert.equal(result.generated, true);
  assert.equal(result.strategy, 'file-by-file', 'the probe reports the path the executor actually uses');
  assert.equal(result.fileCount, 5, 'three behaviour files plus the synthesised manifest and README');
  assert.deepEqual(result.files.map(f => f.path).sort(), ['README.md', 'package.json', 'www/app.js', 'www/index.html', 'www/styles.css']);
  assert.equal(result.hasPlaceholder, false);
  assert.match(result.preview, /<!DOCTYPE html>/, 'the real generated HTML comes back, not a label');
  assert.equal(env.calls.length, 3, 'one request per behaviour file; the manifest and README are synthesised');
  assert.match(env.calls[0].model, /qwen/, 'the configured code model is the one exercised');
});

test('output the executor would reject is not reported as success', async () => {
  // The HTML comes back as prose, not markup, so the app has no page the executor will accept.
  const env = perFileEnv({ 'www/index.html': 'Sorry, I cannot write that file.' });
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.generated, false);
  assert.ok(result.error, 'the reason it fell through must be reported');
});

test('an answer that is not the requested source is reported as a failure, not success', async () => {
  const env = perFileEnv({ 'www/index.html': 'not html', 'www/app.js': 'not js', 'www/styles.css': 'not css' });
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.available, true);
  assert.equal(result.generated, false);
  assert.ok(result.error);
});

test('a thrown model error is reported rather than crashing the probe', async () => {
  const env = { AI: { async run() { throw new Error('model unavailable'); } } };
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.generated, false);
  assert.match(result.error, /per-file|model unavailable/);
});

test('a generated but fidelity-failing app is reported as NOT generated', async () => {
  // A static shell: no controls, no listeners. The gate refuses it and the executor would
  // fall back to a template, so the probe must not call it deliverable either.
  const env = perFileEnv({
    'www/index.html': '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Calc</h1><p>Nothing yet</p><script src="app.js"></script></body></html>',
    'www/app.js': 'var v=localStorage.getItem("calc")||"0";function render(){var el=document.getElementById("display");if(el)el.textContent=v;}render();',
  });
  const result = await probeAiGeneration('Build a calculator web app', { env });
  assert.equal(result.generated, false, 'the executor would refuse this, so the probe must not call it success');
  assert.equal(result.fidelity.passed, false);
  assert.ok(result.fidelity.violations.includes('no-interaction'), JSON.stringify(result.fidelity));
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
    await probeAiGeneration('Build a personal website', { env: perFileEnv() });
  } finally {
    store.put = originalPut;
  }
  assert.equal(before.puts, 0, 'no entity may be persisted by the probe');
  assert.equal(store.events.length, before.events, 'no event may be emitted by the probe');
});

test('the probe always reports an installable manifest, synthesised locally', async () => {
  // The model is no longer asked for a manifest, so it can never return the empty {} that
  // breaks the build. The manifest is produced from the objective instead.
  const result = await probeAiGeneration('Build a simple calculator web app', { env: perFileEnv(), includeContent: true });
  assert.equal(result.generated, true);
  const manifest = JSON.parse(result.files.find(f => f.path === 'package.json').content);
  assert.ok(manifest.name && manifest.version, 'a real manifest with name and version');
  assert.equal(manifest.scripts.start, 'npx serve www');
});

test('includeContent returns the generated code, not just its size', async () => {
  // "Generated" is not the same as "delivered". Without the actual bytes the founder has
  // nothing to open, and the claim that the AI works rests on a summary line.
  const result = await probeAiGeneration('Build a simple calculator web app', { env: perFileEnv(), includeContent: true });
  assert.equal(result.generated, true);
  const html = result.files.find(f => f.path === 'www/index.html');
  assert.match(html.content, /<!DOCTYPE html>/);
  assert.ok(html.content.length > 50, 'the real source comes back');
  const without = await probeAiGeneration('Build a simple calculator web app', { env: perFileEnv() });
  assert.equal(without.files.find(f => f.path === 'www/index.html').content, undefined,
    'the default response stays small');
});

test('the synthesised manifest is named after the project, not the instruction', async () => {
  // "build-a-pomodoro-timer-web-app-with-a-wo" describes the request, not the project.
  const result = await probeAiGeneration('Build a simple pomodoro timer web app with a session counter', { env: perFileEnv(), includeContent: true });
  const manifest = JSON.parse(result.files.find(f => f.path === 'package.json').content);
  assert.equal(manifest.name, 'pomodoro-timer-session', 'instruction words are dropped, the subject is kept');
  assert.ok(!manifest.name.endsWith('-'), 'no mid-word truncation');
  assert.match(manifest.name, /^[a-z0-9-]+$/, 'a valid npm name');
});
