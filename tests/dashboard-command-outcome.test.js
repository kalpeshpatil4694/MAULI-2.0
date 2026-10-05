// The founder's single most important interaction — typing a command — used to answer with
// the raw API response dumped into a <pre>. Everything the founder needs to know (what was
// created, what state it is in, how far along it is, what happens next) was buried in JSON,
// with the debugging payload in front of them by default. These pin the replacement: a
// readable outcome panel, the raw payload one click away, and founder text escaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboardHTML } from '../src/dashboard.js';

const html = dashboardHTML();

/** Run the dashboard's own inline script against a DOM shim and hand back the context. */
function loadDashboard() {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])[0];
  assert.ok(script, 'the dashboard must ship an inline script');
  const make = () => ({
    innerHTML: '', textContent: '', value: '', hidden: false, style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => null, querySelectorAll: () => [], appendChild() {}
  });
  const els = new Map();
  const document = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, make()); return els.get(id); },
    querySelector: () => null, querySelectorAll: () => [], createElement: () => make(),
    addEventListener() {}, body: make()
  };
  const sandbox = {
    document, console, setTimeout, clearTimeout, setInterval: () => 0,
    Date, Math, JSON, navigator: { userAgent: 'node' }, location: { href: '', reload() {} },
    fetch: () => Promise.reject(new Error('no network in this test'))
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  new vm.Script(script, { filename: 'dashboard.js' }).runInContext(ctx);
  return { ctx, document };
}

const OUTCOME = {
  headline: 'Project created',
  title: 'Expense Tracker',
  objective: 'Responsive expense tracker with add, filter by month, delete, totals.',
  state: 'active', platform: 'web', runId: 'run_abc123',
  tasks: [
    { id: 't1', title: 'Plan the app', state: 'completed' },
    { id: 't2', title: 'Build the frontend', state: 'working' },
    { id: 't3', title: 'Verify fidelity', state: 'queued' }
  ],
  progress: 33,
  next: 'MAULI is building this now.',
  actions: [{ label: 'Open project', fn: 'go("projects")' }]
};

test('a command answers with a readable outcome, not a raw JSON dump', () => {
  const { ctx, document } = loadDashboard();
  vm.runInContext(`renderCommandOutcome(${JSON.stringify(OUTCOME)})`, ctx);

  const el = document.getElementById('cmdOutcome');
  const out = el.innerHTML;
  assert.equal(el.style.display, 'block', 'the outcome must become visible');
  assert.ok(out.includes('Project created'), 'the headline is shown');
  assert.ok(out.includes('Expense Tracker'), 'the project it created is named');
  assert.ok(out.includes('Responsive expense tracker'), 'the founder\'s own objective is echoed back');
  assert.ok(out.includes('run_abc123'), 'the run id is available for support');
  assert.ok(out.includes('MAULI is building this now.'), 'what happens next is stated in words');
  assert.ok(/pfill[^>]*width:33%/.test(out), 'progress is shown as a bar, not a number in JSON');
  assert.ok(out.includes('Open project'), 'the founder is given somewhere to go next');
  // Each task and its state, rather than one JSON line per task.
  assert.ok(out.includes('Build the frontend') && out.includes('working'));
});

test('the raw API response is kept, but one click away instead of in the founder\'s face', () => {
  assert.match(html, /<details[^>]*id="cmdRawWrap"/, 'the raw payload lives in a collapsed disclosure');
  assert.ok(!/<pre class="card" id="cmdRes"/.test(html), 'the raw response is no longer an always-open block');

  const { ctx, document } = loadDashboard();
  vm.runInContext(`showRawCommandResponse({queued:true,runId:"run_abc123"})`, ctx);
  assert.equal(document.getElementById('cmdRawWrap').style.display, 'block');
  assert.match(document.getElementById('cmdRes').textContent, /"runId": "run_abc123"/);
});

test('founder text is escaped, so a command cannot inject markup into the dashboard', () => {
  const { ctx, document } = loadDashboard();
  vm.runInContext(
    `renderCommandOutcome({headline:"<img src=x onerror=alert(1)>",title:"<script>bad()</script>",objective:"a & b"})`,
    ctx
  );
  const out = document.getElementById('cmdOutcome').innerHTML;
  assert.ok(!out.includes('<img src=x'), 'an injected element must not be emitted');
  assert.ok(!out.includes('<script>'), 'an injected script must not be emitted');
  assert.ok(out.includes('&lt;img'), 'the text is shown, escaped');
});

test('a failed command says so in words rather than dumping an error object', () => {
  const { ctx, document } = loadDashboard();
  vm.runInContext(
    `renderCommandOutcome({failed:true,headline:"Command failed",title:"do a thing",next:"Workers AI is unavailable"})`,
    ctx
  );
  const out = document.getElementById('cmdOutcome').innerHTML;
  assert.ok(out.includes('Command failed'));
  assert.ok(out.includes('Workers AI is unavailable'), 'the reason reaches the founder');
});