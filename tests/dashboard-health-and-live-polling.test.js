import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboardHTML } from '../src/dashboard.js';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';
import { diagnoseResultPersistence } from '../src/result-recorder.js';
import fs from 'node:fs';

function scriptBody(source) {
  return source.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
}

test('live bridge scheduler is real code, not swallowed by a line comment', () => {
  const source = scriptBody(DASHBOARD_LIVE_SCRIPT);
  // Regression: the schedulePoll block was written with literal "\n" sequences inside the
  // String.raw template, collapsing it and the closing "})();" onto one physical line that
  // began with "//". It parsed as a comment, so poll() never ran and every dashboard
  // counter stayed at the server-rendered 0.
  const schedulerLine = source
    .split('\n')
    .findIndex((line) => line.includes('let pollTimer=null'));
  assert.ok(schedulerLine >= 0, 'poll scheduler must exist on its own line');
  assert.equal(
    source.split('\n')[schedulerLine].trim(),
    'let pollTimer=null;',
    'scheduler declaration must not share a line with a // comment'
  );
  const startCall = source.split('\n').findIndex((line) => line.trim() === 'schedulePoll(500);');
  assert.ok(startCall >= 0, 'polling must be started by a real statement');
  assert.ok(
    startCall < source.split('\n').findIndex((line) => line.trim() === '})();'),
    'schedulePoll(500) must execute before the IIFE closes'
  );
});

test('live bridge actually polls /api/state and updates the stat counters', async () => {
  const source = scriptBody(DASHBOARD_LIVE_SCRIPT);
  const elements = new Map();
  const makeElement = () => ({
    textContent: '',
    innerHTML: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => null,
    appendChild() {},
    addEventListener() {},
    remove() {},
    closest: () => null,
  });
  const listeners = {};
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    dispatchEvent(event) { if (listeners[event.type]) listeners[event.type](event); },
    querySelectorAll: () => [],
    createElement: makeElement,
    body: makeElement(),
  };
  const timers = [];
  const state = {
    projects: [{ id: 'p1', name: 'Demo', founderCommand: 'build it', queuedAt: new Date().toISOString(), state: 'active' }],
    tasks: [{ id: 't1', state: 'working' }],
    agents: [{ id: 'a1', name: 'API Agent' }],
    artifacts: [{ id: 'ar1', type: 'code-workspace' }],
    events: [],
    approvals: [],
    tools: [],
  };
  const context = {
    document,
    window: null,
    fetch: async (url) => (url === '/api/state'
      ? { ok: true, json: async () => ({ ok: true, data: state }) }
      : { ok: true, json: async () => ({ ok: true, data: { progress: {} } }) }),
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    alert() {},
    console,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  new vm.Script(source, { filename: 'dashboard-live.js' }).runInContext(context);

  assert.ok(timers.length > 0, 'the bridge must schedule a poll');
  await timers[0].fn();

  assert.equal(elements.get('sProj').textContent, '1', 'Projects counter must be populated');
  assert.equal(elements.get('sTask').textContent, '1', 'Tasks counter must be populated');
  assert.equal(elements.get('sAg').textContent, '1', 'Agents counter must be populated');
  assert.equal(elements.get('sArt').textContent, '1', 'Artifacts counter must be populated');
  assert.ok(timers.length > 1, 'polling must reschedule itself');
});

test('Health page renders the Tools card and auto-runs diagnostics', () => {
  const html = dashboardHTML();
  assert.match(html, /function renderHealthTools\(\)/);
  assert.match(html, /renderHealthTools\(\);/, 'renderHealth must populate #toolsOut');
  assert.match(html, /id="toolsOut"/);
  assert.match(html, /function renderDiagnostics\(\)/);
  assert.match(html, /renderDiagnostics\(\)/);
  assert.match(html, /onclick="renderDiagnostics\(\)"/);
  // The old card painted a red "Issue" whenever the optional GitHub token was unset.
  assert.doesNotMatch(html, /row\('Token'/);
  assert.match(html, /GitHub token \(optional\)/);
  assert.match(html, /Result storage/);
});

test('result diagnostic reports real D1 health and never fails on a slow flush', async () => {
  const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } };
  const healthy = await diagnoseResultPersistence(env, { flushBudgetMs: 50 });
  assert.equal(healthy.ok, true);
  assert.equal(healthy.d1Connected, true);
  assert.equal(healthy.storage, 'D1');
  assert.equal(healthy.tokenRequired, false, 'GitHub token must be optional — results live in D1');
  assert.equal(typeof healthy.storedResults, 'number');

  // No D1 binding is a genuine fault and must be reported honestly.
  const memoryOnly = await diagnoseResultPersistence({}, { flushBudgetMs: 50 });
  assert.equal(memoryOnly.ok, false);
  assert.equal(memoryOnly.storage, 'memory');
});

test('result diagnostic bounds its flush so the API cannot report a bare timeout', () => {
  const recorder = fs.readFileSync(new URL('../src/result-recorder.js', import.meta.url), 'utf8');
  assert.match(recorder, /flushBudgetMs\?\?1500/);
  assert.match(recorder, /flush-timeout/);
});
