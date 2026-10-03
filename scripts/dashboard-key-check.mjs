#!/usr/bin/env node
// Executes the dashboard's own script in a DOM shim and drives it the way the founder
// would: paste the key, save it, send a chat message. Asserts the real outcome — that the
// banner clears, the header travels, and chat prints a sentence instead of a JSON envelope.
//
// A green source-reading test is not proof that the key control works; this runs it.
import vm from 'node:vm';
import { dashboardHTML } from '../src/dashboard.js';

const html = dashboardHTML();
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function makeEl(tag = 'div', id = '') {
  const el = {
    tagName: String(tag).toUpperCase(), id, className: '', value: '', textContent: '',
    innerHTML: '', hidden: false, checked: false, disabled: false, style: {}, dataset: {},
    children: [], _listeners: {}, _attrs: {}
  };
  const set = new Set();
  el.classList = {
    add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)),
    toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)), contains: (c) => set.has(c), _set: set
  };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); if (k === 'class') el.className = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.removeAttribute = (k) => { delete el._attrs[k]; };
  el.addEventListener = (t, f) => { (el._listeners[t] ||= []).push(f); };
  el.removeEventListener = () => {};
  el.appendChild = (c) => { el.children.push(c); return c; };
  el.removeChild = (c) => { el.children = el.children.filter((x) => x !== c); return c; };
  el.remove = () => {};
  el.focus = () => {}; el.blur = () => {}; el.select = () => {};
  // A browser runs BOTH addEventListener handlers and the `onclick` property. The shim
  // only ran the listeners, so every onclick= control in the dashboard read as dead and
  // this check blamed the product for the harness's gap.
  el.click = () => el.dispatchEvent({ type: 'click', target: el });
  el.dispatchEvent = (e) => {
    for (const f of el._listeners[e?.type] || []) f(e);
    if (e?.type === 'click' && typeof el.onclick === 'function') el.onclick(e);
    return true;
  };
  el.closest = () => null;
  el.querySelector = () => null; el.querySelectorAll = () => [];
  el.insertAdjacentHTML = () => {};
  return el;
}

const elements = new Map();
for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
  const id = m[2].match(/\bid\s*=\s*["']([^"']+)["']/)?.[1];
  if (!id || elements.has(id)) continue;
  const el = makeEl(m[1], id);
  const cls = m[2].match(/\bclass\s*=\s*["']([^"']*)["']/);
  if (cls) { el.className = cls[1]; cls[1].split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c)); }
  if (/(^|\s)hidden(\s|=|>|$)/.test(m[2])) el.hidden = true;
  elements.set(id, el);
}
console.log('elements discovered:', elements.size);

const requests = [];
let chatShouldFail = true;
const sandbox = {
  document: {
    getElementById: (id) => elements.get(String(id)) ?? null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => makeEl(t), createTextNode: (t) => ({ textContent: t }),
    addEventListener: () => {}, removeEventListener: () => {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html')
  },
  localStorage: { _s: new Map(), getItem(k) { return this._s.has(k) ? this._s.get(k) : null; }, setItem(k, v) { this._s.set(k, String(v)); }, removeItem(k) { this._s.delete(k); }, clear() { this._s.clear(); }, key: () => null, get length() { return this._s.size; } },
  sessionStorage: { _s: new Map(), getItem(k) { return this._s.has(k) ? this._s.get(k) : null; }, setItem(k, v) { this._s.set(k, String(v)); }, removeItem(k) { this._s.delete(k); }, clear() { this._s.clear(); }, key: () => null, get length() { return this._s.size; } },
  console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, alert() {}, confirm: () => true,
  prompt: () => { throw new Error('window.prompt must not be used for the founder key'); },
  navigator: { userAgent: 'test' }, location: { href: 'https://x/', reload() {} },
  Intl, Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Promise, isNaN, parseInt, parseFloat,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: class { constructor() { this.size = 0; } },
  Event: class { constructor(t) { this.type = t; } },
  async fetch(path, opts = {}) {
    requests.push({ path, headers: opts.headers || {} });
    if (path === '/api/chat') {
      if (chatShouldFail) {
        chatShouldFail = false;
        return { ok: false, status: 401, json: async () => ({ ok: false, error: { message: 'Founder key required or invalid' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { result: { response: { text: 'नमस्कार! मी तुमची मदत करतो.', quickReplies: ['Build a web app'] } } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '{}' };
  }
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};
const ctx = vm.createContext(sandbox);
new vm.Script(script, { filename: 'dashboard.js' }).runInContext(ctx, { timeout: 5000 });

let failures = 0;
const pass = (m) => console.log('  PASS  ' + m);
const fail = (m) => { failures += 1; console.log('  FAIL  ' + m); };

const bar = elements.get('mauliKeyBar');
const state = elements.get('mauliKeyState');
console.log('\nLocked out (no key yet):');
bar.hidden === false ? pass('banner is visible') : fail('banner hidden');
state.textContent === 'locked' ? pass('key button reads "locked"') : fail('key button reads ' + JSON.stringify(state.textContent));

console.log('\nFounder clicks the key button, pastes the key and saves:');
// The modal binds its handlers when it opens, so the real order is: open → type → save.
ctx.openFounderKey();
elements.get('mauliKeyModal').hidden === false ? pass('modal opens from the top-bar button') : fail('modal did not open');
elements.get('mauliKeyInput').value = 'founder-secret-key';
elements.get('mauliKeySave').click();
elements.get('mauliKeyModal').hidden === true ? pass('modal closes') : fail('modal stayed open');
bar.hidden === true ? pass('banner clears') : fail('banner stayed up');
state.textContent === 'key set' ? pass('key button reads "key set"') : fail('reads ' + JSON.stringify(state.textContent));
sandbox.sessionStorage.getItem('mauli_founder_key') === 'founder-secret-key'
  ? pass('key stored for this tab') : fail('key not stored: ' + sandbox.sessionStorage.getItem('mauli_founder_key'));

console.log('\nThe key travels with protected requests:');
ctx.renderPage('chat');
const withKey = requests.filter((r) => r.headers['x-mauli-founder'] === 'founder-secret-key');
withKey.length ? pass(`x-mauli-founder sent on ${withKey.length} request(s)`) : fail('founder header missing');

console.log('\nChat while locked out (simulated 401):');
const msgs = elements.get('chatMsgs');
msgs.innerHTML = ''; msgs.children = [];
sandbox.sessionStorage.removeItem('mauli_founder_key');
chatShouldFail = true;
elements.get('chatIn').value = 'hello';
// A 401 now raises the key modal and the request waits for the founder — so the harness
// has to answer it the way a founder would, mid-flight.
const pending = ctx.sendChat();
// api() reaches the 401 over the network, so the modal opens on a later microtask.
await new Promise((r) => setTimeout(r, 10));
elements.get('mauliKeyModal').hidden === false
  ? pass('a refused chat raises the key modal instead of failing silently') : fail('no modal on 401');
elements.get('mauliKeyInput').value = '';
elements.get('mauliKeyCancel').click();
await pending;
const afterFail = msgs.innerHTML;
if (afterFail.includes('{"ok"')) fail('chat printed the raw JSON envelope: ' + afterFail);
else if (/Founder key/i.test(afterFail)) pass('chat says: ' + (afterFail.match(/Founder[^<]*/) || [''])[0]);
else fail('chat said nothing useful: ' + afterFail);

console.log('\nChat with a valid key:');
ctx.openFounderKey();
elements.get('mauliKeyInput').value = 'founder-secret-key';
elements.get('mauliKeySave').click();
msgs.innerHTML = ''; msgs.children = [];
elements.get('chatIn').value = 'hello again';
await ctx.sendChat();
const afterOk = msgs.innerHTML;
afterOk.includes('नमस्कार') ? pass('chat renders the engine reply') : fail('chat output: ' + afterOk);

console.log('\nClearing the key:');
sandbox.__mauliClearFounderKey();
bar.hidden === false ? pass('banner returns') : fail('banner did not return');

console.log(failures ? `\n${failures} DASHBOARD KEY CHECK(S) FAILED` : '\nALL DASHBOARD KEY BEHAVIOUR CHECKS PASSED');
process.exit(failures ? 1 : 0);