import test from 'node:test';
import assert from 'node:assert/strict';

import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { runUserJourney, planJourney } from '../scripts/user-journey.mjs';
import { repairUntilTheJourneyPasses } from '../scripts/repair-loop.mjs';
import { createRuntime, loadWorker } from '../scripts/generated-runtime.mjs';

const SHOP = 'Build a coffee shop order app with login, registration and live order updates for staff';

function build(command, platform = 'web') {
  const spec = extractRequirementSpec({ command, platform });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture);
  return { spec, architecture, built, api: `/api/${built.table}s` };
}

// ---------------------------------------------------------------------------
// 10 / 11. The backend is executed, not scanned
// ---------------------------------------------------------------------------

test('the generated backend really executes against a real database binding', async () => {
  const { built, api } = build(SHOP);
  const runtime = createRuntime({});
  try {
    const worker = await loadWorker(built.files, runtime);
    assert.equal(worker.entry, 'worker/index.js');
    assert.equal(typeof worker.handler, 'function', 'the Worker must export a fetch handler');

    const call = async (method, path, body, token) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await worker.handler(
        new Request(`https://generated.app${path}`, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body)
        }),
        runtime.env, {}
      );
      return { status: response.status, body: await response.clone().json().catch(() => null) };
    };

    // 1. The D1 binding is a real store: a row written here is inspectable there.
    const email = `runtime-${Date.now()}@test.local`;
    assert.equal((await call('POST', '/api/register', { email, password: 'longenough1' })).status, 201);
    const users = runtime.DB.snapshot().find((t) => t.table === 'users');
    assert.equal(users.rows.length, 1, 'registration must write a user row into D1');
    assert.equal(users.rows[0].password_hash.length, 64, 'the password must be hashed, not stored');

    // 2. A wrong password is refused; the stored hash is compared, not echoed.
    assert.equal((await call('POST', '/api/login', { email, password: 'wrongwrong1' })).status, 401);

    // 3. A real session is issued and really authorises.
    const login = await call('POST', '/api/login', { email, password: 'longenough1' });
    assert.equal(login.status, 200);
    assert.ok(login.body.token, 'login must return a session token');
    assert.equal((await call('GET', api, undefined)).status, 401, 'an unauthenticated read must be refused');
    assert.equal((await call('GET', api, undefined, login.body.token)).status, 200);

    // 4. Create → validate → insert → return id, with the row really in D1.
    assert.equal((await call('POST', api, { title: '' }, login.body.token)).status, 422, 'invalid input must be rejected');
    const created = await call('POST', api, { title: 'Latte', amount: 3.5 }, login.body.token);
    assert.equal(created.status, 201);
    const orders = runtime.DB.snapshot().find((t) => t.table === built.table);
    assert.equal(orders.rows.length, 1, 'the created record must exist in the database');
    assert.equal(orders.rows[0].title, 'Latte');

    // 5. Update and delete really change the stored row.
    const id = created.body[built.table].id;
    assert.equal((await call('PUT', `${api}/${id}`, { title: 'Flat white' }, login.body.token)).status, 200);
    assert.equal(runtime.DB.snapshot().find((t) => t.table === built.table).rows[0].title, 'Flat white');
    assert.equal((await call('DELETE', `${api}/${id}`, undefined, login.body.token)).status, 200);
    assert.equal(runtime.DB.snapshot().find((t) => t.table === built.table).rows.length, 0);

    // 6. Logging out really kills the session.
    assert.equal((await call('POST', '/api/logout', {}, login.body.token)).status, 200);
    assert.equal((await call('GET', api, undefined, login.body.token)).status, 401, 'a dead token must not keep working');
  } finally { runtime.disposeGlobals(); }
});

// ---------------------------------------------------------------------------
// 12. The founder's own journey
// ---------------------------------------------------------------------------

test('the founder journey is derived from the command, not fixed', () => {
  const shop = planJourney(build(SHOP).spec, build(SHOP).architecture).map((s) => s.id);
  const medicine = planJourney(build('Build a medicine timetable tracker for my mother').spec, build('Build a medicine timetable tracker for my mother').architecture).map((s) => s.id);
  assert.ok(shop.includes('register') && shop.includes('realtime') && shop.includes('logout'));
  assert.ok(!medicine.includes('register'), 'a personal tracker owes no registration step');
  assert.ok(!medicine.includes('realtime'));
  assert.notDeepEqual(shop, medicine);
});

test('the whole journey passes on the generated product, executing every step', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  const result = await runUserJourney(built.files, { spec, architecture, api, objective: SHOP });
  const failed = result.steps.filter((s) => s.status === 'FAIL');
  assert.deepEqual(failed.map((s) => `${s.id}: ${s.detail}`), [], 'the founder journey must pass end to end');
  assert.ok(result.passed);
  for (const key of ['backend', 'database', 'create', 'read', 'update', 'delete', 'persistence',
    'auth_register', 'auth_login', 'auth_protected', 'logout', 'realtime', 'validation', 'error_handling']) {
    assert.equal(result.evidence[key], true, `runtime evidence "${key}" must be produced by execution`);
  }
  assert.ok(result.rowsInDb > 0, 'records must really exist in the database');
});

test('data written before a refresh is still readable after it', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  const result = await runUserJourney(built.files, { spec, architecture, api, objective: SHOP });
  const refresh = result.steps.find((s) => s.id === 'refresh');
  assert.equal(refresh.status, 'PASS');
  assert.match(refresh.detail, /earlier row: true/);
});

// ---------------------------------------------------------------------------
// 5 / 13. The journey catches a product that only pretends to work
// ---------------------------------------------------------------------------

test('a backend that fakes success fails the journey', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  const fake = built.files.map((f) => f.path === 'worker/index.js'
    ? { ...f, content: `export default { async fetch(request) {
  return new Response(JSON.stringify({ ok: true, orders: [{ id: 1, title: 'Latte' }], token: 'abc' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
} };` }
    : f);
  const result = await runUserJourney(fake, { spec, architecture, api, objective: SHOP });
  assert.equal(result.passed, false, 'a backend that answers 200 without a database is not a working product');
  assert.ok(result.steps.some((s) => s.id === 'create' && s.status === 'FAIL'), 'the create step must catch the fabricated response');
  assert.equal(result.evidence.database, false);
});

test('a backend that never refuses an unauthenticated request fails the journey', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  const open = built.files.map((f) => f.path === 'worker/index.js'
    ? { ...f, content: f.content.replace('if (!user) return fail(\'Authentication required\', 401);', '') }
    : f);
  const result = await runUserJourney(open, { spec, architecture, api, objective: SHOP });
  assert.equal(result.steps.find((s) => s.id === 'unauthorized').status, 'FAIL',
    'a public read of everyone\'s data must fail the journey');
  assert.equal(result.evidence.auth_protected, false);
});

test('a product with no backend at all is reported as missing one, not passed', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  const frontendOnly = built.files.filter((f) => !f.path.startsWith('worker/'));
  const result = await runUserJourney(frontendOnly, { spec, architecture, api, objective: SHOP });
  assert.equal(result.passed, false);
  const start = result.steps.find((s) => s.id === 'backend-starts');
  assert.equal(start.status, 'FAIL');
  assert.match(start.detail, /could not be loaded|no Worker\/API entry point/);
});

// ---------------------------------------------------------------------------
// 14. The bounded repair loop
// ---------------------------------------------------------------------------

test('a repair re-runs the whole journey, not only the failing step', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  // Build 1 is broken on purpose: the created record comes back without its id.
  let attempts = 0;
  const outcome = await repairUntilTheJourneyPasses(async (attempt) => {
    if (attempt === 0) {
      return built.files.map((f) => f.path === 'worker/index.js'
        ? { ...f, content: f.content.replace("return json({ ok: true, " + built.table + ": row }, 201);", "return json({ ok: true, " + built.table + ": { title: row.title } }, 201);") }
        : f);
    }
    return built.files;
  }, { spec, architecture, api, objective: SHOP, maxAttempts: 2 });

  assert.equal(outcome.attempts, 1, 'one repair should be enough for a single defect');
  assert.equal(outcome.passed, true);
  assert.equal(outcome.repairs.length, 1);
  assert.ok(outcome.repairs[0].causes.some((c) => c.step === 'create'), 'the diagnosis must name the step that actually broke');
  assert.ok(outcome.repairs[0].causes[0].requirement.length > 10, 'the diagnosis must describe the requirement, not just the step name');
});

test('the repair loop is bounded and reports failure honestly', async () => {
  const { spec, architecture, built, api } = build(SHOP);
  // Never fixed: the repair loop must stop, not spin, and must not claim success.
  const outcome = await repairUntilTheJourneyPasses(async () => built.files.filter((f) => !f.path.startsWith('worker/')),
    { spec, architecture, api, objective: SHOP, maxAttempts: 2 });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.attempts, 2, 'the loop must stop at its bound');
  assert.equal(outcome.repairs.length, 2);
});
