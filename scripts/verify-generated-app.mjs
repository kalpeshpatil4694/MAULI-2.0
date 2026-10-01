#!/usr/bin/env node
// MAULI 2.0 — generated-application RUNTIME verifier.
//
// "Code exists" is not "the feature works", and "HTTP 200" is not "the operation ran".
// The only way to know a generated app functions is to execute it. A Cloudflare Worker
// cannot do that (untrusted code, ~10ms CPU on the free tier, no child processes), so the
// runtime check runs here in Node — in CI and locally — while the Worker applies the
// static fidelity gate (src/generated-app-quality.js).
//
// This loads a generated code-workspace, builds a minimal DOM/localStorage environment,
// executes the app's own scripts inside a vm with a hard timeout, then invokes the app's
// handlers and reports whether the DOM/state actually changed. It never touches the
// network. Usage:
//
//   node scripts/verify-generated-app.mjs --self-test      # proves the verifier works
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { analyzeGeneratedApp } from '../src/generated-app-quality.js';

const SCRIPT_TIMEOUT_MS = 500;

function makeClassList(el) {
  const set = new Set();
  return {
    add: (...cs) => cs.forEach((c) => set.add(c)),
    remove: (...cs) => cs.forEach((c) => set.delete(c)),
    toggle: (c) => (set.has(c) ? set.delete(c) : set.add(c)),
    contains: (c) => set.has(c),
    _set: set
  };
}

function makeElement(tag = 'div', id = '') {
  const el = {
    tagName: String(tag).toUpperCase(),
    id,
    className: '',
    value: '',
    textContent: '',
    innerHTML: '',
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    _listeners: {},
    _attrs: {}
  };
  el.classList = makeClassList(el);
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); if (k === 'id') el.id = String(v); if (k === 'class') el.className = String(v); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.removeAttribute = (k) => { delete el._attrs[k]; };
  el.addEventListener = (type, fn) => { (el._listeners[type] ||= []).push(fn); };
  el.removeEventListener = () => {};
  el.dispatchEvent = (evt) => { for (const fn of el._listeners[evt?.type] || []) fn(evt); return true; };
  el.appendChild = (child) => { el.children.push(child); return child; };
  el.appendChild = el.appendChild;
  el.removeChild = (child) => { el.children = el.children.filter((c) => c !== child); return child; };
  el.remove = () => {};
  el.click = () => el.dispatchEvent({ type: 'click', target: el });
  el.focus = () => {};
  el.blur = () => {};
  el.querySelector = () => null;
  el.querySelectorAll = () => [];
  el.closest = () => el;
  el.insertAdjacentHTML = () => {};
  return el;
}

// Discover every element id declared in the markup so getElementById resolves real nodes.
function elementsFromHtml(html) {
  const elements = new Map();
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^>]*)>/g)) {
    const tag = m[1];
    const attrs = m[2];
    const idMatch = attrs.match(/\bid\s*=\s*["']([^"']+)["']/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const el = makeElement(tag, id);
    const cls = attrs.match(/\bclass\s*=\s*["']([^"']*)["']/);
    if (cls) { el.className = cls[1]; cls[1].split(/\s+/).filter(Boolean).forEach((c) => el.classList.add(c)); }
    const val = attrs.match(/\bvalue\s*=\s*["']([^"']*)["']/);
    if (val) el.value = val[1];
    elements.set(id, el);
  }
  return elements;
}

function snapshot(elements, storage) {
  const out = new Map();
  for (const [id, el] of elements) {
    out.set(id, `${el.innerHTML}|${el.textContent}|${el.value}|${el.className}|${[...el.classList._set].join(',')}`);
  }
  return out;
}

function diffCount(before, after) {
  let n = 0;
  for (const [id, v] of after) if (before.get(id) !== v) n++;
  return n;
}

function splitScripts(files) {
  const inline = [];
  let html = '';
  for (const f of files) {
    if (!/\.html?$/i.test(f.path)) continue;
    html += String(f.content ?? '');
    for (const m of String(f.content ?? '').matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) inline.push(m[1]);
  }
  const external = files.filter((f) => /\.(m?js)$/i.test(f.path)).map((f) => String(f.content ?? ''));
  return { inline, external, html };
}

/**
 * Execute a generated app and prove its handlers do something.
 * @returns {{verdict:'functional'|'static'|'broken', executed:boolean, errors:Array,
 *   missingHandlers:Array, invoked:Array, mutatedElements:number, storageChanged:boolean,
 *   handlers:number, quality:object}}
 */
export function verifyGeneratedApp(files, { objective = '', requirements = [], timeoutMs = SCRIPT_TIMEOUT_MS } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const quality = analyzeGeneratedApp(list, { objective, requirements });
  const { inline, external, html } = splitScripts(list);
  const elements = elementsFromHtml(html);

  const storage = new Map();
  const errors = [];
  const timers = [];
  const document = {
    getElementById: (id) => elements.get(String(id)) ?? null,
    querySelector: (sel) => (typeof sel === 'string' && sel.startsWith('#') ? elements.get(sel.slice(1)) ?? null : null),
    querySelectorAll: () => [],
    createElement: (tag) => makeElement(tag),
    createTextNode: (t) => ({ textContent: t }),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: makeElement('body'),
    head: makeElement('head'),
    documentElement: makeElement('html')
  };

  const sandbox = {
    document,
    localStorage: {
      getItem: (k) => (storage.has(String(k)) ? storage.get(String(k)) : null),
      setItem: (k, v) => storage.set(String(k), String(v)),
      removeItem: (k) => storage.delete(String(k)),
      clear: () => storage.clear(),
      key: (i) => [...storage.keys()][i] ?? null,
      get length() { return storage.size; }
    },
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: () => {},
    requestAnimationFrame: (fn) => { timers.push(fn); return timers.length; },
    alert() {}, confirm: () => true, prompt: () => null,
    navigator: { geolocation: { getCurrentPosition: () => {} }, mediaDevices: {}, userAgent: 'mauli-verify' },
    location: { href: 'https://app.local/', reload() {}, assign() {} },
    fetch: () => Promise.reject(new Error('network-disabled-during-verification')),
    URL: { createObjectURL: () => 'blob:verify', revokeObjectURL() {} },
    Blob: class Blob { constructor() { this.size = 0; } },
    MediaRecorder: class MediaRecorder { constructor() { this.state = 'inactive'; } static isTypeSupported() { return true; } },
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Promise, Intl, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const ctx = vm.createContext(sandbox);
  const executed = true;

  // Execute the app's scripts with a hard timeout so an accidental infinite loop cannot
  // hang the verifier.
  for (const [i, src] of [...inline, ...external].entries()) {
    if (!String(src).trim()) continue;
    try {
      new vm.Script(String(src), { filename: `generated-app-${i}.js` }).runInContext(ctx, { timeout: timeoutMs });
    } catch (error) {
      errors.push({ stage: 'execute', index: i, message: String(error?.message ?? error).slice(0, 300) });
    }
  }

  // Which functions does the app expose, and which does its markup call?
  const ctxFns = Object.keys(ctx).filter((k) => typeof ctx[k] === 'function');
  const refs = new Set();
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*["']([^"']*)["']/gi)) {
    for (const call of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) refs.add(call[1]);
  }
  const missingHandlers = [...refs].filter((name) => typeof ctx[name] !== 'function');

  // Invoke every zero-argument handler the markup references and see whether anything
  // observably changes. A handler that throws, or that changes nothing at all, is not a
  // working feature.
  const before = snapshot(elements, storage);
  const invoked = [];
  let mutatedElements = 0;
  for (const name of refs) {
    if (missingHandlers.includes(name)) continue;
    const arity = ctx[name].length;
    if (arity > 0) { invoked.push({ name, status: 'skipped-args' }); continue; }
    try {
      new vm.Script(`${name}()`, { filename: `invoke-${name}.js` }).runInContext(ctx, { timeout: timeoutMs });
      const after = snapshot(elements, storage);
      const mutations = diffCount(before, after);
      mutatedElements += mutations;
      for (const [id, v] of after) before.set(id, v);
      invoked.push({ name, status: mutations > 0 ? 'mutated' : 'no-op', mutations });
    } catch (error) {
      invoked.push({ name, status: 'threw', message: String(error?.message ?? error).slice(0, 200) });
    }
  }

  const storageChanged = storage.size > 0;
  const threw = invoked.some((i) => i.status === 'threw');
  const didSomething = mutatedElements > 0 || storageChanged;

  let verdict = 'functional';
  if (errors.length || missingHandlers.length || threw) verdict = 'broken';
  else if (!didSomething || invoked.every((i) => i.status !== 'mutated')) verdict = 'static';

  return { verdict, executed, errors, missingHandlers, invoked, mutatedElements, storageChanged, handlers: ctxFns.length, quality };
}

export function runSelfTest() {
  const results = [];
  const check = (ok, label, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`); };

  // A real, working app: a counter whose button actually changes state and persists it.
  const good = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><body><h1>Counter</h1><div id="value">0</div><button id="inc" onclick="increment()">Increment</button><script src="app.js"></script></body></html>'
    },
    {
      path: 'www/app.js',
      content: 'let count=Number(localStorage.getItem("count")||0);function render(){document.getElementById("value").textContent=String(count);localStorage.setItem("count",String(count));}function increment(){count=count+1;render();}render();'
    },
    { path: 'package.json', content: '{"name":"counter","version":"1.0.0"}' }
  ];

  // A demo: the button is wired to nothing, a log-only handler, and a placeholder.
  const bad = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><body><h1>Demo App</h1><div id="out">Coming soon</div><button onclick="doThing()">Do thing</button></body></html>'
    },
    { path: 'www/app.js', content: 'function doThing(){ console.log("clicked"); }' }
  ];

  const goodResult = verifyGeneratedApp(good, { objective: 'Build a counter app', requirements: ['Increment the counter', 'Persist count across refresh'] });
  check(goodResult.verdict === 'functional', 'working app is runtime-verified as functional', `verdict=${goodResult.verdict}, mutations=${goodResult.mutatedElements}`);
  check(goodResult.missingHandlers.length === 0, 'no missing handlers in the working app');
  check(goodResult.storageChanged, 'the working app actually persisted state');

  const badResult = verifyGeneratedApp(bad, { objective: 'Build a demo app' });
  check(badResult.verdict !== 'functional', 'demo app is not runtime-verified as functional', `verdict=${badResult.verdict}`);
  check(badResult.invoked.every((i) => i.status !== 'mutated'), 'the demo button changes nothing observable');
  check(badResult.quality.passed === false, 'demo app fails the static fidelity gate', badResult.quality.violations.map((v) => v.code).join(', '));

  // A truly broken app: the markup calls a handler that was never defined.
  const broken = [{ path: 'www/index.html', content: '<!DOCTYPE html><html><body><button onclick="saveItem()">Save</button></body></html>' }];
  const brokenResult = verifyGeneratedApp(broken, { objective: 'Save items' });
  check(brokenResult.verdict === 'broken', 'app with an unbound handler is broken at runtime', `missing=${brokenResult.missingHandlers.join(',')}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed === results.length ? 'ALL VERIFIER CHECKS PASSED' : 'VERIFIER CHECKS FAILED'} (${passed}/${results.length})`);
  if (passed !== results.length) process.exitCode = 1;
  return passed === results.length;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else {
    console.log('Usage: node scripts/verify-generated-app.mjs --self-test');
    console.log('(Runtime verification of a live project runs from CI or the durability harness.)');
  }
}
