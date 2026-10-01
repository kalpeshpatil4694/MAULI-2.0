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

// Persistence evidence must be a CALL, not a word. The bare \bdatabase\b token let a
// marketing one-pager through the gate with a perfect score, because its About text
// mentions a database: an app that stores nothing was delivered as a working product.
test('prose that merely mentions a database is not persistence evidence', () => {
  const page = [{
    path: 'www/index.html',
    content: '<!DOCTYPE html><html><body><nav><a href="#about">About</a></nav>' +
      '<section id="about"><h1>Reading log</h1>' +
      '<p>Our production stack uses a database with replication for durable storage.</p></section>' +
      '<input id="book" class="inp"><button class="btn" onclick="add()">Add</button>' +
      '<ul id="list"></ul><script>function add(){document.getElementById("list").innerHTML+="<li>x</li>"}</script></body></html>'
  }];
  const gate = analyzeGeneratedApp(page, {
    objective: 'Build a personal reading log web app with a book list that persists progress',
    requirements: ['Track reading progress and persist it']
  });
  assert.equal(gate.passed, false, JSON.stringify(gate.violations));
  assert.ok(gate.violations.some((v) => v.code === 'no-persistence'), JSON.stringify(gate.violations));
});

test('a real storage call is still accepted as persistence evidence', () => {
  const app = [{
    path: 'www/index.html',
    content: '<!DOCTYPE html><html><body><input id="book"><button onclick="add()">Add</button>' +
      '<ul id="list"></ul><script>function add(){const v=document.getElementById("book").value;' +
      'localStorage.setItem("mauli-books",v);document.getElementById("list").innerHTML+="<li>"+v+"</li>"}</script></body></html>'
  }];
  const gate = analyzeGeneratedApp(app, {
    objective: 'Build a personal reading log web app with a book list that persists progress',
    requirements: ['Track reading progress and persist it']
  });
  assert.equal(gate.passed, true, JSON.stringify(gate.violations));
});

// "todo" is the product, not only a placeholder. The marker rule matched it
// case-insensitively, so a todo app's own domain text — its README title, its API error
// strings, its variable names — was read as an unfinished-work marker and the whole app
// category was thrown away. A delivered task tracker passed runtime verification and was
// then rejected by this gate, so no todo app could ever be delivered at all.
test('a todo app is not rejected for using the word todo', () => {
  const app = [{
    path: 'www/index.html',
    content: '<!DOCTYPE html><html><body><input id="todoText"><button onclick="addTodo()">Add</button>' +
      '<ul id="todoList"></ul><script>function addTodo(){const v=document.getElementById("todoText").value;' +
      'if(!v)return;localStorage.setItem("todos",v);document.getElementById("todoList").innerHTML+="<li>"+v+"</li>"}</script></body></html>'
  }, {
    path: 'server.js',
    // Every one of these is the app talking about its own domain, not a leftover marker.
    content: '// Create a new todo\nfunction create(todo){ if(!todo) return 400; return todo; }\n' +
      'function drop(todo){ return { error: "Todo not found" }; }'
  }];
  const gate = analyzeGeneratedApp(app, { objective: 'Build a todo list app', requirements: ['Add todos'] });
  assert.equal(
    gate.violations.filter((v) => v.code === 'todo-marker').length,
    0,
    'the domain word must not be read as a placeholder: ' + JSON.stringify(gate.violations)
  );
});

test('a real unfinished-work marker is still refused', () => {
  // Loosening the rule until it accepts everything is not a fix, so every conventional way
  // of writing the marker is pinned here.
  const marked = [
    ['// TODO: fix the parser', 'upper case TODO'],
    ['/* FIXME */', 'upper case FIXME'],
    ['// todo: finish login', 'lower case marker with a colon'],
    ['// fixme: broken', 'lower case fixme with a colon'],
  ];
  for (const [comment, label] of marked) {
    const app = [{
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><body><input id="q"><button onclick="go()">Go</button><div id="out"></div>' +
        '<script>function go(){localStorage.setItem("k","v");document.getElementById("out").textContent="x"}</script></body></html>'
    }, { path: 'server.js', content: comment + '\nfunction handle(){ return 1; }' }];
    const gate = analyzeGeneratedApp(app, { objective: 'Build a search app', requirements: ['Search'] });
    assert.ok(
      gate.violations.some((v) => v.code === 'todo-marker'),
      `${label} must still be refused: ${JSON.stringify(gate.violations)}`
    );
  }
});
