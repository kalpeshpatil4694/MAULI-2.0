// "Generated code is not proof of functionality." These tests lock in the fixes that stop
// a generated project from LOOKING like an app while its features do nothing:
//   1. requirement coverage must read executed source, not prose;
//   2. the QA gate must judge the MERGED code of every agent, not just the newest artifact;
//   3. final delivery must refuse a non-functional app and must report requirement statuses;
//   4. generation must run the bounded Detect → Diagnose → Fix → Rebuild → Retest loop;
//   5. the runtime verifier must not report working apps as broken (window listeners,
//      Node-only server files, inline control-flow keywords).
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/functional-code-executor.js'; // registers the internal.code executor
import { store } from '../src/store.js';
import { createProject, addTaskToProject } from '../src/projects.js';
import { registerArtifact } from '../src/artifacts.js';
import { getExecutor } from '../src/executor-registry.js';
import { buildFinalDelivery } from '../src/delivery.js';
import { analyzeGeneratedApp, evaluateRequirementCoverage } from '../src/generated-app-quality.js';
import { GATES } from '../src/pipeline-gates.js';
import { verifyGeneratedApp } from '../scripts/verify-generated-app.mjs';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// A real working app: a list the user can add to, persisted across refresh.
const WORKING_HTML = '<!DOCTYPE html><html><head><title>Tracker</title></head><body><h1>Expenses</h1><input id="item" placeholder="Add"><button onclick="add()">Add</button><ul id="list"></ul><script src="app.js"></script></body></html>';
const WORKING_JS = 'let items=JSON.parse(localStorage.getItem("items")||"[]");function render(){document.getElementById("list").innerHTML=items.map(function(t){return "<li>"+t+"</li>"}).join("");localStorage.setItem("items",JSON.stringify(items));}function add(){var v=document.getElementById("item").value.trim();if(!v)return;items.push(v);render();}render();';
const WORKING_APP = [
  { path: 'www/index.html', content: WORKING_HTML },
  { path: 'www/app.js', content: WORKING_JS },
  { path: 'package.json', content: '{"name":"tracker","version":"1.0.0"}' }
];
// A demo: a styled page whose button changes nothing.
const DEAD_APP = [
  { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Expenses</h1><button onclick="add()">Add</button></body></html>' },
  { path: 'www/app.js', content: 'function add(){ console.log("clicked"); }' }
];

test('requirement coverage reads executed source, never the README', () => {
  const files = [
    ...WORKING_APP,
    { path: 'README.md', content: '# Tracker\n\nSupports invoice export, calendar sync and password vault management.' }
  ];
  const report = analyzeGeneratedApp(files, {
    objective: 'Build an expense tracker',
    requirements: ['Track expenses', 'Export invoices', 'Sync calendar', 'Password vault management']
  });
  const byRequirement = new Map(report.coverage.map((c) => [c.requirement, c.status]));
  assert.equal(byRequirement.get('Track expenses'), 'IMPLEMENTED');
  // These appear only in prose: documentation is intent, not a working feature.
  assert.equal(byRequirement.get('Password vault management'), 'MISSING', JSON.stringify(report.coverage));
  assert.equal(byRequirement.get('Sync calendar'), 'MISSING', JSON.stringify(report.coverage));
  const coverage = evaluateRequirementCoverage(['Persist data'], [{ path: 'README.md', content: 'we persist data' }]);
  assert.equal(coverage[0].status, 'MISSING', 'a README alone is not evidence');
});

test('the QA gate judges the merged code of every agent, not just the newest artifact', async () => {
  const pid = `p-${TAIL()}`;
  const objective = 'Build an expense tracker web app';
  store.put('projects', { id: pid, name: 'P', objective, founderCommand: objective, requirements: ['Track expenses and persist them'], state: 'active' });
  const gen = addTaskToProject(pid, { title: 'Build frontend', requiredCapabilities: ['frontend'], acceptance: [{ field: 'type', equals: 'code' }], executor: 'internal.code' });
  store.put('tasks', { ...gen, state: 'completed', verificationId: 'v-gen', id: gen.id });
  store.put('tasks', { id: `${pid}-sec`, projectId: pid, title: 'Security review', state: 'completed', verificationId: 'v-sec', requiredCapabilities: ['security'] });
  // The frontend agent ships the working, persisting app...
  registerArtifact({ projectId: pid, taskId: gen.id, type: 'code-workspace', content: { files: WORKING_APP }, metadata: {} });
  // ...and the backend agent ships a later artifact with no persistence of its own.
  const backend = [
    { path: 'server.js', content: 'const http=require("http");http.createServer((req,res)=>res.end("ok")).listen(3000);' },
    { path: 'package.json', content: '{"name":"backend","version":"1.0.0"}' },
    { path: 'README.md', content: '# Backend' }
  ];
  registerArtifact({ projectId: pid, taskId: gen.id, type: 'code-workspace', content: { files: backend }, metadata: {} });

  // The old behaviour — judging only the newest artifact — saw no persistence and failed.
  const newestOnly = analyzeGeneratedApp(backend, { objective, requirements: ['Track expenses and persist them'] });
  assert.equal(newestOnly.passed, false, 'the newest artifact alone is not the app');

  const gate = getExecutor('internal.pipeline-gate').handler;
  const outcome = await gate({ task: { id: `${pid}-qa`, projectId: pid, gateType: 'qa' }, env: {} });
  const fidelity = outcome.checks.find((c) => c.name === 'functional_fidelity');
  assert.equal(fidelity?.passed, true, `merged code must pass fidelity: ${JSON.stringify(outcome.checks)}`);
  assert.ok(outcome.requirementStatuses.some((r) => r.status === 'IMPLEMENTED'), JSON.stringify(outcome.requirementStatuses));
});

test('final delivery refuses a non-functional app and reports requirement statuses', () => {
  const seed = (pid, files) => {
    store.put('projects', { id: pid, name: 'P', objective: 'Build an expense tracker web app', requirements: ['Track expenses and persist them'], state: 'completed' });
    store.put('tasks', { id: `${pid}-gen`, projectId: pid, title: 'Generate app', state: 'completed', verificationId: 'v-gen', requiredCapabilities: ['frontend'] });
    store.put('tasks', { id: `${pid}-sec`, projectId: pid, title: 'Security review', state: 'completed', verificationId: 'v-sec', requiredCapabilities: ['security'] });
    for (const type of GATES) {
      store.put('tasks', { id: `${pid}-gate-${type}`, projectId: pid, title: `Pipeline gate: ${type}`, state: 'completed', pipelineGate: true, gateType: type, requiredCapabilities: type === 'security' ? ['security'] : ['verification'], verificationId: `v-${type}` });
    }
    store.put('tasks', { id: `${pid}-qa`, projectId: pid, title: 'Final project QA gate', state: 'completed', finalProjectVerification: true, pipelineGate: true, gateType: 'qa', verificationId: 'v-qa' });
    registerArtifact({ projectId: pid, taskId: `${pid}-gen`, type: 'code-workspace', content: { files }, metadata: {} });
  };

  const good = `p-${TAIL()}`;
  seed(good, WORKING_APP);
  const delivery = buildFinalDelivery(store.get('projects', good), { enforceGates: true });
  assert.equal(delivery.content.functionalFidelity.passed, true);
  assert.equal(delivery.content.functionalFidelity.score, 100);
  const statuses = delivery.content.requirementCoverage.statuses;
  assert.ok(statuses.length > 0, 'every founder requirement must carry a status');
  assert.ok(statuses.every((s) => ['IMPLEMENTED', 'INTEGRATED', 'RUNTIME VERIFIED', 'FAILED', 'BLOCKED'].includes(s.status)), JSON.stringify(statuses));

  const bad = `p-${TAIL()}`;
  seed(bad, DEAD_APP);
  assert.throws(
    () => buildFinalDelivery(store.get('projects', bad), { enforceGates: true }),
    /functional fidelity/,
    'a dead app must never produce a final-delivery artifact'
  );
});

test('generation runs the bounded repair loop and rebuilds a rejected app', async () => {
  const pid = `p-${TAIL()}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build an expense tracker web app', requirements: ['Track expenses and persist them'], state: 'active' });
  const task = addTaskToProject(pid, {
    title: 'Build an expense tracker web app',
    description: 'Build an expense tracker web app',
    requiredCapabilities: ['frontend'],
    acceptance: [{ field: 'type', equals: 'code' }],
    executor: 'internal.code'
  });
  // First answer looks like an app but never persists anything; the repair pass fixes it.
  const noPersistence = JSON.stringify({
    summary: 'Tracker',
    files: [
      { path: 'www/index.html', content: WORKING_HTML },
      { path: 'www/app.js', content: 'let items=[];function render(){document.getElementById("list").innerHTML=items.map(function(t){return "<li>"+t+"</li>"}).join("");}function add(){var v=document.getElementById("item").value.trim();if(!v)return;items.push(v);render();}render();' },
      { path: 'www/styles.css', content: 'body{font-family:system-ui}' }
    ]
  });
  const fixed = JSON.stringify({ summary: 'Tracker with persistence', files: WORKING_APP });
  let call = 0;
  const env = { AI: { async run() { call += 1; return { response: call === 1 ? noPersistence : fixed }; } } };

  const executor = getExecutor('internal.code').handler;
  const result = await executor({ task, env, agentId: 'agent-test-frontend' });

  assert.ok(call > 1, 'the rejected app must trigger a repair attempt');
  assert.match(result.files.find((f) => f.path === 'www/app.js').content, /localStorage/, 'the repaired app persists data');
  const artifact = store.get('artifacts', result.artifactId);
  assert.equal(artifact.metadata.fidelity.passed, true, JSON.stringify(artifact.metadata));
  const gate = analyzeGeneratedApp(result.files, { objective: 'Build an expense tracker web app', requirements: ['Track expenses and persist them'] });
  assert.equal(gate.passed, true, JSON.stringify(gate.violations));
});

test('output that is only a demo is rejected before it can be registered as an app', async () => {
  const dead = JSON.stringify({
    summary: 'Expenses',
    files: [
      { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Expenses</h1><p>Coming soon</p><button onclick="add()">Add</button><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'function add(){ console.log("clicked"); }' },
      { path: 'www/styles.css', content: 'body{font-family:system-ui}' }
    ]
  });
  const env = { AI: { async run() { return { response: dead }; } } };
  const pid = `p-${TAIL()}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build an expense tracker web app', requirements: ['Track expenses'], state: 'active' });
  const task = addTaskToProject(pid, { title: 'Build an expense tracker web app', description: 'Build an expense tracker web app', requiredCapabilities: ['frontend'], acceptance: [{ field: 'type', equals: 'code' }], executor: 'internal.code' });

  const result = await getExecutor('internal.code').handler({ task, env, agentId: 'agent-test-frontend' });
  const artifact = store.get('artifacts', result.artifactId);
  // The executor may fall back to a working template, but it must never register the demo
  // as if it were the requested product.
  assert.notEqual(artifact.metadata.generatedBy, 'functional-code-executor',
    'a demo must not be registered as the generated application');
  assert.equal(analyzeGeneratedApp(result.files, { objective: 'Build an expense tracker web app' }).passed, true,
    'whatever is delivered must pass the fidelity gate');
});

test('the runtime verifier does not call a working app broken', () => {
  // 1. A Node-only server file must not be executed in the browser shim.
  const withServer = [
    ...WORKING_APP,
    { path: 'server.js', content: 'const express=require("express");const app=express();app.listen(3000);' }
  ];
  const serverResult = verifyGeneratedApp(withServer, { objective: 'Build an expense tracker', requirements: ['Track expenses and persist them'] });
  assert.deepEqual(serverResult.errors, [], 'the Node entry point must not be run as browser code');
  assert.equal(serverResult.verdict, 'functional', JSON.stringify(serverResult.invoked));

  // 2. Control-flow keywords inside inline handlers are not missing handlers.
  const keywordApp = [
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><input id="item" onkeydown="if(event.key===\'Enter\')add()"><ul id="list"></ul></body></html>' },
    { path: 'www/app.js', content: WORKING_JS }
  ];
  const keywordResult = verifyGeneratedApp(keywordApp, { objective: 'Build an expense tracker' });
  assert.deepEqual(keywordResult.missingHandlers, [], 'if/for are keywords, not handlers');
  assert.notEqual(keywordResult.verdict, 'broken');

  // 3. window.addEventListener is normal browser code, and load handlers really run.
  const loadApp = [
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><div id="out"></div><button onclick="bump()">Go</button></body></html>' },
    { path: 'www/app.js', content: 'let n=0;window.addEventListener("load",function(){document.getElementById("out").textContent="ready";});function bump(){n=n+1;document.getElementById("out").textContent=String(n);}' }
  ];
  const loadResult = verifyGeneratedApp(loadApp, { objective: 'Build a counter' });
  assert.deepEqual(loadResult.errors, [], 'window.addEventListener must not throw in the shim');
  assert.equal(loadResult.verdict, 'functional', JSON.stringify(loadResult.invoked));
});
