import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Projects table rendered a "📄 Details" button carrying .proj-detail, and the
// delegated click handler in the injected live layer only matched
// .dl-btn / .bld-btn / .pv-btn. Nothing in dashboard.js bound a handler either, so
// pressing Details on a project did nothing at all — the detail view was reachable only
// from the live command card in the overview.
const live = readFileSync(new URL('../src/dashboard-live.js', import.meta.url), 'utf8');
const dash = readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');

test('the Projects table Details button is bound to the detail view', () => {
  const handler = live.match(/closest\('([^']+)'\)[\s\S]{0,900}?\},true\);/);
  assert.ok(handler, 'a capture-phase delegated click handler must exist');
  assert.match(
    handler[1],
    /proj-detail/,
    'the delegated handler must match .proj-detail, otherwise the button is inert'
  );
  assert.match(
    live.slice(handler.index, handler.index + 900),
    /showProjectDetail\(t\.dataset\.pid\)/,
    '.proj-detail must route to showProjectDetail'
  );
});

test('the detail view is published on window regardless of polling', () => {
  // The inline onclick on the command card and any early click both depend on this. It used
  // to be assigned only from inside poll(), so a click before the first poll found it
  // undefined and silently did nothing.
  const assignments = [...live.matchAll(/window\.__showProjDetail=showProjectDetail;/g)].map(m => m.index);
  const pollIndex = live.indexOf('async function poll()');
  assert.ok(assignments.length > 0, '__showProjDetail must be published');
  assert.ok(
    assignments.some(i => i < pollIndex),
    '__showProjDetail must be assigned outside poll() so it exists before the first poll'
  );
});

test('the project name in the Projects table opens the detail view', () => {
  assert.match(
    dash,
    /class="proj-detail"[^>]*data-pid="'\+p\.id/,
    'the project name must be clickable, not inert text'
  );
});