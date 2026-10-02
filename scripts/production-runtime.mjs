#!/usr/bin/env node
// MAULI 2.0 — PRODUCTION RUNTIME ACCEPTANCE: the executor.
//
// src/production-runtime.js judges the evidence; this file PRODUCES it by actually running
// the generated application:
//
//   DEPLOYED WORKER → Health → API Contract → Authentication → Core Business Operation
//   → D1 Persistence → Read/Update/Delete → Error Handling → User Journey → Runtime Evidence
//
// Two transports, one report shape:
//
//   * `worker-runtime` (default) — the generated Worker is loaded and executed against a
//     real in-memory D1, real WebCrypto and a real WebSocketPair. Every HTTP call below is a
//     genuine `Request` into the generated `fetch` handler; nothing is mocked and nothing is
//     simulated. This is the transport CI and the durability harness use.
//   * `deployed-http` — when `baseUrl` is given, the same sequence is issued over real
//     network HTTP against a deployed Worker. This is the post-deploy smoke test.
//
// The report is never allowed to claim more than it observed: a test that did not run is
// absent (which the gate treats as BLOCKED), and a test that observed a static response is
// FAIL, not PASS. The strongest check here is the anti-fake one: the record list is captured
// BEFORE and AFTER a create, and an endpoint that answers the same payload to both is a
// hardcoded JSON body, whatever its status code says.

import { createRuntime, loadWorker } from './generated-runtime.mjs';
import { runUserJourney } from './user-journey.mjs';
import { verifyGeneratedApp, interact, drainMicrotasks } from './verify-generated-app.mjs';
import { fakeRuntimeSignals, hasBackendEntryPoint, PRODUCTION_RUNTIME_VERSION } from '../src/production-runtime.js';
import { analyzeGeneratedApp } from '../src/generated-app-quality.js';

const CALL_TIMEOUT_MS = 8000;

// Generated code is executed in this process. An app with a broken promise chain produces an
// unhandled rejection, and Node's default reaction is to kill the process — which would take
// the whole acceptance run (and the CI job) down with it and report nothing at all. The guard
// is installed once and never removed; the rejection becomes evidence against the app, which
// is exactly what this run exists to produce.
const ACTIVE_RUNTIME_ERROR_SINKS = new Set();
let rejectionGuardInstalled = false;
function installRejectionGuard() {
  if (rejectionGuardInstalled) return;
  if (typeof process !== 'undefined' && typeof process.on === 'function') {
    process.on('unhandledRejection', (reason) => {
      const message = String(reason?.message ?? reason).slice(0, 300);
      // The DOM shim deliberately rejects an un-networkable fetch so a frontend that cannot
      // reach its backend is visible. That sentinel is the harness speaking, not the app
      // throwing, so it is not counted as a runtime error of the product.
      if (/network-disabled-during-verification/.test(message)) return;
      for (const sink of ACTIVE_RUNTIME_ERROR_SINKS) sink.push(message);
    });
    rejectionGuardInstalled = true;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export { hasBackendEntryPoint };

const AUTH_PATHS = ['/api/register', '/api/login', '/api/logout', '/api/session', '/api/me', '/api/live', '/api/health', '/api/users'];

/**
 * Every (method, path) the generated frontend calls with a STATIC endpoint literal — the
 * contract it expects. Dynamic paths (`API + '/' + item.id`, `/api/${table}s` templates) are
 * deliberately not collected: they cannot be probed without an id, and probing `GET /api`
 * reported the whole contract as missing. The record endpoint itself is covered by the
 * create/read/update/delete tests below.
 */
export function frontendApiCalls(files) {
  const calls = new Map();
  const add = (method, path) => {
    if (!path || !/^\/api\/[A-Za-z0-9_-]+$/.test(path)) return;
    calls.set(`${method} ${path}`, { method, path });
  };
  for (const f of (Array.isArray(files) ? files : [])) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') continue;
    if (!/\.(?:html?|[cm]?js)$/i.test(f.path)) continue;
    if (/(?:^|\/)(?:worker|server|backend|routes?)\//i.test(f.path)) continue;
    if (/(?:^|\/)(?:worker|server|backend)\.[cm]?js$/i.test(f.path)) continue;
    const code = String(f.content);
    // api('POST', '/api/login', body)
    for (const m of code.matchAll(/\bapi\s*\(\s*['"](GET|POST|PUT|DELETE)['"]\s*,\s*['"]([^'"]+)['"]/gi)) add(m[1].toUpperCase(), m[2]);
    // fetch('/api/me', { method: 'GET' })
    for (const m of code.matchAll(/\bfetch\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{([^}]*)\})?/gi)) {
      const method = (/method\s*:\s*['"](GET|POST|PUT|DELETE)['"]/i.exec(m[2] ?? '')?.[1] ?? 'GET').toUpperCase();
      add(method, m[1]);
    }
  }
  return [...calls.values()];
}

export function frontendApiPaths(files) {
  return [...new Set(frontendApiCalls(files).map((c) => c.path))].sort();
}

/**
 * The record resource the product exposes. A generated shop serves /api/orders; asking for
 * /api/records reports a working API as 404. Derived from the code itself, never assumed.
 */
export function deriveRecordsPath(files, { spec = null } = {}) {
  const counts = new Map();
  for (const f of (Array.isArray(files) ? files : [])) {
    if (!f || typeof f.content !== 'string') continue;
    for (const m of String(f.content).matchAll(/\/api\/([a-z][a-z0-9_-]*s)\b/gi)) {
      const path = `/api/${m[1].toLowerCase()}`;
      if (AUTH_PATHS.includes(path)) continue;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length) return ranked[0][0];
  // Last resort: the founder's own domain noun, pluralised the way the compiler does.
  const noun = spec?.inferredFromDomain ?? spec?.domainWords?.[0] ?? null;
  return noun ? `/api/${noun}s` : null;
}

function readRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const value of Object.values(payload)) if (Array.isArray(value)) return value;
  return [];
}

function readRecord(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in value) return value;
  }
  return 'id' in payload ? payload : null;
}

// ---------------------------------------------------------------------------
// the executor
// ---------------------------------------------------------------------------

/**
 * Run the production smoke test against a generated application.
 *
 * @param {Array} files - generated code workspace
 * @param {object} options
 * @param {string} [options.baseUrl] - deployed endpoint; switches to real HTTP transport
 * @param {string} [options.api] - record resource path (default: derived)
 * @param {object} [options.spec] - extracted specification
 * @param {object} [options.architecture] - selected architecture
 * @param {object} [options.credentials] - env-var NAME → value/boolean for external services
 * @returns {Promise<object>} the structured runtime acceptance record
 */
export async function runProductionRuntimeAcceptance(files, {
  spec = {}, architecture = null, objective = '', requirements = [], api = null,
  env = {}, baseUrl = null, fetchImpl = null, credentials = {}, testedAt = null
} = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const backend = architecture ? architecture.backend === true : hasBackendEntryPoint(list);
  const authRequired = architecture?.auth === true || spec?.authentication?.required === true;
  const realtimeRequired = architecture?.realtime === true || spec?.realtime?.required === true;
  const externalServices = spec?.externalServices ?? [];

  const testedAtStamp = testedAt ?? new Date().toISOString();
  const transport = baseUrl ? 'deployed-http' : 'worker-runtime';
  const tests = {};
  // The generated app is executed here, including its own frontend. An app with a broken
  // promise chain produces an unhandled rejection, and Node's default is to kill the
  // process — which would take the whole acceptance run down with it and report nothing.
  // The rejection is instead collected as a runtime error and reported as a FAIL, because
  // "the app threw while running" is exactly the evidence this run exists to produce.
  const runtimeErrors = [];
  installRejectionGuard();
  ACTIVE_RUNTIME_ERROR_SINKS.add(runtimeErrors);
  const failures = [];
  const record = (id, pass, detail, extra = {}) => {
    const status = pass === true ? 'PASS' : pass === 'MISSING' ? 'MISSING' : 'FAIL';
    tests[id] = { status, detail: detail ?? null, ...extra };
    if (status === 'FAIL') failures.push(`${id}: ${detail}`);
    return status === 'PASS';
  };

  const runtime = baseUrl ? null : createRuntime({ env, fetchImpl });
  let worker = null;
  if (!baseUrl) {
    const loaded = await loadWorker(list, runtime).catch((error) => ({ handler: null, loadError: String(error?.message ?? error) }));
    worker = { ...loaded, env: runtime.env, module: loaded?.module };
  }

  const recordsPath = String(api || deriveRecordsPath(list, { spec }) || '').replace(/\/$/, '');
  const contractCalls = frontendApiCalls(list);

  /** One real request: over the network when deployed, into the handler when executed. */
  async function callApi(method, path, { body, token } = {}) {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} ${path} timed out`)), CALL_TIMEOUT_MS));
    try {
      let response;
      if (baseUrl) {
        const send = fetchImpl ?? fetch;
        response = await Promise.race([send(new URL(path, baseUrl).toString(), init), timeout]);
      } else {
        if (!worker?.handler) return { ok: false, status: 0, body: null, error: 'no backend entry point exposes a fetch handler' };
        response = await Promise.race([worker.handler(new Request(`https://generated.app${path}`, init), worker.env, {}), timeout]);
      }
      let payload = null;
      try { payload = await response.clone().json(); } catch { payload = null; }
      return { ok: response.status >= 200 && response.status < 300, status: response.status, body: payload, headers: Object.fromEntries(response.headers?.entries?.() ?? []) };
    } catch (error) {
      return { ok: false, status: 0, body: null, error: String(error?.message ?? error) };
    }
  }

  const rowsInDb = () => {
    if (!runtime) return null;
    return runtime.DB.snapshot().flatMap((t) => t.rows).filter((r) => Object.values(r).some((v) => v !== null && v !== '' && v !== undefined)).length;
  };

  const user = { email: `mauli-runtime-${Date.now()}@acceptance.local`, password: 'Acceptance-1234!', name: 'Acceptance User' };
  let token = null;
  let frontendProbe = null;

  // -- 0. the frontend is executed too (UI interaction, local persistence) -------------
  // A backend-carrying app's frontend is wired INTO the generated Worker, so the page's own
  // calls are executed for real — this is the frontend↔backend integration seam, not a
  // simulation of one. When there is no backend the fetch is a failing response rather than
  // an unhandled rejection, so a page that calls an API it does not have is reported instead
  // of crashing the run.
  const frontendFetch = worker?.handler
    ? (input, init = {}) => worker.handler(
      new Request(new URL(typeof input === 'string' ? input : input.url, 'https://generated.app'), init),
      worker.env, {}
    )
    : () => Promise.resolve(new Response(JSON.stringify({ error: { message: 'no backend is part of this generated app' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  try {
    frontendProbe = verifyGeneratedApp(list, { objective, requirements, timeoutMs: 1500, fetchImpl: frontendFetch });
  } catch (error) {
    frontendProbe = { error: String(error?.message ?? error) };
  }

  // -- 1. deployment -------------------------------------------------------------------
  if (backend) {
    if (baseUrl) {
      const probe = await callApi('GET', recordsPath || '/api/health');
      record('deployment', probe.status > 0 && !probe.error, probe.error ?? `GET ${recordsPath || '/api/health'} → ${probe.status}`, { request: `GET ${recordsPath || '/api/health'}`, responseStatus: probe.status });
    } else {
      record('deployment', Boolean(worker?.handler), worker?.handler ? `executed ${worker.entry}` : (worker?.loadError ?? 'no fetch handler was exported'), { responseStatus: null });
    }
  }

  // -- 2. health -----------------------------------------------------------------------
  if (backend) {
    const health = await callApi('GET', '/api/health');
    const target = health.status === 404 || health.status === 0 ? await callApi('GET', recordsPath || '/api/records') : health;
    record('health', target.status > 0 && target.status < 500 && !target.error, target.error ?? `read probe → ${target.status}`, { request: `GET ${health.status === 404 ? recordsPath : '/api/health'}`, responseStatus: target.status });
  }

  // -- 3. API contract: every static endpoint the frontend calls must resolve ----------
  // Each call is issued with the method the frontend actually uses, so `GET /api/login`
  // (a POST-only route) is never mistaken for a missing endpoint. 404 means the frontend
  // calls something the backend does not serve; 401/405/400 mean it exists and refused.
  if (backend) {
    const probes = contractCalls.length ? contractCalls : (recordsPath ? [{ method: 'GET', path: recordsPath }] : []);
    if (!probes.length) {
      record('api-contract', 'MISSING', 'the generated frontend references no static /api endpoint and no record resource was found');
    } else {
      const missing = [];
      const errored = [];
      for (const call of probes) {
        const probe = await callApi(call.method, call.path);
        if (probe.status === 404) missing.push(`${call.method} ${call.path}`);
        else if (probe.status === 0 || probe.status >= 500) errored.push(`${call.method} ${call.path}→${probe.status || 'no response'}`);
      }
      record('api-contract', missing.length === 0 && errored.length === 0,
        missing.length ? `the generated frontend calls endpoints that do not exist: ${missing.join(', ')}`
          : errored.length ? `the generated frontend calls endpoints that error: ${errored.join(', ')}`
            : `all ${probes.length} static frontend endpoint(s) resolve: ${probes.map((c) => `${c.method} ${c.path}`).join(', ')}`,
        { request: probes.map((c) => `${c.method} ${c.path}`).join(', '), responseStatus: null });
    }
  }

  // -- 4. authentication ---------------------------------------------------------------
  if (backend && authRequired) {
    const unauthorized = await callApi('GET', recordsPath || '/api/records');
    record('unauthorized', unauthorized.status === 401 || unauthorized.status === 403,
      `GET ${recordsPath} without a session → ${unauthorized.status}`, { request: `GET ${recordsPath}`, responseStatus: unauthorized.status });

    const badRegister = await callApi('POST', '/api/register', { body: { email: 'not-an-email' } });
    const register = await callApi('POST', '/api/register', { body: user });
    const duplicate = await callApi('POST', '/api/register', { body: user });
    record('register', register.ok, `POST /api/register → ${register.status}`, { request: 'POST /api/register', responseStatus: register.status, persisted: Boolean(rowsInDb()) });
    record('duplicate-register', !duplicate.ok && duplicate.status >= 400,
      `registering ${user.email} a second time → ${duplicate.status} (invalid-email attempt → ${badRegister.status})`,
      { request: 'POST /api/register (duplicate)', responseStatus: duplicate.status });

    const badLogin = await callApi('POST', '/api/login', { body: { email: user.email, password: 'wrong-password' } });
    record('invalid-login', !badLogin.ok && badLogin.status >= 400, `POST /api/login with a wrong password → ${badLogin.status}`,
      { request: 'POST /api/login (wrong password)', responseStatus: badLogin.status });

    const login = await callApi('POST', '/api/login', { body: { email: user.email, password: user.password } });
    token = login.body?.token ?? login.body?.data?.token ?? login.body?.sessionToken
      ?? (login.headers?.authorization ?? '').replace(/^Bearer\s+/i, '') ?? null;
    if (!token) token = null;
    record('login', login.ok && Boolean(token), login.ok ? (token ? 'a session token was returned' : 'a 200 was returned but with no session token') : `POST /api/login → ${login.status}`,
      { request: 'POST /api/login', responseStatus: login.status });
    if (token) {
      const withSession = await callApi('GET', recordsPath || '/api/records', { token });
      record('session', withSession.ok, `GET ${recordsPath} with the session → ${withSession.status}`, { request: `GET ${recordsPath} (session)`, responseStatus: withSession.status });
    } else {
      record('session', 'MISSING', 'no session token was issued, so a protected read could not be attempted');
    }
  }

  // -- 5. invalid input is rejected before it reaches the database ---------------------
  if (backend && recordsPath) {
    const bad = await callApi('POST', recordsPath, { body: { title: '' }, token });
    record('invalid-input', !bad.ok && bad.status >= 400, `POST ${recordsPath} with an empty title → ${bad.status}`,
      { request: `POST ${recordsPath} (empty body)`, responseStatus: bad.status });

    // -- 6. core business operation + the anti-fake check ----------------------------
    const before = await callApi('GET', recordsPath, { token });
    const beforeRows = readRows(before.body);
    const rowsBefore = rowsInDb();

    const createdRes = await callApi('POST', recordsPath, { body: { title: 'Acceptance record', detail: 'created by the production acceptance run', amount: 42 }, token });
    const created = readRecord(createdRes.body);
    const id = created?.id ?? created?.recordId ?? created?._id ?? null;
    const after = await callApi('GET', recordsPath, { token });
    const afterRows = readRows(after.body);
    const rowsAfter = rowsInDb();

    record('create', createdRes.ok && id !== null, `POST ${recordsPath} → ${createdRes.status}${id !== null ? `, id ${id}` : ', no id returned'}`,
      { request: `POST ${recordsPath}`, responseStatus: createdRes.status, persisted: rowsAfter === null ? null : rowsAfter > (rowsBefore ?? 0) });
    record('read', after.ok && afterRows.some((r) => String(r?.title ?? '') === 'Acceptance record'),
      `GET ${recordsPath} → ${after.status}, created row present: ${afterRows.some((r) => String(r?.title ?? '') === 'Acceptance record')}`,
      { request: `GET ${recordsPath}`, responseStatus: after.status });

    // A static JSON body answers the same payload before and after a write. That is a fake
    // API no matter how healthy its status code looks.
    const staticBody = JSON.stringify(beforeRows) === JSON.stringify(afterRows);
    record('fake-check', !staticBody && rowsAfter !== null && rowsAfter > (rowsBefore ?? 0) && fakeRuntimeSignals(list).length === 0,
      staticBody
        ? 'the record list was byte-identical before and after a create — the endpoint serves a static body'
        : `the list changed after the write and D1 holds ${rowsAfter} row(s); no fake/mock signal in the source`,
      { request: `GET ${recordsPath} (before/after)`, responseStatus: after.status, persisted: rowsAfter !== null && rowsAfter > (rowsBefore ?? 0) });

    if (id !== null) {
      const updated = await callApi('PUT', `${recordsPath}/${id}`, { body: { title: 'Acceptance record edited', detail: 'updated' }, token });
      const afterUpdate = readRows((await callApi('GET', recordsPath, { token })).body);
      const changed = afterUpdate.some((r) => String(r?.title ?? '') === 'Acceptance record edited');
      record('update', changed, `PUT ${recordsPath}/${id} → ${updated.status}, new value stored: ${changed}`,
        { request: `PUT ${recordsPath}/${id}`, responseStatus: updated.status, persisted: changed });

      const removed = await callApi('DELETE', `${recordsPath}/${id}`, { token });
      const afterDelete = readRows((await callApi('GET', recordsPath, { token })).body);
      const gone = !afterDelete.some((r) => String(r?.title ?? '') === 'Acceptance record edited');
      record('delete', gone, `DELETE ${recordsPath}/${id} → ${removed.status}, row removed: ${gone}`,
        { request: `DELETE ${recordsPath}/${id}`, responseStatus: removed.status, persisted: gone });

      const missing = await callApi('GET', `${recordsPath}/${id}`, { token });
      const listAfter = readRows((await callApi('GET', recordsPath, { token })).body);
      const absent = (missing.status === 404 || missing.status === 400 || missing.status === 0 || missing.ok === false)
        && !listAfter.some((r) => String(r?.id ?? '') === String(id));
      record('read-missing', absent, `reading the deleted record → ${missing.status}, absent from the list: ${!listAfter.some((r) => String(r?.id ?? '') === String(id))}`,
        { request: `GET ${recordsPath}/${id}`, responseStatus: missing.status, persisted: absent });
    } else {
      record('update', 'MISSING', 'no record id was returned, so update/delete could not be exercised');
      record('delete', 'MISSING', 'no record id was returned, so update/delete could not be exercised');
      record('read-missing', 'MISSING', 'no record id was returned, so the missing-record read could not be exercised');
    }

    // Persistence across a SEPARATE request (not the same response object): a fresh request
    // must serve the row a previous request wrote.
    const again = await callApi('POST', recordsPath, { body: { title: 'Survives a separate request' }, token });
    const reread = await callApi('GET', recordsPath, { token });
    const stillThere = readRows(reread.body).some((r) => String(r?.title ?? '') === 'Survives a separate request');
    record('refresh', again.ok && stillThere, `a later request sees the earlier write: ${stillThere} (D1 holds ${rowsInDb()} row(s))`,
      { request: `GET ${recordsPath} after write`, responseStatus: reread.status, persisted: stillThere });

    record('database', (rowsInDb() ?? 0) > 0, `D1 holds ${rowsInDb()} row(s) written through the API`, { persisted: (rowsInDb() ?? 0) > 0 });

    // Logout and the post-logout refusal. "GET /login returned 200" is not authentication:
    // the old session must stop working, and the read must prove it.
    if (authRequired && token) {
      const out = await callApi('POST', '/api/logout', { token });
      const afterLogout = await callApi('GET', recordsPath, { token });
      const dead = afterLogout.status === 401 || afterLogout.status === 403;
      record('logout', out.ok, `POST /api/logout → ${out.status}`, { request: 'POST /api/logout', responseStatus: out.status });
      record('post-logout', dead, `the old session now reads ${recordsPath} → ${afterLogout.status}`, { request: `GET ${recordsPath} (after logout)`, responseStatus: afterLogout.status });
      token = null;
    }
  }

  // -- 7. error handling ---------------------------------------------------------------
  if (backend) {
    const notFound = await callApi('GET', '/api/this-route-does-not-exist-9f3a');
    record('error-path', notFound.status >= 400 && notFound.status < 600, `an unknown route → ${notFound.status} instead of a fabricated 200`,
      { request: 'GET /api/this-route-does-not-exist-9f3a', responseStatus: notFound.status });
  }

  // -- 8. external services ------------------------------------------------------------
  if (externalServices.length) {
    const available = externalServices.filter((s) => credentials?.[s.envVar] || credentials?.[s.key]);
    const missingCreds = externalServices.filter((s) => !(credentials?.[s.envVar] || credentials?.[s.key]));
    if (missingCreds.length && available.length === 0) {
      record('external-service', 'MISSING', `no credential is configured for ${missingCreds.map((s) => s.label).join(', ')} (${missingCreds.map((s) => s.envVar).join(', ')}) — the real service cannot be called, so no success can be claimed`);
    } else {
      // With a credential the app must reach the real service; without one it must fail
      // visibly rather than inventing data.
      const probe = await callApi('GET', recordsPath || '/api/records');
      record('external-service', !(probe.ok && missingCreds.length > 0),
        missingCreds.length
          ? `the app answered 200 for a service with no configured credential (${missingCreds.map((s) => s.envVar).join(', ')}) — a fabricated success`
          : `a credential is configured for ${available.map((s) => s.label).join(', ')}`,
        { responseStatus: probe.status });
    }
  }

  // -- 9. real-time: two clients, one write ---------------------------------------------
  // -- 10. user journey: the founder's own steps, executed ------------------------------
  if (runtime) {
    runtime.disposeGlobals();
  }
  const journey = await runUserJourney(list, {
    spec, architecture: architecture ?? {}, objective, requirements, api: recordsPath || '/api/records'
  }).catch((error) => ({ passed: false, steps: [], evidence: {}, errors: [String(error?.message ?? error)] }));

  if (realtimeRequired && backend) {
    record('realtime', journey.evidence?.realtime === true,
      journey.evidence?.realtime === true
        ? 'a write made through the API reached two independently connected clients'
        : (journey.errors ?? []).find((e) => e.startsWith('realtime:')) ?? 'no two-client proof was produced');
  }
  record('user-journey', journey.passed === true,
    journey.passed === true
      ? `all ${journey.steps?.length ?? 0} journey steps passed`
      : `failing step(s): ${(journey.steps ?? []).filter((s) => s.status === 'FAIL').map((s) => `${s.id} (${s.detail})`).join('; ') || 'the journey did not run'}`);

  // -- 11. local architecture: UI interaction + on-device persistence -------------------
  if (!backend) {
    const ui = frontendProbe ?? {};
    const interactions = ui.mutatedElements ?? 0;
    const storageChanged = ui.storageChanged === true || [...(ui.storage?.values?.() ?? [])].length > 0;
    record('ui-interaction', ui.verdict === 'functional' && interactions > 0,
      `the app executed and its controls changed the DOM ${interactions} time(s)`,
      { persisted: storageChanged });
    record('local-persistence', storageChanged, storageChanged ? 'the app wrote state it can read back on reload' : 'the app never persisted anything', { persisted: storageChanged });
    if (ui.error) record('user-journey', false, `the app did not execute: ${ui.error}`);
  }

  // Late rejections arrive on a later tick than the call that caused them; give them a turn
  // to land so they are attributed to this run instead of the next one.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  ACTIVE_RUNTIME_ERROR_SINKS.delete(runtimeErrors);
  if (runtimeErrors.length) {
    // The app threw while it was being driven. That is a runtime error (spec item 1: "runtime
    // errors आहेत का"), so the journey did not complete — it is a FAIL, never a pass.
    record('user-journey', false, `the generated app threw while running: ${runtimeErrors.join('; ')}`);
    if (!backend) record('ui-interaction', false, `the generated app threw while running: ${runtimeErrors.join('; ')}`);
  }
  const failedAfterRuntime = Object.entries(tests).filter(([, t]) => t.status === 'FAIL').map(([id]) => id);
  const report = {
    version: PRODUCTION_RUNTIME_VERSION,
    status: failedAfterRuntime.length === 0 ? 'passed' : 'failed',
    runtimeErrors,
    transport,
    environment: backend ? (baseUrl ? `deployed worker at ${baseUrl} + D1` : 'production-like worker runtime + D1') : 'generated app + device store',
    deployment: baseUrl ?? (backend ? 'generated Worker executed against a real D1 binding' : 'generated app executed in the DOM runtime'),
    testedAt: testedAtStamp,
    api: recordsPath,
    contractPaths: contractCalls.map((c) => `${c.method} ${c.path}`),
    tests,
    failures,
    evidence: Object.entries(tests).map(([id, t]) => ({ test: id, status: t.status, detail: t.detail, request: t.request ?? null, responseStatus: t.responseStatus ?? null, persisted: t.persisted ?? null })),
    journey: { passed: journey.passed === true, steps: (journey.steps ?? []).map((s) => ({ id: s.id, status: s.status, detail: s.detail })) },
    rowsInDb: rowsInDb()
  };
  return report;
}

// ---------------------------------------------------------------------------
// self test: the engine must pass a real app and CATCH a fake one
// ---------------------------------------------------------------------------
export async function runSelfTest() {
  const results = [];
  const check = (ok, label, detail = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`); };

  const { generateFullStackApp } = await import('../src/fullstack-codegen.js');
  const { extractRequirementSpec } = await import('../src/requirement-spec.js');
  const { selectArchitecture } = await import('../src/architecture.js');
  const { evaluateRuntimeAcceptance } = await import('../src/production-runtime.js');

  const command = 'Build a shop order app for a coffee shop with staff login and live order updates';
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  const requirements = spec.requirements.map((r) => ({ id: r.id, title: r.title, category: r.category, critical: r.critical }));

  const report = await runProductionRuntimeAcceptance(built.files, { spec, architecture, objective: command, requirements, api: `/api/${built.table}s` });
  check(report.status === 'passed', 'a real generated product passes production runtime acceptance', report.failures.join('; ') || `transport=${report.transport}`);
  check(report.tests.create?.status === 'PASS' && report.tests.database?.status === 'PASS', 'the D1 create/read/database evidence is real, not a 200', JSON.stringify(report.tests.database));
  check(report.tests['fake-check']?.status === 'PASS', 'the anti-fake check passes for a backend that really writes rows');
  check(report.tests['duplicate-register']?.status === 'PASS', 'duplicate registration is rejected');
  check(report.tests['invalid-login']?.status === 'PASS', 'a wrong password is rejected');
  check(report.tests['post-logout']?.status === 'PASS' || report.journey?.steps?.some((s) => s.id === 'logout' && s.status === 'PASS'), 'logout kills the session');
  check(report.tests.realtime?.status === 'PASS', 'the real-time two-client proof ran', JSON.stringify(report.tests.realtime));

  const verdict = evaluateRuntimeAcceptance({ files: built.files, architecture, spec, requirements, acceptance: report, hasBackend: true, credentials: {} });
  check(verdict.status === 'passed', 'the gate accepts a complete acceptance run', verdict.blockingReason ?? '');
  check(verdict.criticalFailed.length === 0, 'no critical requirement is left without runtime evidence', JSON.stringify(verdict.criticalFailed));

  // A backend project with NO acceptance run must BLOCK, never pass.
  const noEvidence = evaluateRuntimeAcceptance({ files: built.files, architecture, spec, requirements, acceptance: null, hasBackend: true, credentials: {} });
  check(noEvidence.status === 'blocked' && noEvidence.blockingCode === 'runtime-evidence-missing', 'a backend project without runtime evidence is BLOCKED', noEvidence.blockingReason ?? '');

  // A static page that answers the same JSON twice must be caught.
  const fake = [
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Orders</h1><ul id="l"></ul><script src="app.js"></script></body></html>' },
    { path: 'www/app.js', content: 'function load(){fetch("/api/orders").then(r=>r.json()).then(function(d){document.getElementById("l").innerHTML=d.map(function(o){return "<li>"+o.title+"</li>"}).join("")})}load();' },
    { path: 'worker/index.js', content: 'export default { async fetch(request){ const url=new URL(request.url); if(url.pathname==="/api/orders" && request.method==="GET"){ return new Response(JSON.stringify({orders:[{id:1,title:"Seeded"}],ok:true}),{headers:{"Content-Type":"application/json"}}); } return new Response(JSON.stringify({ok:true,order:{id:1,title:"Seeded"}}),{headers:{"Content-Type":"application/json"}}); } };' },
    { path: 'package.json', content: '{"name":"fake","version":"1.0.0"}' }
  ];
  const fakeSpec = extractRequirementSpec({ command: 'Build a shop order app for a coffee shop with staff login', platform: 'web' });
  const fakeArch = selectArchitecture(fakeSpec);
  const fakeReport = await runProductionRuntimeAcceptance(fake, { spec: fakeSpec, architecture: fakeArch, objective: 'orders', api: '/api/orders' });
  check(fakeReport.tests['fake-check']?.status === 'FAIL', 'a static JSON backend is caught as fake', JSON.stringify(fakeReport.tests['fake-check']));
  const fakeVerdict = evaluateRuntimeAcceptance({ files: fake, architecture: fakeArch, spec: fakeSpec, acceptance: fakeReport, hasBackend: true, credentials: {} });
  check(fakeVerdict.status !== 'passed', 'the gate refuses a fake backend', `${fakeVerdict.status} ${fakeVerdict.blockingCode ?? ''}`);

  // An external dependency with no credential is a declared dependency, not a pass.
  const weatherSpec = extractRequirementSpec({ command: 'Build a weather dashboard app that shows the forecast for my city', platform: 'web' });
  const weatherArch = selectArchitecture(weatherSpec);
  const depReport = await runProductionRuntimeAcceptance(fake, { spec: weatherSpec, architecture: weatherArch, objective: 'weather', api: '/api/orders' });
  const depVerdict = evaluateRuntimeAcceptance({ files: fake, architecture: weatherArch, spec: weatherSpec, acceptance: depReport, hasBackend: true, credentials: {} });
  check(depVerdict.blockingCode === 'dependency-required' || depVerdict.blockingCode === 'no-false-pass-violation', 'a missing external credential is a declared dependency or a refusal, never a pass', `${depVerdict.status} ${depVerdict.blockingCode} ${depVerdict.blockingReason}`);

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed === results.length ? 'ALL PRODUCTION RUNTIME CHECK PASSED' : 'PRODUCTION RUNTIME CHECK FAILED'} (${passed}/${results.length})`);
  if (passed !== results.length) process.exitCode = 1;
  return passed === results.length;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
  } else if (process.argv.includes('--accept')) {
    const file = process.argv[process.argv.indexOf('--accept') + 1];
    if (!file) { console.error('--accept requires a JSON file with {files, objective, spec, architecture, requirements, api}'); process.exit(2); }
    const { readFileSync } = await import('node:fs');
    const input = JSON.parse(readFileSync(file, 'utf8'));
    const files = Array.isArray(input) ? input : (input.files ?? []);
    const report = await runProductionRuntimeAcceptance(files, {
      spec: input.spec ?? {}, architecture: input.architecture ?? null,
      objective: input.objective ?? '', requirements: input.requirements ?? [], api: input.api ?? null
    });
    console.log(JSON.stringify({ runtimeAcceptance: report }, null, 2));
    process.exit(report.status === 'passed' ? 0 : 1);
  } else {
    console.log('Usage:');
    console.log('  node scripts/production-runtime.mjs --self-test');
    console.log('  node scripts/production-runtime.mjs --accept <input.json>   # prints { runtimeAcceptance }');
  }
}

export default runProductionRuntimeAcceptance;
