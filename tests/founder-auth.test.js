// Proves founder authentication is real. requireFounder() used to return
// { ok: true } unconditionally, so every "protected" route (including the full-data
// wipe) was open to anyone who could reach the workers.dev hostname. These tests
// pin the replacement: a real API key, compared in constant time, with production
// failing closed when no key is configured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireFounder, readFounderKey, keylessAllowed, timingSafeEqual, founderAuthStatus, protectedPath } from '../src/auth.js';
import { store } from '../src/store.js';

const SECRET = 'mauli-founder-live-9f2c7d1e4b';
const PROD = { ENVIRONMENT: 'production', MAULI_FOUNDER_KEY: SECRET };

function req(headers = {}) {
  return new Request('https://mauli.test/api/artifacts', { headers });
}

// ── Unit level ──────────────────────────────────────────────────────────────

test('the founder key is read from the configured environment variables', () => {
  assert.equal(readFounderKey({ MAULI_FOUNDER_KEY: ' a ' }), 'a');
  assert.equal(readFounderKey({ FOUNDER_KEY: 'b' }), 'b');
  assert.equal(readFounderKey({ MAULI_API_KEY: 'c' }), 'c');
  assert.equal(readFounderKey({}), null);
  assert.equal(readFounderKey({ MAULI_FOUNDER_KEY: '   ' }), null);
});

test('key comparison is length- and value-safe', () => {
  assert.equal(timingSafeEqual(SECRET, SECRET), true);
  assert.equal(timingSafeEqual(SECRET, SECRET.slice(0, -1)), false);
  assert.equal(timingSafeEqual(SECRET, SECRET + 'x'), false);
  assert.equal(timingSafeEqual(SECRET, 'mauli-founder-live-9f2c7d1e4A'), false, 'must be case sensitive');
  assert.equal(timingSafeEqual(SECRET, null), false);
  assert.equal(timingSafeEqual(null, null), false);
});

test('production with a key requires that exact key on every protected route', () => {
  const anonymous = requireFounder(req(), PROD);
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.mode, 'denied');
  assert.equal(anonymous.error, 'Founder key required or invalid');
  assert.equal(requireFounder(req({ 'x-mauli-founder': 'wrong' }), PROD).ok, false);
});

test('the key is accepted from the header, bearer token and x-api-key', () => {
  for (const headers of [
    { 'x-mauli-founder': SECRET },
    { 'x-founder-key': SECRET },
    { 'x-api-key': SECRET },
    { authorization: `Bearer ${SECRET}` },
  ]) {
    const result = requireFounder(req(headers), PROD);
    assert.equal(result.ok, true, `must accept ${Object.keys(headers)[0]}`);
    assert.equal(result.mode, 'founder-key');
    assert.equal(result.enforced, true);
  }
  assert.equal(requireFounder(req({ authorization: `Basic ${SECRET}` }), PROD).ok, false);
  assert.equal(requireFounder(req({ authorization: SECRET }), PROD).ok, false);
});

test('production without a configured key fails closed instead of staying open', () => {
  const result = requireFounder(req(), { ENVIRONMENT: 'production' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 503, 'must not silently allow unauthenticated production access');
  assert.match(result.error, /MAULI_FOUNDER_KEY/);
  assert.equal(requireFounder(req({ 'x-mauli-founder': SECRET }), { ENVIRONMENT: 'production' }).ok, false,
    'a guessed key must not help when nothing is configured');
});

test('local development and the test suite keep working without a key', () => {
  assert.equal(keylessAllowed({}), true);
  assert.equal(keylessAllowed({ MAULI_TEST_MODE: true }), true);
  assert.equal(keylessAllowed({ SKIP_RESULT_PERSISTENCE: 'true' }), true);
  assert.equal(keylessAllowed({ ENVIRONMENT: 'staging' }), true);
  assert.equal(keylessAllowed({ MAULI_ALLOW_KEYLESS: 'true' }), true);
  assert.equal(keylessAllowed({ ENVIRONMENT: 'production' }), false);
  assert.equal(keylessAllowed({ ENVIRONMENT: 'production', MAULI_ALLOW_KEYLESS: 'true' }), true,
    'explicit opt-out must stay available for previews');
  assert.equal(requireFounder(req(), {}).mode, 'keyless-founder');
  assert.equal(requireFounder(req({ 'x-mauli-founder': SECRET }), PROD).mode, 'founder-key');
});

test('founderAuthStatus reports the active mode for the integrations panel', () => {
  assert.deepEqual(founderAuthStatus({}), { keyConfigured: false, keyless: true, enforced: false, environment: null });
  assert.deepEqual(founderAuthStatus({ ENVIRONMENT: 'production' }),
    { keyConfigured: false, keyless: false, enforced: false, environment: 'production' });
  assert.deepEqual(founderAuthStatus(PROD),
    { keyConfigured: true, keyless: false, enforced: true, environment: 'production' });
  assert.equal(protectedPath('/api/command'), true);
  assert.equal(protectedPath('/api/approvals/x'), true);
  assert.equal(protectedPath('/api/state'), false);
});

// ── HTTP level: the actual proof ────────────────────────────────────────────

let loadCounter = 0;
async function freshApp() {
  loadCounter += 1;
  const { default: app } = await import(`../src/index.js?t=${loadCounter}`);
  return app;
}
const ctx = { waitUntil() {} };

async function hit(app, env, path = '/api/artifacts', init = {}) {
  const res = await app.fetch(new Request(`https://mauli.test${path}`, init), env, ctx);
  let body = null;
  try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
}

test('HTTP: a founder-protected endpoint rejects a request with no key and accepts the right one', async () => {
  const app = await freshApp();
  store.put('projects', { id: 'auth-demo', name: 'Auth demo', objective: 'x', state: 'active' });

  const anonymous = await hit(app, PROD, '/api/artifacts');
  assert.equal(anonymous.status, 401, 'unauthenticated founder endpoint must be denied');

  const wrong = await hit(app, PROD, '/api/artifacts', { headers: { 'x-mauli-founder': 'nope' } });
  assert.equal(wrong.status, 401, 'a wrong key must be denied');

  const authorized = await hit(app, PROD, '/api/artifacts', { headers: { 'x-mauli-founder': SECRET } });
  assert.equal(authorized.status, 200, 'the correct key must be accepted');
  assert.equal(authorized.body.ok, true);
});

test('HTTP: chat (the unauthenticated scheduler trigger) now requires the founder key', async () => {
  const app = await freshApp();
  const anonymous = await hit(app, PROD, '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }),
  });
  assert.equal(anonymous.status, 401, 'chat must not be reachable without the founder key');

  const wrong = await hit(app, PROD, '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-mauli-founder': 'nope' }, body: JSON.stringify({ message: 'hello' }),
  });
  assert.equal(wrong.status, 401);
});

test('HTTP: data-wipe and debug endpoints are closed without the key', async () => {
  const app = await freshApp();
  for (const [path, init] of [
    ['/api/reset', { method: 'POST' }],
    ['/api/cf/debug', {}],
    ['/api/chat/history', {}],
    ['/api/chat/active', {}],
    ['/api/app-files?projectId=auth-demo', {}],
    ['/api/project-analytics', {}],
    ['/api/system-metrics', {}],
    ['/api/system-status', {}],
    ['/api/result-diagnostic', {}],
  ]) {
    const res = await hit(app, PROD, path, init);
    assert.equal(res.status, 401, `${path} must reject anonymous access`);
  }
});

test('HTTP: the same endpoints work for the founder with the correct key', async () => {
  const app = await freshApp();
  const key = { 'x-mauli-founder': SECRET };
  for (const [path, init] of [
    ['/api/chat/history', {}],
    ['/api/chat/active', {}],
    ['/api/system-status', {}],
    ['/api/system-metrics', {}],
    ['/api/project-analytics', {}],
    ['/api/cf/debug', {}],
  ]) {
    const res = await hit(app, PROD, path, { ...init, headers: { ...(init.headers ?? {}), ...key } });
    assert.equal(res.status, 200, `${path} must be reachable for the founder`);
  }
});

test('HTTP: the dashboard, health and state bootstrap stay public', async () => {
  const app = await freshApp();
  for (const path of ['/', '/api/health', '/api/heartbeat', '/api/state']) {
    const res = await hit(app, PROD, path);
    assert.equal(res.status, 200, `${path} must stay reachable without a key so the founder can load the UI and get a health check`);
  }
});

test('HTTP: without a key in production every protected route reports the misconfiguration', async () => {
  const app = await freshApp();
  const res = await hit(app, { ENVIRONMENT: 'production' }, '/api/artifacts');
  assert.equal(res.status, 503);
  assert.match(res.body?.error?.message ?? res.body?.error ?? '', /MAULI_FOUNDER_KEY/);
});

test('HTTP: existing test/local behaviour is unchanged when no key is configured', async () => {
  const app = await freshApp();
  store.put('projects', { id: 'local-demo', name: 'Local demo', objective: 'x', state: 'active' });
  const res = await hit(app, {}, '/api/artifacts');
  assert.equal(res.status, 200, 'local/CI environments keep keyless access');
});
