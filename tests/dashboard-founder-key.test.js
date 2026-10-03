// The dashboard's founder-key gate.
//
// The founder-reported failure this pins: eight dashboard options (Chat, Learning,
// Messaging, API Explorer, Docs, File Editor, Integrations, Builds) showed up empty and
// Chat answered with a raw JSON envelope. Every one of those endpoints is founder-
// protected, and the key was reachable only through a window.prompt() the founder can
// dismiss without noticing — so "not signed in" was indistinguishable from "no data" and
// from "feature missing". These tests hold the key control, the readable error and the
// chat bubble to that bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHTML } from '../src/dashboard.js';

const html = dashboardHTML();

function scriptOfDashboard() {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(m, 'the dashboard must ship its script');
  return m[1];
}

const script = scriptOfDashboard();

test('every navigation option has a page to open', () => {
  const nav = [...html.matchAll(/class="nav-i[^"]*"[^>]*data-p="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(nav.length >= 20, `expected the full option list, got ${nav.length}`);
  const declared = [...html.matchAll(/data-p="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(nav, declared, 'a nav entry must be reachable from the sidebar');
  for (const page of nav) {
    assert.ok(html.includes(`id="pg-${page}"`), `"${page}" is in the sidebar but has no page`);
  }
});

test('the founder key is enterable through real UI, not only a window.prompt', () => {
  assert.ok(html.includes('id="mauliKeyBtn"'), 'the top bar needs a visible founder-key control');
  assert.ok(html.includes('id="mauliKeyModal"'), 'the key needs an input the founder can type into');
  assert.ok(html.includes('id="mauliKeyInput"'), 'the modal needs a field to paste the key into');
  assert.ok(html.includes('id="mauliKeyRemember"'), 'the founder must choose whether the key persists');
  assert.ok(html.includes('id="mauliKeyClear"'), 'the founder must be able to clear a wrong key');
  assert.ok(
    !/function requestFounderKey\(\)\{[^}]*window\.prompt/.test(script),
    'the key prompt must not be a window.prompt the founder can dismiss unnoticed'
  );
});

test('the key banner appears only while the founder is locked out', () => {
  assert.ok(html.includes('id="mauliKeyBar"'), 'locked-out state must be visible, not silent');
  assert.match(script, /function paintFounderKeyState\(\)/);
  // A panel that is merely empty must not raise the banner; only a real 401/503 may.
  const paint = script.slice(script.indexOf('function paintFounderKeyState'), script.indexOf('function showFounderKeyModal'));
  assert.match(paint, /if\(bar\)bar\.hidden=on;/, 'the banner must hide once a key is present');
});

test('a refused request throws a readable message, not the raw response envelope', () => {
  assert.match(script, /function readableApiError\(/);
  const start = script.indexOf('function readableApiError');
  const body = script.slice(start, script.indexOf('async function api('));
  assert.match(body, /JSON\.parse/, 'the {ok:false,error:{message}} envelope must be unwrapped');
  assert.match(body, /Request failed \(HTTP /, 'an unparseable body must still say what happened');

  // The old behaviour threw the whole body, which is how the chat bubble printed JSON.
  const api = script.slice(script.indexOf('async function api('), script.indexOf('// ─── NAVIGATION'));
  assert.ok(
    !/throw new Error\(t\|\|r\.status\)/.test(api),
    'api() must not throw the raw response text any more'
  );
  assert.match(api, /readableApiError\(t,r\.status\)/);
});

test('a 401 raises the key control and explains itself in the founder\'s language', () => {
  const api = script.slice(script.indexOf('async function api('), script.indexOf('// ─── NAVIGATION'));
  assert.match(api, /founderAuthNeeded\(r\)/);
  assert.match(api, /await requestFounderKey\(\)/, 'the key prompt is async and must be awaited');
  assert.match(api, /Founder key लागत आहे/, 'a locked-out founder must be told exactly what to do');
});

test('chat renders the engine reply and reports failures as sentences', () => {
  const start = script.indexOf('async function sendChat');
  const send = script.slice(start, script.indexOf('function addQuickReplies'));
  assert.match(send, /resp\.response&&resp\.response\.text/, 'chat must read the engine\'s response.text');
  assert.ok(
    !/JSON\.stringify\(r,null,2\)/.test(send),
    'chat must never print the raw API payload into the bubble'
  );
  assert.match(send, /esc\(e\.message\|\|'Chat failed'\)/, 'a failed chat must say what failed');
});

test('the live download path awaits the now-async key prompt', async () => {
  const { DASHBOARD_LIVE_SCRIPT } = await import('../src/dashboard-live.js');
  const live = String(DASHBOARD_LIVE_SCRIPT);
  assert.match(live, /await window\.__mauliRequestFounderKey\(\)/);
  assert.ok(
    !/__mauliRequestFounderKey&&window\.__mauliRequestFounderKey\(\)/.test(live),
    'an unawaited Promise is truthy and retried the download with no key at all'
  );
});