// Production shipped a contact/message form for "build a personal habit tracker with
// streaks" and scored it 100: the page repeated the founder's words, template routing sent
// the request to the portfolio template (because of the word "personal"), and the coverage
// check counted page prose as evidence. These tests lock in the fixes:
//   1. routing is scored per domain, and generic words cannot hijack it;
//   2. the domains that were missing now have real, working, persisting templates;
//   3. requirement evidence is behavioural first, prose only as a labelled fallback;
//   4. delivery refuses an app that does not implement the founder's command, and refuses
//      an unrelated template outright.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { generateFromTemplate, getAvailableTemplates } from '../src/app-templates.js';
import { analyzeGeneratedApp, evaluateRequirementCoverage } from '../src/generated-app-quality.js';
import { verifyGeneratedApp } from '../scripts/verify-generated-app.mjs';
import { buildFinalDelivery } from '../src/delivery.js';

const REQUEST = {
  'habit-tracker': 'Build a personal habit tracker web app with daily check-ins and streaks',
  'book-logger': 'Build a personal reading log web app with a book list, progress tracking and notes',
  'notes-app': 'Build a notes web app with tags and search',
  ecommerce: 'Create a simple e-commerce platform with a catalog and a cart',
  'video-recorder': 'Make a video call recording app that records the screen and webcam',
  'password-manager': 'Build a password vault to store credentials',
  'bookmark-manager': 'Build a bookmark manager with tags',
  calculator: 'Build a simple calculator web app'
};

test('routing sends each domain to its own template, not to a generic one', () => {
  const expected = {
    'Build a personal habit tracker web app with daily check-ins and streaks': 'habit-tracker',
    'Build a personal reading log web app with a book list': 'book-logger',
    'Build a notes web app': 'notes-app',
    'Create an e-commerce platform': 'ecommerce',
    'Build a password vault for my credentials': 'password-manager',
    'Build a bookmark manager with tags': 'bookmark-manager',
    'Build a simple calculator web app': 'calculator',
    'Build a weather forecast app': 'weather-app',
    'Make a video call recording application': 'video-recorder',
    'Build a music player with playlists': 'music-player',
    'Build a to-do list app': 'todo-app',
    'Track my daily expenses and budget': 'expense-tracker',
    'Build a portfolio website for my resume': 'portfolio'
  };
  for (const [objective, type] of Object.entries(expected)) {
    const out = generateFromTemplate({ objective, requirements: [] });
    assert.equal(out.projectType, type, `"${objective}" routed to ${out.projectType}`);
    assert.equal(out.templateMatched, true, `"${objective}" reported as an unmatched template`);
  }
});

test('a request that matches no domain is reported unmatched instead of silently faked', () => {
  const out = generateFromTemplate({ objective: 'Build something unusual with quantum flux capacitors', requirements: [] });
  assert.equal(out.projectType, 'web-app');
  assert.equal(out.templateMatched, false, 'an unrelated request must not claim a match');
});

test('every template passes the gate, the runtime journey and evidences its own domain', () => {
  const failures = [];
  for (const type of getAvailableTemplates()) {
    const objective = REQUEST[type] ?? `Build a ${type.replace(/-/g, ' ')} app that tracks items and persists them`;
    const out = generateFromTemplate({ objective, requirements: [objective] });
    const gate = analyzeGeneratedApp(out.files, { objective, requirements: [objective] });
    const run = verifyGeneratedApp(out.files, { objective, requirements: [objective] });
    const coverage = evaluateRequirementCoverage([objective], out.files)[0];
    // The weather app is network-bound: offline it cannot populate its cache, which the
    // offline harness reports as storage=false. Everything else must persist.
    const expectsStorage = type !== 'weather-app';
    if (!gate.passed) failures.push(`${type}: gate ${gate.violations.map((v) => v.code)}`);
    if (run.verdict === 'broken') failures.push(`${type}: runtime ${JSON.stringify(run.errors)}`);
    if (expectsStorage && !run.storageChanged) failures.push(`${type}: no persistence at runtime`);
    if (coverage?.status !== 'IMPLEMENTED') failures.push(`${type}: requirement evidence ${coverage?.status}`);
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('a habit tracker request produces a working habit app with streaks, not a contact form', () => {
  const objective = REQUEST['habit-tracker'];
  const out = generateFromTemplate({ objective, requirements: [objective] });
  const run = verifyGeneratedApp(out.files, { objective, requirements: [objective] });
  assert.equal(out.projectType, 'habit-tracker');
  assert.equal(run.verdict, 'functional', JSON.stringify(run.errors));
  assert.equal(run.storageChanged, true, 'habit check-ins must persist');
  const html = out.files.map((f) => f.content).join('\n');
  assert.match(html, /habit/i, 'the app must actually use the domain vocabulary');
  assert.match(html, /streak/i);
  assert.match(html, /checkin|check-in/i);
});

test('a reading log request produces a book list with progress and notes', () => {
  const objective = REQUEST['book-logger'];
  const out = generateFromTemplate({ objective, requirements: [objective] });
  const run = verifyGeneratedApp(out.files, { objective, requirements: [objective] });
  assert.equal(out.projectType, 'book-logger');
  assert.equal(run.verdict, 'functional', JSON.stringify(run.errors));
  assert.equal(run.storageChanged, true);
});

test('page prose alone is weaker evidence than behaviour, and both are reported honestly', () => {
  // Prose evidence: the words appear only in what the user reads, not in any identifier or
  // script the app binds. Honest, but weaker — and it must be labelled.
  const proseOnly = [{ path: 'www/index.html', content: '<html><body><h1>Habit tracker with daily streaks</h1><p>Keep your habits going.</p></body></html>' }];
  const proseCoverage = evaluateRequirementCoverage([REQUEST['habit-tracker']], proseOnly)[0];
  assert.equal(proseCoverage.status, 'IMPLEMENTED');
  assert.equal(proseCoverage.evidence, 'prose', 'prose evidence must be labelled as such');
  assert.equal(proseCoverage.proseOnly, true);

  // A habit app: the domain words are in its identifiers and storage key.
  const habit = generateFromTemplate({ objective: REQUEST['habit-tracker'], requirements: [] }).files;
  const habitCoverage = evaluateRequirementCoverage([REQUEST['habit-tracker']], habit)[0];
  assert.equal(habitCoverage.evidence, 'behavioural', JSON.stringify(habitCoverage));

  // No evidence at all: unrelated code.
  const unrelated = [{ path: 'www/index.html', content: '<html><body><h1>Unrelated</h1><button onclick="x()">Go</button></body></html>' }];
  assert.equal(evaluateRequirementCoverage([REQUEST['habit-tracker']], unrelated)[0].status, 'MISSING');
});

test('delivery refuses an app that does not implement the founder command', () => {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  const project = store.put('projects', {
    id: 'wrong-app-project', name: 'P', objective: 'Build a personal habit tracker web app with daily check-ins and streaks',
    founderCommand: 'Build a personal habit tracker web app with daily check-ins and streaks',
    requirements: ['Build a personal habit tracker web app with daily check-ins and streaks'], state: 'completed'
  });
  store.put('tasks', { id: 'wrong-task', projectId: project.id, title: 'Build', state: 'completed' });
  store.put('tasks', { id: 'wrong-qa', projectId: project.id, title: 'Final QA', state: 'completed', finalProjectVerification: true, verificationId: 'v' });
  // A perfectly functional contact form: it works, it just is not what was asked for.
  const contactForm = generateFromTemplate({ objective: 'Build a contact page web app', requirements: [] }).files;
  store.put('artifacts', {
    id: 'wrong-artifact', projectId: project.id, type: 'code-workspace', content: { files: contactForm },
    metadata: { generatedBy: 'app-templates', template: 'portfolio', templateMatched: false }
  });

  assert.throws(() => buildFinalDelivery(project, { enforceGates: true }),
    /could not build|does not implement/,
    'a wrong app must not be delivered with a perfect score');
});

test('delivery accepts a matching template that really implements the request', () => {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  const objective = 'Build a personal habit tracker web app with daily check-ins and streaks';
  const project = store.put('projects', {
    id: 'right-app-project', name: 'P', objective, founderCommand: objective, requirements: [objective], state: 'completed'
  });
  store.put('tasks', { id: 'right-task', projectId: project.id, title: 'Build', state: 'completed' });
  for (const gate of ['build', 'test', 'requirements', 'security', 'functional-fidelity', 'production-runtime', 'integrity']) {
    store.put('tasks', { id: `right-${gate}`, projectId: project.id, title: `Gate ${gate}`, state: 'completed', pipelineGate: true, gateType: gate, verificationId: `v-${gate}` });
  }
  store.put('tasks', { id: 'right-qa', projectId: project.id, title: 'Final QA', state: 'completed', finalProjectVerification: true, verificationId: 'v', pipelineGate: true, gateType: 'qa' });
  const app = generateFromTemplate({ objective, requirements: [objective] });
  store.put('artifacts', {
    id: 'right-artifact', projectId: project.id, type: 'code-workspace', content: { files: app.files },
    metadata: { generatedBy: 'app-templates', template: app.projectType, templateMatched: app.templateMatched }
  });

  const delivery = buildFinalDelivery(project, { enforceGates: true });
  assert.ok(delivery?.id, 'a matching, working app must be deliverable');
  assert.equal(delivery.content.functionalFidelity.passed, true);
});