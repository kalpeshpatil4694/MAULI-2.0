// The founder sets GROQ_API_KEY on the Cloudflare Worker and then needs to know whether the
// secret arrived. Before this element the answer lived behind an API call nobody made, so
// "key configured" and "key never propagated" looked identical from the dashboard.
//
// The status therefore lives in the topbar — the one region painted on every page — and is
// fetched from /api/health when the script loads. These tests EXECUTE the real dashboard
// script against a real payload, so "it is visible without further interaction" is observed
// rather than asserted from a source regex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHTML } from '../src/dashboard.js';
import { makeDashboardDom } from '../scripts/dashboard-dom.mjs';

const HEALTH = (over = {}) => ({
  service: 'mauli2.0',
  status: 'degraded',
  degradedReason: 'workers-ai-allowance-exhausted',
  ai: true,
  aiAvailable: false,
  groqConfigured: true,
  groqModel: 'llama-3.3-70b-versatile',
  generationPath: 'groq',
  d1Quota: { date: '2026-10-04', used: 0, limit: 100000, remaining: 100000, percent: 0, status: 'healthy' },
  stateReads: {},
  ...over,
});

function domWith(health) {
  return makeDashboardDom(dashboardHTML(), {
    fetch: async (path) => {
      if (path === '/api/health') {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: health }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '{}' };
    },
  });
}

// The dashboard script paints the chip from a promise chain. Polling for the actual state
// rather than counting ticks keeps this deterministic under the full suite's parallel load —
// a fixed number of microtask drains is a test that passes by timing luck.
async function until(read, ms = 4000) {
  const deadline = Date.now() + ms;
  for (;;) {
    let value;
    try { value = read(); } catch { value = null; }
    if (value) return value;
    if (Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 5));
  }
}

const UNSET = /undefined|NaN|\[object|\bnull\b/i;

test('the Groq status is in the always-visible topbar, not behind a page or a button', () => {
  const source = dashboardHTML();
  const topbar = source.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0];
  assert.ok(topbar, 'the dashboard must have a topbar');
  assert.ok(topbar.includes('id="groqChip"'), 'the Groq status must live in the topbar');
  assert.match(source, /loadGroqChip\(\);/, 'the status must be painted when the script loads');
});

test('on load the chip reports a configured key with its model and generation path', async () => {
  const dom = domWith(HEALTH());
  const chip = dom.elements.get('groqChip');
  assert.ok(chip, 'the topbar must carry the Groq status element');
  await until(() => chip.textContent);

  assert.match(chip.textContent, /Groq: Configured/);
  assert.match(chip.textContent, /llama-3\.3-70b-versatile/, 'the model must be shown');
  assert.match(chip.textContent, /groq/, 'the generation path must be shown');
  assert.doesNotMatch(chip.textContent, UNSET);
  assert.match(chip.style.color, /green/, 'a configured key is a healthy state');
  assert.ok(
    dom.requests.some((r) => r.path === '/api/health'),
    'the chip reads /api/health — no separate endpoint exists for it'
  );
});

test('an absent key reports Not Configured instead of a reassuring blank', async () => {
  const dom = domWith(HEALTH({ groqConfigured: false, groqModel: null, generationPath: 'deterministic-templates' }));
  const chip = dom.elements.get('groqChip');
  await until(() => chip.textContent);
  assert.match(chip.textContent, /Groq: Not Configured/);
  assert.doesNotMatch(chip.textContent, UNSET);
  assert.match(chip.style.color, /yellow/);
});

// Negative control: the health payload as it shipped before this element existed. Reading a
// missing field as a bare string is how a dashboard turns "unknown" into "Configured".
test('a payload without Groq fields never reads as Configured (control)', async () => {
  const legacy = {
    service: 'mauli2.0',
    status: 'healthy',
    ai: true,
    d1Quota: { used: 0, limit: 100000, remaining: 100000, percent: 0, status: 'healthy', date: '2026-10-04' },
    stateReads: {},
  };
  const dom = domWith(legacy);
  const chip = dom.elements.get('groqChip');
  await until(() => chip.textContent);
  assert.match(chip.textContent, /^➖ Groq: —$/, 'an unreported verdict stays unreported as Configured');
  assert.doesNotMatch(chip.textContent, /Configured/);
  assert.doesNotMatch(chip.textContent, UNSET);
});

test('the Health page repeats the verdict as full detail rows', async () => {
  const dom = domWith(HEALTH());
  await until(() => dom.elements.get('groqChip').textContent);

  await dom.ctx.renderHealth();
  const detail = await until(() => dom.elements.get('hlthDet').innerHTML);
  assert.match(detail, /Groq/, 'the Health page must carry a Groq row');
  assert.match(detail, /Configured/);
  assert.match(detail, /llama-3\.3-70b-versatile/, 'the model is repeated as detail');
  assert.match(detail, /Generation path/);
  assert.doesNotMatch(detail, UNSET);
});
