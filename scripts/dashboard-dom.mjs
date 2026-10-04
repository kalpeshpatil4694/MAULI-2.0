// A DOM shim faithful enough to RUN the dashboard's own inline script and drive it, so a test
// can assert the behaviour a founder sees instead of pattern-matching the source.
//
// Shared by the founder-key harness (scripts/dashboard-key-check.mjs) and the MCP render test
// (tests/dashboard-mcp-render.test.js) so there is exactly one shim to keep honest. A green
// source-reading assertion is not proof that a renderer works; this executes it.
import vm from 'node:vm';

export function makeEl(tag = 'div', id = '') {
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
  // A browser runs BOTH addEventListener handlers and the `onclick` property. The shim only ran
  // the listeners, so every onclick= control in the dashboard read as dead and the check blamed
  // the product for the harness's gap.
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

/**
 * Build the sandbox, discover the page's elements by id, and run the dashboard script.
 *
 * `handleRequest(path, opts)` decides the response for each fetch the script makes; the
 * default answers an empty `{ok:true,data:{}}` envelope. Every call is recorded on the
 * returned `requests` array so a caller can assert on the headers/paths that were sent.
 */
export function makeDashboardDom(html, { fetch: handleRequest } = {}) {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

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

  const requests = [];
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
      if (typeof handleRequest === 'function') return handleRequest(path, opts);
      return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '{}' };
    }
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {};

  const ctx = vm.createContext(sandbox);
  new vm.Script(script, { filename: 'dashboard.js' }).runInContext(ctx, { timeout: 5000 });

  return { elements, requests, sandbox, ctx, script };
}
