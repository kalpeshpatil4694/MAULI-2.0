import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { schedulerTick } from '../src/scheduler.js';
import { generateAI } from '../src/ai.js';
import { probeAiGeneration } from '../src/functional-code-executor.js';

function resetStore() {
  store.configure(null);
  store.hydrated = true;
  store.data.clear();
  store.events.length = 0;
  seedAgents();
}

// A founder command used to be executed inside the 30s ctx.waitUntil window, which STARTED a
// generation that the runtime then killed mid-call: the run was recovered as stale, charged
// against the task's infra-recovery budget, and repeated from scratch by the next cron tick.
// Cheap work may still run in that window; a long executor must not.
test('a hand-off tick does not start a long generation', async () => {
  resetStore();
  store.put('projects', { id: 'p-handoff', state: 'active', founderCommand: 'x' });
  store.put('tasks', {
    id: 't-gen', projectId: 'p-handoff', title: 'Implement frontend code', state: 'queued',
    dependsOn: [], requiredCapabilities: ['frontend'], toolNames: [], requiredTools: [],
    acceptance: [{ field: 'type', equals: 'code' }], executor: 'internal.code', sequence: 50
  });

  await schedulerTick({}, { projectId: 'p-handoff', budgetMs: 20_000, skipLongExecutors: true });
  assert.equal(store.get('tasks', 't-gen').state, 'queued',
    'a generation must not be started inside the post-response window');

  await schedulerTick({}, { projectId: 'p-handoff', budgetMs: 60_000 });
  // With no model configured the generation now fails honestly (there is no template net),
  // so the proof that it STARTED is the attempt it recorded, not a completed artifact.
  assert.ok(Number(store.get('tasks', 't-gen').attempts) >= 1,
    'the cron tick (no hand-off flag) must be allowed to start it');
});

// The founder set GROQ_API_KEY and nothing used it: Workers AI was always tried first, and
// because the per-file deadline wraps the whole chain, the doomed primary attempt consumed
// the budget the working fallback needed.
test('an exhausted primary is skipped in favour of the configured Groq key', async () => {
  store.configure(null); store.hydrated = true; store.data.clear();
  const realFetch = globalThis.fetch;
  let groqCalls = 0, primaryCalls = 0;
  globalThis.fetch = async (url) => {
    if (!String(url).includes('api.groq.com')) return new Response('no', { status: 500 });
    groqCalls += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'from-groq' } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const env = {
    GROQ_API_KEY: 'gsk_test',
    __MAULI_AI_QUOTA: { day: new Date().toISOString().slice(0, 10), requests: 0 },
    AI: { async run() { primaryCalls += 1; throw new Error('Workers AI daily free allocation exhausted (4006)'); } }
  };
  try {
    store.put('ai_status', { id: 'workers-ai', available: false, exhausted: true, at: new Date().toISOString() });
    assert.equal(await generateAI(env, [{ role: 'user', content: 'hi' }]), 'from-groq');
    assert.equal(primaryCalls, 0, 'a provider on record as exhausted must not be called first');
    assert.equal(groqCalls, 1);

    // The verdict expires so a recovered allowance is used again.
    store.put('ai_status', { id: 'workers-ai', available: false, exhausted: true, at: new Date(Date.now() - 11 * 60 * 1000).toISOString() });
    assert.equal(await generateAI(env, [{ role: 'user', content: 'hi' }]), 'from-groq');
    assert.equal(primaryCalls, 1, 'after the TTL the primary is tried again');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Measured live: a model answered "Sorry, I cannot write code for that." — 36 characters,
// which satisfied the old >20-character check — and it was written into www/app.js. The app
// shipped a sentence as its behaviour file and the configured fallback was never asked.
test('prose is not accepted as JavaScript, and the fallback provider writes the file', async () => {
  const realFetch = globalThis.fetch;
  let groqCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('api.groq.com')) return new Response('no', { status: 500 });
    groqCalls += 1;
    const asked = String(JSON.parse(init.body)?.messages?.[1]?.content ?? '');
    const path = (asked.match(/^Write (\S+)/) ?? [])[1] ?? 'www/app.js';
    const content = /\.css$/.test(path)
      ? '.card{padding:16px;border-radius:8px;background:#fff;color:#111}.row{display:flex;gap:8px}'
      : /\.html$/.test(path)
        ? '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="card"><form id="add-form"><input id="item-input"><button type="submit">Add</button></form><ul id="item-list"></ul></div><script src="app.js"></script></body></html>'
        : 'const form=document.getElementById("add-form");const input=document.getElementById("item-input");const list=document.getElementById("item-list");let items=[];try{items=JSON.parse(localStorage.getItem("items")||"[]")}catch(e){items=[]}function render(){list.innerHTML="";items.forEach(function(it){const li=document.createElement("li");li.textContent=it.text;list.appendChild(li)});localStorage.setItem("items",JSON.stringify(items))}form.addEventListener("submit",function(e){e.preventDefault();if(!input.value.trim())return;items.push({id:String(Date.now()),text:input.value.trim()});input.value="";render()});render();';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const probe = await probeAiGeneration('Build a simple item list web app that stores items locally', {
      env: {
        GROQ_API_KEY: 'gsk_test',
        MAULI_PER_FILE_PACING_MS: '0',
        AI: { async run() { return { response: 'Sorry, I cannot write code for that.' }; } }
      }
    });
    assert.equal(groqCalls, 3, 'each of the three files must be re-asked of the fallback exactly once');
    assert.equal(probe.generated, true, `the fallback must be able to produce the app: ${probe.error ?? ''}`);
    assert.equal(probe.fileCount, 5);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The measured production symptom: a runnable task nothing could claim, no run to be stale,
// and a project that read 'active' for 15 hours at 0/14 because finalizeCommand counted the
// unclaimable task as pending work forever.
test('an unclaimable runnable task fails instead of leaving the project active', async () => {
  resetStore();
  store.put('projects', { id: 'p-stall', state: 'active', founderCommand: 'x' });
  store.put('tasks', {
    id: 't-stall', projectId: 'p-stall', title: 'Impossible task', state: 'queued',
    dependsOn: [], requiredCapabilities: ['quantum-flux-capability'], toolNames: [], requiredTools: [],
    executor: 'internal.plan', sequence: 50
  });
  const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  store.data.get('tasks').set('t-stall', { ...store.get('tasks', 't-stall'), updatedAt: stale });

  await schedulerTick({}, { projectId: 'p-stall', budgetMs: 20_000 });
  assert.equal(store.get('tasks', 't-stall').state, 'failed', 'the task must become terminal');

  await schedulerTick({}, { projectId: 'p-stall', budgetMs: 20_000 });
  assert.equal(store.get('projects', 'p-stall').state, 'failed',
    'the project must reach an honest terminal state instead of staying active');
});
