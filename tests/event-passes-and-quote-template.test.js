// Production shipped the generic list fallback ("Add an item..." / "Nothing here yet") for
// two real founder commands — "an event management app for garba passes with entry and exit
// barcode scanner functionality" and "a quote generator software" — because routing matched
// no domain and every unmatched request is served by listAppFiles(). These tests pin the
// fix: each domain now routes to its own working, persisting template, and the generic
// fallback strings never reach the preview.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFromTemplate } from '../src/app-templates.js';
import { evaluateRequirementCoverage } from '../src/generated-app-quality.js';
import { verifyGeneratedApp } from '../scripts/verify-generated-app.mjs';

// Run a template's own inline script against a tiny DOM/localStorage shim and hand back the
// handlers plus the module-level state, the way a browser would expose them.
function boot(objective, storage) {
  const template = generateFromTemplate({ objective, requirements: [objective] });
  const html = template.files[0].content;
  const script = /<script>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
  assert.ok(script, 'the page must contain a script');
  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', value: '', classList: { add() {}, remove() {} } });
      return els.get(id);
    },
    querySelectorAll() { return []; }
  };
  const store = storage ?? { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const api = new Function('document', 'localStorage', script + `
    return {
      addPass: typeof addPass==='function'?addPass:null,
      scanPass: typeof scanPass==='function'?scanPass:null,
      clearPasses: typeof clearPasses==='function'?clearPasses:null,
      addLine: typeof addLine==='function'?addLine:null,
      saveQuote: typeof saveQuote==='function'?saveQuote:null,
      clearQuotes: typeof clearQuotes==='function'?clearQuotes:null,
      renderQuote: typeof renderQuote==='function'?renderQuote:null,
      passes: function(){ return typeof PASSES!=='undefined'?PASSES:null; },
      scans: function(){ return typeof SCANS!=='undefined'?SCANS:null; },
      lines: function(){ return typeof LINES!=='undefined'?LINES:null; },
      quotes: function(){ return typeof QUOTES!=='undefined'?QUOTES:null; }
    };`)(document, store);
  return { template, html, document, api, store };
}

const EVENT = 'Design and develop an event management app for garba passes with entry and exit barcode scanner functionality';
const QUOTE = 'Design and develop a quote generator software';

test('garba passes route to a real pass app, not the generic list fallback', () => {
  const { template, html } = boot(EVENT);
  assert.equal(template.projectType, 'event-passes');
  assert.equal(template.templateMatched, true, 'a garba-pass command must claim its domain');
  assert.notEqual(template.templateRejected, true);
  assert.doesNotMatch(html, /Add an item|Nothing here yet|Clear done/, 'the generic fallback must not be shipped');
  assert.match(html, /pass/i, 'the app must use the pass domain vocabulary');
  assert.match(html, /scan/i, 'the app must offer gate scanning');
  assert.match(html, /inside/i, 'the app must track who is inside');
});

test('a quote generator routes to a real quote app, not the generic list fallback', () => {
  const { template, html } = boot(QUOTE);
  assert.equal(template.projectType, 'quote-generator');
  assert.equal(template.templateMatched, true);
  assert.notEqual(template.templateRejected, true);
  assert.doesNotMatch(html, /Add an item|Nothing here yet|Clear done/);
  assert.match(html, /quote/i);
  assert.match(html, /tax/i);
});

test('both templates pass the fidelity gate and run as working, persisting apps', () => {
  for (const objective of [EVENT, QUOTE]) {
    const template = generateFromTemplate({ objective, requirements: [objective] });
    const run = verifyGeneratedApp(template.files, { objective, requirements: [objective] });
    assert.equal(run.quality.passed, true, `${objective}: ${run.quality.violations.map((v) => v.code).join(', ')}`);
    assert.equal(run.verdict, 'functional', `${objective}: ${JSON.stringify(run.errors)}`);
    assert.equal(run.missingHandlers.length, 0, `${objective}: unbound ${run.missingHandlers.join(',')}`);
    assert.equal(run.storageChanged, true, `${objective}: the app must persist its state`);
    const coverage = evaluateRequirementCoverage([objective], template.files)[0];
    assert.equal(coverage.status, 'IMPLEMENTED', `${objective}: ${coverage.evidence}`);
  }
});

test('scanning a garba pass records an entry, then an exit, and persists both', () => {
  const { document, api, store } = boot(EVENT);
  document.getElementById('mauli-pass-name').value = 'Aarav Patil';
  api.addPass();
  assert.equal(api.passes().length, 1);
  const code = api.passes()[0].code;
  assert.match(code, /^PASS-\d+$/);

  // First scan: the holder is outside, so this is an entry.
  document.getElementById('mauli-pass-scan').value = code;
  api.scanPass();
  assert.equal(api.passes()[0].inside, true, 'a scanned pass is now inside');
  assert.equal(api.scans()[0].action, 'entry');
  assert.equal(document.getElementById('mauli-pass-inside').textContent, '1');
  assert.equal(document.getElementById('mauli-pass-entries').textContent, '1');

  // Second scan: the holder is inside, so this is an exit.
  document.getElementById('mauli-pass-scan').value = code;
  api.scanPass();
  assert.equal(api.passes()[0].inside, false, 'the second scan lets them out');
  assert.equal(api.scans()[0].action, 'exit');
  assert.equal(document.getElementById('mauli-pass-entries').textContent, '1', 'an exit is not an entry');
  assert.equal(document.getElementById('mauli-pass-inside').textContent, '0');

  const persisted = JSON.parse(store.data['mauli-event-passes']);
  assert.equal(persisted.passes.length, 1);
  assert.equal(persisted.scans.length, 2);
});

test('an unknown pass code is refused instead of counting a ghost entry', () => {
  const { document, api } = boot(EVENT);
  document.getElementById('mauli-pass-scan').value = 'PASS-9999';
  api.scanPass();
  assert.equal(api.scans().length, 0, 'an unknown code must not record a scan');
  assert.match(document.getElementById('mauli-pass-summary').textContent, /No pass found/);
});

test('a quote totals its line items with tax and saves a persisted quote', () => {
  const { document, api, store } = boot(QUOTE);
  document.getElementById('mauli-line-desc').value = 'Logo design';
  document.getElementById('mauli-line-qty').value = '2';
  document.getElementById('mauli-line-price').value = '100';
  api.addLine();
  assert.equal(api.lines().length, 1);

  document.getElementById('mauli-tax').value = '18';
  api.renderQuote();
  assert.equal(document.getElementById('mauli-subtotal').textContent, '200.00');
  assert.equal(document.getElementById('mauli-tax-total').textContent, '36.00');
  assert.equal(document.getElementById('mauli-grand-total').textContent, '236.00');

  document.getElementById('mauli-customer').value = 'Shree Events';
  api.saveQuote();
  assert.equal(api.quotes().length, 1);
  assert.equal(api.quotes()[0].total, 236);
  assert.equal(api.lines().length, 0, 'saving a quote starts a fresh one');
  const persisted = JSON.parse(store.data['mauli-quotes']);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].customer, 'Shree Events');
});
