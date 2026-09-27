import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';
import { dashboardHTML } from '../src/dashboard.js';

function scriptBody(source) {
  return source.replace(/^\s*<script>/, '').replace(/<\/script>\s*$/, '');
}

function bridgeHarness(initialPayload) {
  let statePayload = initialPayload;
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
  const context = {
    document,
    window: null,
    fetch: async (url) => (url === '/api/state'
      ? { ok: true, json: async () => ({ ok: true, data: statePayload }) }
      : { ok: true, json: async () => ({ ok: true, data: { progress: {} } }) }),
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    alert() {},
    console,
    // The bridge's mauli:state listener delegates to the main dashboard script.
    S: { projects: [], tasks: [], agents: [], artifacts: [], events: [], approvals: [], tools: [] },
    curPage: 'command',
    updateStats() {},
    renderPage() {},
    __applyDashboardState() { return true; },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  new vm.Script(scriptBody(DASHBOARD_LIVE_SCRIPT), { filename: 'dashboard-live.js' }).runInContext(context);
  return {
    elements,
    timers,
    listeners,
    setPayload(next) { statePayload = next; },
  };
}

const GOOD = {
  projects: [{ id: 'p1', name: 'Demo' }],
  tasks: [{ id: 't1', state: 'working' }],
  agents: [{ id: 'a1', name: 'API Agent' }],
  artifacts: [{ id: 'ar1' }],
  events: [],
  approvals: [],
  tools: [],
};

// Regression: a cold Worker isolate answers /api/state before it can read D1. That
// response carried empty projects/tasks/artifacts, the bridge wrote those zeros into the
// counters, and the dashboard randomly showed "0 PROJECTS / 0 TASKS / 0 ARTIFACTS".
// The server now flags that payload `degraded`; the client must ignore it and retry fast.
test('live bridge never zeroes the counters from a degraded /api/state payload', async () => {
  const { elements, timers } = bridgeHarness({ ...GOOD, degraded: true, coldIsolate: true });

  await timers[0].fn();

  // Untouched means the bridge never wrote to the counter at all.
  const counter = (id) => (elements.get(id)?.textContent ?? '');
  assert.equal(counter('sProj'), '', 'Projects counter must be left untouched');
  assert.equal(counter('sTask'), '', 'Tasks counter must be left untouched');
  assert.equal(counter('sAg'), '', 'Agents counter must be left untouched');
  assert.equal(counter('sArt'), '', 'Artifacts counter must be left untouched');

  // And it must come back quickly rather than waiting the full 20s idle interval.
  assert.equal(timers[0].ms, 500, 'first poll is immediate');
  const next = timers[timers.length - 1];
  assert.ok(
    next.ms <= 2000,
    `a degraded response must reschedule fast, got ${next.ms}ms`
  );
});

test('live bridge still applies a healthy payload after a degraded one', async () => {
  const { elements, timers, setPayload } = bridgeHarness({ ...GOOD, degraded: true });
  await timers[0].fn();
  assert.equal(elements.get('sProj'), undefined, 'degraded poll must not touch the counters');

  // The fast retry lands on a healthy isolate and fills everything in.
  setPayload(GOOD);
  await timers[timers.length - 1].fn();
  assert.equal(elements.get('sProj').textContent, '1');
  assert.equal(elements.get('sTask').textContent, '1');
  assert.equal(elements.get('sAg').textContent, '1');
  assert.equal(elements.get('sArt').textContent, '1');
});

test('applyDashboardState ignores degraded payloads instead of wiping rendered rows', () => {
  const html = dashboardHTML();
  const match = html.match(/function applyDashboardState\(d\)\{[\s\S]*?\n\}/);
  assert.ok(match, 'applyDashboardState must be present');
  const body = match[0];
  assert.match(body, /if\(state\.degraded\)return false;/, 'degraded guard must come first');
  assert.ok(
    body.indexOf('state.degraded') < body.indexOf('S.projects='),
    'the guard must run before any collection is overwritten'
  );
  assert.match(body, /return true;/, 'a healthy payload is still applied');
});

test('/api/state marks a cold-isolate fallback as degraded and never serves an empty snapshot', () => {
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

  // Reads must be individually guarded: one failing D1 query used to throw away the
  // whole snapshot and fall back to the empty in-memory state.
  assert.match(index, /async function safeD1List\(env, type, opts\)/);
  assert.match(index, /const tasks = \(await safeD1List\(env, 'tasks', \{ limit: 300 \}\)\)/);
  assert.match(index, /safeD1List\(env, 'projects', \{ existingTasks: tasks, limit: 100 \}\)/);
  // Artifacts used to be missing from the cold snapshot entirely, so the counter read 0
  // until the isolate hydrated.
  assert.match(index, /safeD1List\(env, 'artifacts', \{ limit: 100 \}\)/);

  // A failed read falls back to the last good copy instead of an empty array.
  assert.match(index, /_lastGoodSnapshot\?\.\[key\] \?\? \[\]/);

  // The D1 snapshot is preferred; the bare in-memory state is only used, and flagged,
  // when nothing at all could be read.
  assert.match(index, /if \(snap && \(snap\.projects\.length \|\| snap\.tasks\.length \|\| snap\.agents\.length\)\)/);
  assert.match(index, /degraded: true, coldIsolate: true, degradedReason: 'no-readable-state' \};/);
  assert.doesNotMatch(index, /catch\(_\)\{\}/, 'no state read may be swallowed without a record');
  assert.match(index, /return ok\(await statePayload\(env, recoveredRuns\)\);/);
  assert.doesNotMatch(index, /catch\(_\)\{\}\}return ok\(memoryState\(\)\);/, 'the silent empty fallback must be gone');
});

test('failed state reads are recorded and surfaced on /api/health', () => {
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

  // A swallowed read failure is exactly what let the dashboard blank with no explanation.
  assert.match(index, /function noteStateReadFailure\(type, error, recovered = false\)/);
  assert.match(index, /noteStateReadFailure\(type, error, attempt === 0\);/,
    'a read that only succeeds on the retry must still be recorded');
  assert.match(index, /recoveredCount: _stateDegradedCount\.recovered \?\? 0,/);
  assert.match(index, /catch \(error\) \{ noteStateReadFailure\('snapshot', error\); \}/);
  assert.match(index, /d1Events\(env, 30\)\.catch\(\(error\) => \{ noteStateReadFailure\('events', error\); return \[\]; \}\)/);
  assert.match(index, /degradedReason: \[/);
  assert.match(index, /stateReads:stateDiagnostics\(\)/, '/api/health must expose the read diagnostics');

  // The Health page must show the failure so it is visible without log access.
  assert.match(dashboardHTML(), /const sr=d\.stateReads\|\|\{\};/);
  assert.match(dashboardHTML(), />State Reads<\/div>/);
  assert.match(dashboardHTML(), /Recovered on retry/);
  assert.match(dashboardHTML(), /sr\.lastReason/);
});
