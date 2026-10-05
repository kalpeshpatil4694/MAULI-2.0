// A single request for a whole app asked the model to emit five complete files in one
// completion. Measured against the live Groq provider that failed 6 times in 7 for anything
// larger than a toy app: the answer was cut before the JSON closed, the executor had nothing
// usable, and it quietly fell back to a template — which is why projects kept reaching
// "Delivery blocked: MAULI could not build ... unrelated template".
//
// Three things are pinned here, because each one can silently stop being true:
//  1. per-file generation runs after the whole-app attempts fail, and survives a model that
//     keeps answering with the whole-app envelope instead of one file;
//  2. a per-file answer that is the whole-app envelope is refused rather than stored as
//     source, which is the failure mode the fix could otherwise have introduced;
//  3. a template fallback says, in words, that it is a template and not the founder's app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { generateFunctionalArtifact, TEMPLATE_FALLBACK_WARNING } from '../src/functional-code-executor.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const PER_FILE_SOURCES = {
  'www/index.html': '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><ul id="list"></ul><input id="new" placeholder="add an item"><button onclick="add()">Add</button><script src="app.js"></script></body></html>',
  'www/app.js': 'var items=JSON.parse(localStorage.getItem("items")||"[]");function render(){document.getElementById("list").innerHTML=items.map(function(i){return "<li>"+i+"</li>"}).join("");localStorage.setItem("items",JSON.stringify(items))}function add(){var v=document.getElementById("new").value;if(!v)return;items.push(v);render()}render();',
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

test('a whole-app answer the model cannot finish still produces a real app, file by file', async () => {
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
  // The whole-app attempts really were tried first: per-file generation is the fallback,
  // not a replacement that quietly costs five requests on every project.
  const wholeAppCalls = calls.filter(c => !c.includes(PER_FILE_MARKER));
  assert.equal(wholeAppCalls.length, 3,
    `the widened repair loop must make 1 initial + 2 repair attempts before per-file, saw ${wholeAppCalls.length}`);
  const perFileCalls = calls.filter(c => c.includes(PER_FILE_MARKER));
  assert.equal(perFileCalls.length, 5, 'one request per planned file, package.json included');
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
