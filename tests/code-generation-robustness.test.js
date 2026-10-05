// Generation asks for ONE FILE PER REQUEST. A single request for a whole app asked the model
// to emit five complete files as escaped JSON in one completion; measured against the live
// Groq provider that failed for anything larger than a toy app — the answer was cut before the
// JSON closed, and projects kept reaching "Delivery blocked: MAULI could not build ...
// unrelated template". Per-file raw source is the primary path now, and it is repaired against
// the fidelity gate before anything is shipped.
//
// Four things are pinned here, because each one can silently stop being true:
//  1. an app is generated one file per request (no doomed whole-app attempts first);
//  2. a per-file answer that is the whole-app envelope is refused rather than stored as
//     source, which is the failure mode the fix could otherwise have introduced;
//  3. a per-file app that arrives as a static shell is REPAIRED against the fidelity gate,
//     and one that cannot be repaired falls back to a template rather than shipping a demo;
//  4. a template fallback says, in words, that it is a template and not the founder's app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { generateFunctionalArtifact, TEMPLATE_FALLBACK_WARNING } from '../src/functional-code-executor.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const PER_FILE_SOURCES = {
  'www/index.html': '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><ul id="list"></ul><input id="new" placeholder="add an item"><button onclick="add()">Add</button><script src="app.js"></script></body></html>',
  'www/app.js': 'var items=[];try{items=JSON.parse(localStorage.getItem("items"))||[]}catch(e){items=[]}function render(){document.getElementById("list").innerHTML=items.map(function(i){return "<li>"+i+"</li>"}).join("");localStorage.setItem("items",JSON.stringify(items))}function add(){var v=document.getElementById("new").value;if(!v)return;items.push(v);render()}render();',
  'www/styles.css': 'body{font-family:system-ui;background:#0b1120;color:#fff;margin:0;padding:24px}#list{list-style:none;padding:0}#list li{padding:8px;background:#1e293b;border-radius:6px;margin:4px 0}button{background:#00d4ff;border:0;padding:8px 12px;border-radius:6px;cursor:pointer}',
  'package.json': '{\n  "name": "item-list",\n  "version": "1.0.0",\n  "private": true,\n  "scripts": {\n    "start": "npx serve www"\n  }\n}',
  'README.md': '# Item list\n\nA small list that persists to localStorage.\n\nRun it with `npx serve www`.',
};

// The per-file request asks for exactly one file and says so. Matching on that marker (not
// on the file list) is what keeps the count honest: package.json has no source of its own in
// some plans, and a file-name match silently miscounts it as a whole-app attempt.
const PER_FILE_MARKER = 'Output ONLY the raw contents of ';

/**
 * A model that cannot finish a whole-app request but answers a per-file request correctly:
 * raw source for the one file asked for. This is exactly the live pattern that used to end
 * in a template.
 */
function perFileEnv(calls) {
  return {
    calls,
    AI: {
      async run(_model, payload) {
        const user = (payload.messages ?? []).map(m => m.content).join('\n');
        calls.push(user);
        const wanted = user.includes(PER_FILE_MARKER)
          ? Object.keys(PER_FILE_SOURCES).find(p => user.includes(PER_FILE_MARKER + p))
          : null;
        if (!wanted) return { response: JSON.stringify({ summary: 'x', files: [{ path: 'www/index.html', content: 'trunc' }] }) };
        return { response: PER_FILE_SOURCES[wanted] };
      },
    },
  };
}

function webTask(suffix) {
  const pid = `p-gen-${suffix}`;
  store.put('projects', { id: pid, name: 'Gen', objective: 'Build a list app', state: 'active', requirements: ['persist the list'] });
  const task = store.put('tasks', {
    id: `t-gen-${suffix}`, projectId: pid, title: 'Implement frontend code and user experience',
    description: 'Build a list app', requiredCapabilities: ['frontend', 'ui'], state: 'queued',
    acceptance: [{ field: 'type', equals: 'code' }],
  });
  return { pid, taskId: task.id };
}

test('an app is generated one file per request and shipped as a real, installable app', async () => {
  store.configure(null);
  store.data = new Map();
  store.hydrated = true;
  seedAgents();
  const calls = [];
  const { taskId } = webTask(TAIL());

  const result = await generateFunctionalArtifact({ task: store.get('tasks', taskId), env: perFileEnv(calls) });

  const artifact = store.get('artifacts', result.artifactId);
  assert.ok(artifact, 'a code artifact must be registered');
  assert.equal(artifact.metadata.aiGenerated, true, 'the artifact must be recorded as AI-generated');
  assert.equal(artifact.metadata.templateFallback, undefined, 'a template fallback must NOT be what shipped');
  assert.equal(artifact.metadata.strategy, 'file-by-file', 'the provenance must record the per-file path');
  assert.deepEqual(
    artifact.content.files.map(f => f.path).sort(),
    ['README.md', 'package.json', 'www/app.js', 'www/index.html', 'www/styles.css']
  );
  const js = artifact.content.files.find(f => f.path === 'www/app.js').content;
  assert.match(js, /localStorage\.setItem/, 'the JS must be real source');
  assert.ok(!/^\s*\{/.test(js), 'the JS must not be a JSON dump');
  // No whole-app attempt is made any more: the single JSON completion never produced a
  // parseable app live, and every attempt cost up to 40s before per-file did the work.
  const wholeAppCalls = calls.filter(c => !c.includes(PER_FILE_MARKER));
  assert.equal(wholeAppCalls.length, 0, `no whole-app request should be made, saw ${wholeAppCalls.length}`);
  // One request per BEHAVIOUR file. package.json and README.md are synthesised locally, so
  // they are never requested — they cannot fail the build and do not cost a model call.
  const perFileCalls = calls.filter(c => c.includes(PER_FILE_MARKER));
  assert.equal(perFileCalls.length, 3, 'one request per behaviour file');
  // The manifest is always real, even though the model was never asked for it.
  const manifest = JSON.parse(artifact.content.files.find(f => f.path === 'package.json').content);
  assert.equal(manifest.name, 'list');
  assert.equal(manifest.scripts.start, 'npx serve www');
});

// The live failure this closes: the per-file answer for a page came back as a static shell
// (no controls in the HTML, no listener or handler binding in the JS), the fidelity gate
// refused it with `no-interaction`, and the project fell to a template even though the model
// had actually written it. The repair round rewrites the behaviour files with the gate's own
// findings, so the model's code is kept and made to work.
const STATIC_SHELL = {
  'www/index.html': '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Expenses</h1><p>Nothing to do yet</p><script src="app.js"></script></body></html>',
  'www/app.js': 'var items=JSON.parse(localStorage.getItem("items")||"[]");function render(){var el=document.getElementById("list");if(el)el.innerHTML=items.join("");}render();',
  'www/styles.css': PER_FILE_SOURCES['www/styles.css'],
};

/**
 * A model that answers the first request for each file with a static shell, then answers the
 * REPAIR request (the one that names the review failure) with real source. `alwaysBad` keeps
 * it broken so the fallback can be observed too.
 */
function repairingEnv(calls, { alwaysBad = false } = {}) {
  return {
    calls,
    AI: {
      async run(_model, payload) {
        const user = (payload.messages ?? []).map(m => m.content).join('\n');
        calls.push(user);
        const path = Object.keys(PER_FILE_SOURCES).find(p => user.includes(PER_FILE_MARKER + p));
        if (!path) return { response: 'x' };
        const isRepair = /failed the functional review/.test(user);
        if (isRepair && !alwaysBad) return { response: PER_FILE_SOURCES[path] };
        return { response: STATIC_SHELL[path] ?? PER_FILE_SOURCES[path] };
      },
    },
  };
}

test('a per-file app that arrives as a static shell is repaired against the fidelity gate', async () => {
  store.configure(null);
  store.data = new Map();
  store.hydrated = true;
  seedAgents();
  const calls = [];
  const { taskId } = webTask(TAIL());

  const result = await generateFunctionalArtifact({ task: store.get('tasks', taskId), env: repairingEnv(calls) });

  const artifact = store.get('artifacts', result.artifactId);
  assert.equal(artifact.metadata.aiGenerated, true, 'the repaired app is real AI code, not a template');
  assert.equal(artifact.metadata.templateFallback, undefined, 'a repaired app must not be a template fallback');
  assert.equal(artifact.metadata.fidelity.passed, true, 'the shipped app passes the fidelity gate');
  const html = artifact.content.files.find(f => f.path === 'www/index.html').content;
  assert.match(html, /onclick=/, 'the repaired HTML wires real controls');
  const repairCalls = calls.filter(c => /failed the functional review/.test(c));
  assert.ok(repairCalls.length >= 1, 'the gate failure must trigger a repair request');
});

test('a per-file app that cannot be repaired falls back to a template, never ships a demo', async () => {
  store.configure(null);
  store.data = new Map();
  store.hydrated = true;
  seedAgents();
  const calls = [];
  const { taskId } = webTask(TAIL());

  const result = await generateFunctionalArtifact({ task: store.get('tasks', taskId), env: repairingEnv(calls, { alwaysBad: true }) });

  const artifact = store.get('artifacts', result.artifactId);
  assert.equal(artifact.metadata.aiGenerated, false, 'a demo must never be registered as AI code');
  assert.equal(artifact.metadata.templateFallback, true, 'the deterministic template is the honest fallback');
});

test('a per-file answer that is the whole-app envelope is refused, not written as source', async () => {
  store.configure(null);
  store.data = new Map();
  store.hydrated = true;
  seedAgents();
  // Every request, including per-file ones, comes back as the envelope. Storing that as
  // www/app.js would produce an app whose "source" is a JSON dump containing the words.
  const envelope = JSON.stringify({ summary: 'x', files: [{ path: 'www/index.html', content: '<html>' + 'a'.repeat(400) + '</html>' }] });
  const env = { AI: { async run() { return { response: envelope }; } } };
  const { taskId } = webTask(TAIL());

  const result = await generateFunctionalArtifact({ task: store.get('tasks', taskId), env });

  const artifact = store.get('artifacts', result.artifactId);
  assert.ok(artifact, 'something is still registered rather than an exception');
  const js = artifact.content.files.find(f => f.path === 'www/app.js');
  if (js) assert.ok(!/^\s*\{/.test(js.content), 'a JSON envelope must never be stored as app.js');
  // It fell through to the deterministic template, and it says so.
  assert.equal(artifact.metadata.aiGenerated, false);
});

// The files are generated in a fixed, deliberate order: the BEHAVIOUR file first, then the
// markup authored against it, with the already-generated source carried into the next
// request. Asked independently — the way per-file generation originally worked — a delivered
// app read an id its HTML never declared. This pins both halves: the order, and that the
// later request really carries the earlier source.
test('the markup is generated against the behaviour file, not independently of it', async () => {
  store.configure(null);
  store.data = new Map();
  store.hydrated = true;
  seedAgents();
  const calls = [];
  const { taskId } = webTask(TAIL());

  await generateFunctionalArtifact({ task: store.get('tasks', taskId), env: perFileEnv(calls) });

  const asked = calls.filter(c => c.includes(PER_FILE_MARKER));
  const jsAt = asked.findIndex(c => c.includes(PER_FILE_MARKER + 'www/app.js'));
  const htmlAt = asked.findIndex(c => c.includes(PER_FILE_MARKER + 'www/index.html'));
  assert.ok(jsAt >= 0 && htmlAt >= 0, 'both behaviour files are requested');
  assert.ok(jsAt < htmlAt, `the JavaScript must be written first, saw js=${jsAt} html=${htmlAt}`);
  const htmlRequest = asked[htmlAt];
  assert.match(htmlRequest, /\/\/ file: www\/app\.js/, 'the HTML request must carry the generated JS');
  assert.ok(htmlRequest.includes('function add()'), 'the JS source itself, not just its name, is in context');
});

test('a template fallback states plainly that it is a template, not the founder app', async () => {
  store.configure(null);
  store.data = new Map();
  store.hydrated = true;
  seedAgents();
  // No AI binding and no Groq key: there is no model at all, so the executor takes the
  // fallback branch. Whatever the founder gets must say what it is.
  const { taskId } = webTask(TAIL());

  const result = await generateFunctionalArtifact({ task: store.get('tasks', taskId), env: {} });

  const artifact = store.get('artifacts', result.artifactId);
  assert.ok(artifact.metadata.templateFallback === true || artifact.metadata.stub === true,
    'a fallback artifact must be marked as a fallback');
  assert.equal(artifact.metadata.founderWarning, TEMPLATE_FALLBACK_WARNING);
  assert.match(artifact.metadata.founderWarning, /not your app/i);
  assert.ok(artifact.content.notes.join(' ').includes('not your app'),
    'the warning must be in the artifact notes the founder reads');
  assert.ok((result.notes ?? []).some(n => /not your app/i.test(n)),
    'the task result must carry the warning too, not only the artifact');
});
