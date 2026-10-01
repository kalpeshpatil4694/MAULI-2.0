// The founder rule this locks in: "Generated code is not proof of functionality."
// A generated project that looks like an app but whose features do nothing must be
// rejected — at analysis time by analyzeGeneratedApp(), and at runtime by
// verifyGeneratedApp() actually executing the app and observing whether it changes state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGeneratedApp } from '../src/generated-app-quality.js';
import { generateFromTemplate, getAvailableTemplates } from '../src/app-templates.js';
import { verifyGeneratedApp } from '../scripts/verify-generated-app.mjs';

const workingApp = [
  { path: 'www/index.html', content: '<!DOCTYPE html><html><body><div id="value">0</div><button onclick="increment()">+</button><script src="app.js"></script></body></html>' },
  { path: 'www/app.js', content: 'let count=Number(localStorage.getItem("count")||0);function render(){document.getElementById("value").textContent=String(count);localStorage.setItem("count",String(count));}function increment(){count=count+1;render();}render();' },
  { path: 'package.json', content: '{"name":"counter","version":"1.0.0"}' }
];

const demoApp = [
  { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Demo</h1><div id="out">Coming soon</div><button onclick="doThing()">Go</button></body></html>' },
  { path: 'www/app.js', content: 'function doThing(){ console.log("clicked"); }' }
];

test('a real, stateful app passes functional fidelity', () => {
  const report = analyzeGeneratedApp(workingApp, { objective: 'Build a counter app', requirements: ['Increment the counter', 'Persist the count'] });
  assert.equal(report.passed, true, JSON.stringify(report.violations));
  assert.ok(report.stats.interactionCount > 0, 'the app has a bound action');
  assert.equal(report.coverage.every((c) => c.status === 'IMPLEMENTED'), true, JSON.stringify(report.coverage));
});

test('a demo app (placeholder + log-only handler) is rejected', () => {
  const report = analyzeGeneratedApp(demoApp, { objective: 'Build a demo app' });
  assert.equal(report.passed, false);
  const codes = report.violations.map((v) => v.code);
  assert.ok(codes.includes('noop-handler'), `expected noop-handler, got ${codes}`);
  assert.ok(codes.includes('coming-soon') || codes.includes('demo-marker'), `expected a demo marker, got ${codes}`);
});

test('dead buttons (handler referenced but never defined) are rejected', () => {
  const report = analyzeGeneratedApp([{ path: 'www/index.html', content: '<!DOCTYPE html><html><body><button onclick="saveItem()">Save</button></body></html>' }], { objective: 'Save items' });
  assert.equal(report.passed, false);
  assert.ok(report.violations.some((v) => v.code === 'unbound-handler'), JSON.stringify(report.violations));
});

test('a static page with no interaction is rejected', () => {
  const report = analyzeGeneratedApp([{ path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Hello</h1><p>Static brochure</p></body></html>' }], { objective: 'Build a static page' });
  assert.equal(report.passed, false);
  assert.ok(report.violations.some((v) => v.code === 'no-interaction'), JSON.stringify(report.violations));
});

test('a data request with no persistence is rejected', () => {
  const report = analyzeGeneratedApp([
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><ul id="list"></ul><button onclick="add()">Add</button><script src="app.js"></script></body></html>' },
    { path: 'www/app.js', content: 'function add(){document.getElementById("list").innerHTML+="<li>item</li>";}' }
  ], { objective: 'Build a todo tracker that saves tasks' });
  assert.equal(report.passed, false);
  assert.ok(report.violations.some((v) => v.code === 'no-persistence'), JSON.stringify(report.violations));
});

test('requirements with no evidence anywhere are flagged', () => {
  const report = analyzeGeneratedApp([
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><div id="x"></div><button onclick="go()">Go</button><script src="a.js"></script></body></html>' },
    { path: 'www/a.js', content: 'function go(){document.getElementById("x").textContent="ok";}' }
  ], { objective: 'Realtime location tracking', requirements: ['Broadcast live location to subscribed devices'] });
  assert.ok(report.coverage.some((c) => c.status === 'MISSING'), JSON.stringify(report.coverage));
});

test('runtime verifier proves the working app actually changes state', () => {
  const result = verifyGeneratedApp(workingApp, { objective: 'Build a counter app' });
  assert.equal(result.verdict, 'functional');
  assert.equal(result.missingHandlers.length, 0);
  assert.ok(result.invoked.some((i) => i.status === 'mutated'), JSON.stringify(result.invoked));
  assert.equal(result.storageChanged, true, 'state was persisted');
});

test('runtime verifier refuses to call a demo functional', () => {
  const result = verifyGeneratedApp(demoApp, { objective: 'Build a demo app' });
  assert.notEqual(result.verdict, 'functional');
  assert.ok(result.invoked.every((i) => i.status !== 'mutated'), JSON.stringify(result.invoked));
});

// Regression: the shared genericAppFiles() template shipped a marketing landing page whose
// only action was `alert('Feature activated!')`. Eleven common request types (invoice,
// fitness, recipe, survey, timer, bookmark, expense, password, kanban, calendar,
// video-recorder) routed to it, so a failed AI generation delivered a fake app. Every
// template route must now produce a functional app.
test('every template route ships a functional app, never a demo', () => {
  const objectives = [
    'build an invoice generator', 'build a fitness tracker', 'build a recipe app',
    'build a survey form', 'build a pomodoro timer', 'build a bookmark manager',
    'build an expense tracker', 'build a password manager', 'build a kanban board',
    'build a calendar app', 'build a video call recorder'
  ];
  for (const objective of objectives) {
    const template = generateFromTemplate({ objective, capabilities: ['frontend'] });
    const report = analyzeGeneratedApp(template.files, { objective });
    assert.equal(report.passed, true, `${objective} (${template.projectType}) failed: ${report.violations.map((v) => v.code).join(', ')}`);
    assert.doesNotMatch(String(template.files[0].content), /alert\(|Get Started/, `${objective} must not ship a fake action`);
  }
});

// Every template route must survive BOTH gates: the static fidelity check the Worker runs
// and the runtime journey the verifier performs. The journey presses zero-argument
// handlers AND replays literal-argument calls the markup wires (`tap(48)`, `ins('7')`),
// including controls the app renders into innerHTML, so a chess board, calculator or
// tic-tac-toe board is exercised instead of looking like a dead page.
const DEFAULT_REQUIREMENTS = ['User interface', 'Application/API structure', 'Data persistence', 'Security review', 'Testing and verification'];
const TEMPLATE_OBJECTIVES = {
  calculator: 'Build a simple calculator web app',
  portfolio: 'Build a personal portfolio website',
  'todo-app': 'Build a todo list app',
  ecommerce: 'Build an online store',
  'weather-app': 'Build a weather app',
  'chat-app': 'Build a chat app',
  'notes-app': 'Build a notes app',
  'music-player': 'Build a music player',
  'invoice-generator': 'Build an invoice generator',
  'fitness-tracker': 'Build a fitness tracker',
  'recipe-app': 'Build a recipe app',
  'survey-builder': 'Build a survey form',
  'timer-app': 'Build a pomodoro timer',
  'bookmark-manager': 'Build a bookmark manager',
  'expense-tracker': 'Build an expense tracker',
  'password-manager': 'Build a password manager',
  'kanban-board': 'Build a kanban board',
  'calendar-app': 'Build a calendar app',
  'game-app': 'Build a puzzle game',
  'video-recorder': 'Build a video call recorder'
};

test('every template route is runtime-verified, not only statically valid', () => {
  for (const type of getAvailableTemplates()) {
    const objective = TEMPLATE_OBJECTIVES[type] ?? ('Build ' + type);
    const template = generateFromTemplate({ objective, capabilities: ['frontend'] });
    const staticReport = analyzeGeneratedApp(template.files, { objective, requirements: DEFAULT_REQUIREMENTS });
    assert.equal(staticReport.passed, true, `${type} failed the static gate: ${staticReport.violations.map((v) => v.code).join(', ')}`);
    assert.equal(staticReport.stats.hasPersistence, true, `${type} must really persist or call a real API`);
    const runtime = verifyGeneratedApp(template.files, { objective, requirements: DEFAULT_REQUIREMENTS });
    assert.deepEqual(runtime.errors, [], `${type} threw while running`);
    assert.deepEqual(runtime.missingHandlers, [], `${type} has unbound handlers`);
    assert.equal(runtime.verdict, 'functional', `${type} did not perform a working journey: ${JSON.stringify(runtime.invoked.slice(0, 8))}`);
  }
});

test('runtime verifier marks an unbound handler as broken', () => {
  const result = verifyGeneratedApp([{ path: 'www/index.html', content: '<!DOCTYPE html><html><body><button onclick="missing()">X</button></body></html>' }], {});
  assert.equal(result.verdict, 'broken');
  assert.deepEqual(result.missingHandlers, ['missing']);
});
