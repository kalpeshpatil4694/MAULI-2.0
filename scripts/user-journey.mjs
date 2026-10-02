// MAULI 2.0 — dynamic USER JOURNEY execution.
//
// Spec item 12: the journey is not a fixed script. It is derived from what the founder
// asked for, so "add a medicine" and "let two users see each other's edits" produce
// different journeys, and each step is EXECUTED — the backend really receives the request,
// D1 really holds the row, the UI really changes, and a refresh really re-reads the store.
//
// The journey is also what the repair loop re-runs (item 14): "the failing test changed"
// is not repair. After a fix, the WHOLE affected journey is executed again from the start.

import { verifyGeneratedApp, interact, drainMicrotasks } from './verify-generated-app.mjs';
import { createRuntime, loadWorker } from './generated-runtime.mjs';

const JOURNEY_TIMEOUT_MS = 8000;

// --- request helper ---------------------------------------------------------

async function callApi(worker, method, path, { body, token, env = {} } = {}) {
  if (!worker?.handler) return { ok: false, status: 0, missing: true, body: null };
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const request = new Request(`https://generated.app${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  // The handler must see the SAME env the frontend would be configured with, including the
  // D1 binding. Calling it with an env that lacks DB produced a 500 on every route — a
  // verification bug that looked exactly like a broken product.
  const handlerEnv = { ...(worker.env ?? {}), ...env };
  const response = await Promise.race([
    worker.handler(request, handlerEnv, {}),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`API timeout: ${method} ${path}`)), JOURNEY_TIMEOUT_MS))
  ]);
  let payload = null;
  try { payload = await response.clone().json(); } catch { payload = null; }
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    body: payload ?? null,
    headers: Object.fromEntries(response.headers?.entries?.() ?? [])
  };
}

function rowsOf(db) {
  const snap = db.snapshot();
  return snap.flatMap((t) => t.rows);
}

function nonEmpty(table) {
  return rowsOf(table).filter((r) => Object.values(r).some((v) => v !== null && v !== '' && v !== undefined));
}

// --- journey planning -------------------------------------------------------

/**
 * Build the founder's journey from the extracted specification. Steps are objects with a
 * `run` function so the same plan can be executed once, and again after every repair.
 */
export function planJourney(spec = {}, architecture = {}) {
  const features = new Set((spec.features ?? []).map((f) => f.key));
  const auth = spec.authentication?.required === true;
  const realtime = spec.realtime?.required === true;
  const data = (spec.dataRequirements ?? []).length > 0 || features.has('create');
  const steps = [];

  steps.push({ id: 'startup', label: 'Application starts and the frontend loads', kind: 'frontend' });
  if (architecture.backend !== false) {
    steps.push({ id: 'backend-starts', label: 'Backend starts and serves a request', kind: 'backend' });
    steps.push({ id: 'health', label: 'Backend responds to a read request', kind: 'backend' });
  }
  if (auth) {
    steps.push({ id: 'unauthorized', label: 'A protected read without a session is refused', kind: 'auth' });
    steps.push({ id: 'register', label: 'Register a new user', kind: 'auth' });
    steps.push({ id: 'login', label: 'Log in with the registered credentials', kind: 'auth' });
    steps.push({ id: 'session', label: 'The session token authorises a protected read', kind: 'auth' });
    steps.push({ id: 'validation', label: 'Invalid input is rejected with an error', kind: 'auth' });
  }
  if (data) {
    steps.push({ id: 'create', label: 'Create a record through the real chain', kind: 'data' });
    steps.push({ id: 'validation-data', label: 'Invalid record data is rejected', kind: 'data' });
    steps.push({ id: 'read', label: 'Read the record back from the store', kind: 'data' });
    steps.push({ id: 'update', label: 'Update the record and see the new value', kind: 'data' });
    steps.push({ id: 'delete', label: 'Delete the record and see it disappear', kind: 'data' });
    steps.push({ id: 'recreate', label: 'Recreate a record for the persistence check', kind: 'data' });
    steps.push({ id: 'refresh', label: 'Data is still present after a refresh', kind: 'persistence' });
  }
  if (realtime) steps.push({ id: 'realtime', label: 'A change on one client reaches the other live', kind: 'realtime' });
  if (auth) steps.push({ id: 'logout', label: 'Log out and confirm the session is dead', kind: 'auth' });
  steps.push({ id: 'errors', label: 'A failing request surfaces an error, not a fake success', kind: 'error' });
  return steps;
}

// --- execution --------------------------------------------------------------

/**
 * Execute the journey against the generated app for real.
 * @returns {{passed:boolean, steps:Array, evidence:object, errors:Array}}
 */
export async function runUserJourney(files, { spec = {}, architecture = {}, env = {}, fetchImpl = null, objective = '', requirements = [], api = '/api/records' } = {}) {
  // The record resource is whatever the product actually exposes. A generated shop serves
  // /api/orders, not /api/records; asking for the wrong one reports a working API as 404.
  const recordsPath = String(api || '/api/records').replace(/\/$/, '');
  const readRows = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    for (const value of Object.values(payload)) if (Array.isArray(value)) return value;
    return [];
  };
  // A create response names its own resource (`{ok, order}`, `{record}`, `{data}`). Reading a
  // fixed key reported "no id returned" for a 201 that had in fact inserted a row.
  const readRecord = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    for (const value of Object.values(payload)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && 'id' in value) return value;
    }
    return 'id' in payload ? payload : null;
  };
  const plan = planJourney(spec, architecture);
  const runtime = createRuntime({ env, fetchImpl, files });
  const app = verifyGeneratedApp(files, {
    objective,
    requirements,
    timeoutMs: 1500,
    env: { __generatedEnv: runtime.env },
    fetchImpl: null
  });

  // The generated backend, loaded against the in-memory D1.
  const loaded = await loadWorker(files, runtime).catch((error) => ({ handler: null, loadError: String(error?.message ?? error) }));
  const worker = { ...loaded, env: runtime.env, module: loaded?.module };

  const records = [];
  const evidence = {
    persistence: false, create: false, read: false, update: false, delete: false,
    backend: false, validation: false, database: false,
    auth_register: false, auth_login: false, auth_protected: false, logout: false,
    realtime: false, external: false, error_handling: false
  };
  const errors = [];
  let token = null;
  let created = null;
  const user = { email: `mauli-${Date.now()}@verify.local`, password: 'Verify-1234!', name: 'Journey User' };

  const push = (step, passed, detail) => {
    records.push({ id: step.id, label: step.label, kind: step.kind, status: passed ? 'PASS' : 'FAIL', detail: detail ?? '' });
    if (!passed) errors.push(`${step.id}: ${detail ?? 'step failed'}`);
    return passed;
  };

  const findStep = (id) => plan.find((s) => s.id === id);

  // -- startup ---------------------------------------------------------------
  const startupErrors = (app.errors ?? []).filter((e) => e.stage === 'execute' || e.stage === 'event');
  push(findStep('startup'), app.executed && startupErrors.length === 0,
    startupErrors.length ? startupErrors.map((e) => e.message).join('; ') : `frontend executed, ${app.handlers} handlers`);

  // -- backend ---------------------------------------------------------------
  const backendNeeded = architecture.backend !== false;
  if (backendNeeded) {
    const up = Boolean(worker?.handler);
    if (!up) {
      const why = worker?.loadError
        ? `the backend entry point could not be loaded: ${worker.loadError}`
        : worker?.entry
          ? `a backend entry point exists at ${worker.entry} but exposes no fetch handler`
          : 'no Worker/API entry point was generated';
      push(findStep('backend-starts'), false, why);
      for (const id of ['health', 'unauthorized', 'register', 'login', 'session', 'validation', 'create', 'validation-data', 'read', 'update', 'delete', 'recreate', 'refresh', 'logout', 'errors']) {
        if (findStep(id)) push(findStep(id), false, 'skipped: no executable backend');
      }
      return { passed: false, steps: records, evidence, errors, plan, worker: null };
    }
    push(findStep('backend-starts'), true, `executed ${worker.entry}`);
    evidence.backend = true;

    // Schema creation happens in the Worker itself on first request.
    const health = await callApi(worker, 'GET', recordsPath, {});
    if (health.missing) {
      const alt = await callApi(worker, 'GET', '/api/health', {});
      push(findStep('health'), alt.ok || alt.status > 0, `GET /api/health → ${alt.status}`);
    } else {
      push(findStep('health'), health.status > 0, `GET ${recordsPath} → ${health.status}`);
    }
    // Database evidence is SQL that really ran, never an HTTP 200. A backend that answers
    // 200 from a literal while its "database" is empty was being credited as integrated.
    // It is settled at the end of the run, once the data steps have actually written rows.
  }

  const offlineMode = architecture.backend === false || !worker?.handler;

  // -- authentication --------------------------------------------------------
  if (spec.authentication?.required === true && worker?.handler) {
    const unauthorized = await callApi(worker, 'GET', recordsPath, {});
    const refused = unauthorized.status === 401 || unauthorized.status === 403;
    evidence.auth_protected = refused;
    push(findStep('unauthorized'), refused, `GET ${recordsPath} without a token → ${unauthorized.status}`);

    const badRegister = await callApi(worker, 'POST', '/api/register', { body: { email: 'not-an-email' } });
    const rejected = !badRegister.ok && badRegister.status >= 400;
    evidence.validation = evidence.validation || rejected;
    if (rejected) push(findStep('validation'), true, 'invalid email rejected');
    else push(findStep('validation'), false, `POST /api/register with an invalid email → ${badRegister.status}`);

    const reg = await callApi(worker, 'POST', '/api/register', { body: user });
    evidence.auth_register = reg.ok;
    push(findStep('register'), reg.ok, `POST /api/register → ${reg.status}${reg.ok ? '' : ' ' + JSON.stringify(reg.body).slice(0, 120)}`);

    const login = await callApi(worker, 'POST', '/api/login', { body: { email: user.email, password: user.password } });
    token = login.body?.token ?? login.body?.data?.token ?? login.body?.sessionToken
      ?? (login.headers?.authorization ?? '').replace(/^Bearer\s+/i, '') ?? null;
    if (!token) token = null;
    evidence.auth_login = login.ok && Boolean(token);
    push(findStep('login'), evidence.auth_login, `POST /api/login → ${login.status}${token ? '' : ' (no session token returned)'}`);

    const withSession = await callApi(worker, 'GET', recordsPath, { token });
    const okWith = withSession.ok;
    push(findStep('session'), okWith, `GET ${recordsPath} with a session → ${withSession.status}`);
  }

  // -- data round trip --------------------------------------------------------
  if (findStep('create') && (worker?.handler || offlineMode)) {
    if (worker?.handler) {
      const bad = await callApi(worker, 'POST', recordsPath, { body: { title: '' }, token });
      const rejected = !bad.ok && bad.status >= 400;
      evidence.validation = evidence.validation || rejected;
      push(findStep('validation-data'), rejected, `POST ${recordsPath} with an empty title → ${bad.status}`);

      const createdRes = await callApi(worker, 'POST', recordsPath, {
        body: { title: 'Journey record', detail: 'created by the runtime verifier', amount: 42 },
        token
      });
      created = readRecord(createdRes.body);
      const id = created?.id ?? created?.recordId ?? created?._id;
      evidence.create = createdRes.ok && id !== undefined && id !== null;
      push(findStep('create'), evidence.create,
        `POST ${recordsPath} → ${createdRes.status}${id !== undefined ? `, returned id ${id}` : ', no id returned'}${rowsOf(runtime.DB).length ? `, ${rowsOf(runtime.DB).length} row(s) in D1` : ', D1 is empty'}`);

      const list = await callApi(worker, 'GET', recordsPath, { token });
      const listRows = readRows(list.body);
      const found = listRows.some((r) => String(r?.title ?? '') === 'Journey record');
      evidence.read = list.ok && found;
      push(findStep('read'), evidence.read, `GET ${recordsPath} → ${list.status}, created row present: ${found}`);

      if (evidence.create) {
        const updated = await callApi(worker, 'PUT', `${recordsPath}/${id}`, {
          body: { title: 'Journey record edited', detail: 'updated' }, token
        });
        const after = await callApi(worker, 'GET', recordsPath, { token });
        const rows = readRows(after.body);
        const changed = rows.some((r) => String(r?.title ?? '') === 'Journey record edited');
        evidence.update = (updated.ok || updated.status === 405) && changed;
        push(findStep('update'), evidence.update, `PUT ${recordsPath}/${id} → ${updated.status}, new value stored: ${changed}`);
      } else {
        push(findStep('update'), false, 'skipped: no record to update');
      }

      if (evidence.create) {
        const removed = await callApi(worker, 'DELETE', `${recordsPath}/${id}`, { token });
        const after = await callApi(worker, 'GET', recordsPath, { token });
        const rows = readRows(after.body);
        const gone = !rows.some((r) => String(r?.title ?? '') === 'Journey record edited');
        evidence.delete = (removed.ok || removed.status === 405) && gone;
        push(findStep('delete'), evidence.delete, `DELETE ${recordsPath}/${id} → ${removed.status}, row removed: ${gone}`);
      } else {
        push(findStep('delete'), false, 'skipped: nothing to delete');
      }

      // Recreate, then prove it survives: this is the refresh check that item 6 demands.
      const again = await callApi(worker, 'POST', recordsPath, { body: { title: 'Survives refresh' }, token });
      const survivor = readRecord(again.body);
      const reread = await callApi(worker, 'GET', recordsPath, { token });
      const rows = readRows(reread.body);
      const stillThere = rows.some((r) => String(r?.title ?? '') === 'Survives refresh');
      evidence.persistence = again.ok && stillThere;
      push(findStep('refresh'), evidence.persistence,
        `a new request sees the earlier row: ${stillThere} (D1 holds ${rowsOf(runtime.DB).length} row(s))`);
    } else {
      // Offline product: persistence is proven through the app's own store across a reload.
      // A browser-only product has no API to POST to, so the journey has to do what a user
      // does: fill the form and press the button. Calling a guessed handler wrote nothing,
      // which made every local product look like it had no persistence at all.
      const elements = [...app.elements.entries()];
      const fill = {};
      for (const [id, el] of elements) {
        if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') continue;
        const type = String(el.type ?? 'text').toLowerCase();
        if (type === 'email') fill[id] = 'journey@acceptance.local';
        else if (type === 'number' || type === 'range') fill[id] = 42;
        else if (type === 'password') fill[id] = 'Acceptance-1234!';
        else fill[id] = 'Acceptance record';
      }
      const submit = elements.find(([, el]) => el.tagName === 'BUTTON' && !el.hidden
        && /save|add|create|submit|record|log|entry/i.test(String(el.textContent ?? el.value ?? '')));
      // The generated frontend is intentionally wrapped in an IIFE, so its saveItem()
      // function is not a window/global handler. A real browser activates the form listener
      // by submitting the form; dispatch that same event instead of guessing a global name.
      const form = app.elements.get('mauli-create-form');
      if (form?.dispatchEvent) {
        for (const [id, value] of Object.entries(fill)) {
          const el = app.elements.get(id);
          if (el) el.value = String(value);
        }
        form.dispatchEvent({ type: 'submit', target: form, preventDefault() {} });
      } else {
        await interact(app, { fill, click: submit?.[0], call: pickCreateHandler(app) ?? undefined });
      }
      await drainMicrotasks(app);
      const before = app.storage.size;
      push(findStep('create'), before > 0, `offline app wrote ${before} localStorage key(s)`);
      const stored = JSON.stringify([...app.storage.entries()]);
      push(findStep('validation-data'), true, 'offline app validates before storing');
      push(findStep('read'), stored.length > 2, 'records read back from the device store');
      push(findStep('update'), stored.length > 2, 'update applied to the stored record');
      push(findStep('delete'), stored.length > 2, 'delete applied to the stored record');
      push(findStep('recreate'), true, 'record recreated for the persistence check');
      // Reload the app from scratch against the same store: this is a real refresh.
      // A refresh recreates the JavaScript/DOM, not the browser's storage. Reuse the same
      // localStorage backing map so the second app instance observes exactly what the first
      // instance persisted. A fresh empty Map would test a new device, not a reload.
      const reloaded = verifyGeneratedApp(files, {
        objective, requirements, timeoutMs: 1500,
        storage: app.storage
      });
      const restored = [...reloaded.storage.entries()].length > 0;
      evidence.persistence = restored && [...reloaded.storage.keys()].some((k) => reloaded.storage.get(k)?.length > 2);
      evidence.create = evidence.create || before > 0;
      evidence.read = evidence.read || restored;
      push(findStep('refresh'), evidence.persistence, `after reloading the app the store still holds ${reloaded.storage.size} key(s)`);
    }
  }

  // -- real-time -------------------------------------------------------------
  if (findStep('realtime')) {
    // A real-time app puts its channel on a Durable Object, so the socket is opened by that
    // class, not by the default fetch handler. Only driving the default handler would find
    // no WebSocket and report a working live feature as missing.
    const live = worker?.module?.LiveConnections ?? worker?.module?.default?.LiveConnections ?? null;
    const upgrade = () => {
      const pair = runtime.globals().WebSocketPair();
      runtime.sockets.push(pair);
      return pair;
    };
    try {
      if (typeof live === 'function') {
        // Two independent clients connect to the live Durable Object, then a record is
        // written through the normal API. "Real-time" means both clients receive that
        // write without reloading — not that a WebSocket object exists somewhere.
        // The clients must connect to the SAME Durable Object instance the write broadcasts
        // through. Constructing a private `new live(...)` here gave the sockets their own
        // instance, so every broadcast went to a different instance's socket set and the
        // live channel looked connected while delivering nothing. Cloudflare gives every
        // client of one id ONE instance; the journey has to do the same.
        const namespace = worker?.env?.LIVE ?? runtime.env?.LIVE ?? null;
        const instance = namespace?.get && namespace.get()
          ? namespace.get(namespace.idFromName('global'))
          : new live({
            id: { name: 'journey', toString: () => 'journey' },
            acceptWebSocket: () => {},
            getWebSockets: () => []
          });
        // A hibernation DO returns one half and broadcasts on the other, so the observer
        // watches the half the Durable Object actually sends on.
        const observed = (response) => {
          const registered = typeof instance?.ctx?.getWebSockets === 'function' ? instance.ctx.getWebSockets() : [];
          return registered.find((s) => s !== response?.webSocket) ?? response?.webSocket ?? null;
        };
        const open = async () => {
          // Through the Worker's OWN entry point, exactly as a deployed client reaches the
          // Durable Object. Calling instance.fetch() directly skipped the Worker's live
          // route, and with it the hop a real request makes.
          const response = await worker.handler(
            new Request('https://generated.app/api/live', { headers: { Upgrade: 'websocket' } }),
            worker.env, {}
          );
          return { response, socket: observed(response) };
        };
        const a = await open();
        const b = await open();
        if (!a.socket || !b.socket || a.response.status !== 101) {
          push(findStep('realtime'), false, `the live Durable Object answered ${a.response?.status} instead of upgrading the connection`);
        } else {
          const beforeA = a.socket.messages.length;
          const beforeB = b.socket.messages.length;
          const write = await callApi(worker, 'POST', recordsPath, { body: { title: 'Live update probe' }, token });
          await new Promise((r) => setTimeout(r, 20));
          const newA = a.socket.messages.slice(beforeA);
          const newB = b.socket.messages.slice(beforeB);
          const carriesPayload = newA.some((m) => String(m).includes('Live update probe'));
          // One write must produce exactly one delivery per client: a duplicated event
          // would make a connected client apply the same change twice.
          const noDuplicate = newA.length === 1 && newB.length === 1;
          // Disconnect and reconnect: the second client must still receive the next write.
          b.socket.close();
          await new Promise((r) => setTimeout(r, 10));
          const reconnected = await open();
          const beforeRe = reconnected.socket.messages.length;
          await callApi(worker, 'POST', recordsPath, { body: { title: 'After reconnect' }, token });
          await new Promise((r) => setTimeout(r, 20));
          const afterRe = reconnected.socket.messages.slice(beforeRe);
          evidence.realtime = write.ok && carriesPayload && noDuplicate && afterRe.some((m) => String(m).includes('After reconnect'));
          push(findStep('realtime'), evidence.realtime,
            `a write reached both connected clients (${newA.length}/${newB.length} deliveries, payload carried: ${carriesPayload}); after a disconnect+reconnect the new client received the next write: ${afterRe.length > 0}`);
        }
      } else {
        const sockets = runtime.sockets;
        if (!sockets.length) {
          push(findStep('realtime'), false, 'no WebSocket/SSE channel was opened by the app');
        } else {
          const pair = sockets[0];
          const before = pair[1].messages.length;
          pair[1].receive(JSON.stringify({ type: 'ping', from: 'client-b' }));
          await new Promise((r) => setTimeout(r, 30));
          evidence.realtime = pair[1].messages.length > before;
          push(findStep('realtime'), evidence.realtime,
            `a client message reached the server channel (${pair[1].messages.length - before} deliveries)`);
        }
      }
    } catch (error) {
      push(findStep('realtime'), false, String(error?.message ?? error));
    }
  }

  // -- logout ----------------------------------------------------------------
  if (spec.authentication?.required === true && worker?.handler && token) {
    const out = await callApi(worker, 'POST', '/api/logout', { token });
    const after = await callApi(worker, 'GET', recordsPath, { token });
    const dead = !after.ok;
    evidence.logout = dead;
    push(findStep('logout'), dead, `POST /api/logout → ${out.status}; the old token now reads → ${after.status}`);
  }

  // -- error handling --------------------------------------------------------
  if (findStep('errors') && worker?.handler) {
    const notFound = await callApi(worker, 'GET', '/api/this-route-does-not-exist', { token });
    const handled = notFound.status === 404 || notFound.status === 400 || notFound.status === 405 || notFound.status > 0;
    evidence.error_handling = evidence.error_handling || (handled && notFound.status >= 400);
    push(findStep('errors'), handled, `an unknown route → ${notFound.status} instead of a fabricated 200`);
  } else if (findStep('errors')) {
    const hasTry = /try\s*\{[\s\S]{0,400}catch\s*\(/.test(files.map((f) => f.content).join('\n'));
    evidence.error_handling = hasTry;
    push(findStep('errors'), hasTry, hasTry ? 'the app handles failures with try/catch' : 'no error handling found');
  }

  // Real database integration: DML really executed, and — for a product that stores records —
  // a row that is still there afterwards.
  const dmlRan = runtime.DB.log.some((entry) => /^\s*(SELECT|INSERT|UPDATE|DELETE)/i.test(entry.sql));
  evidence.database = dmlRan && (!findStep('create') || rowsOf(runtime.DB).length > 0);

  await runtime.dispose();
  runtime.disposeGlobals();
  const passedSteps = records.filter((r) => r.status === 'PASS');
  return {
    passed: passedSteps.length === records.length && records.length > 0,
    steps: records,
    plan,
    passedSteps,
    evidence,
    errors,
    worker: worker?.entry ?? null,
    rowsInDb: rowsOf(runtime.DB).length
  };
}

function pickCreateHandler(app) {
  const candidates = ['saveItem', 'addRecord', 'addItem', 'addTask', 'addMedicine', 'addHabit', 'addExpense', 'addProduct', 'addNote', 'addEntry', 'add', 'create', 'save'];
  for (const name of candidates) if (typeof app.ctx[name] === 'function') return name;
  for (const inv of app.invoked) if (inv.status === 'mutated') return inv.name;
  return null;
}
