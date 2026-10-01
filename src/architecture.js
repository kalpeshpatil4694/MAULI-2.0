// MAULI 2.0 — ARCHITECTURE SELECTION.
//
// MAULI used to give every founder the same shape: one HTML page, one script, one style
// sheet, localStorage. A single-user note pad wants exactly that. A booking system with
// three staff roles, an audit log and a doctor reading the same records wants a Worker API
// over D1, real sessions and — if the founder expects two people to see each other's
// changes — a Durable Object pushing over WebSocket or SSE.
//
// The shape is a decision, so it is derived from the extracted specification rather than
// hardcoded. Every layer listed here is a LAYER MAULI OWES THE FOUNDER: the same
// requirements are then checked against what was actually built, so selecting a layer is
// also a delivery obligation.

/**
 * @param {object} spec - output of extractRequirementSpec()
 * @returns {{id:string, layers:Array<{id:string,label:string,rationale:string}>,
 *   backend:boolean, database:'d1'|'local', realtime:boolean, auth:boolean,
 *   native:boolean, externalApis:string[], obligations:Array}}
 */
// Products whose records are the business's, not one person's device.
const OPERATED_PRODUCTS = new Set(['ecommerce', 'crm', 'dashboard', 'booking', 'inventory', 'automation']);

export function selectArchitecture(spec) {
  const layers = [];
  const add = (id, label, rationale) => layers.push({ id, label, rationale });

  const auth = spec?.authentication?.required === true;
  const multiUser = spec?.multiUser === true || (spec?.roles?.length ?? 0) > 0;
  const data = (spec?.dataRequirements?.length ?? 0) > 0;
  const realtime = spec?.realtime?.required === true;
  const external = (spec?.externalServices ?? []).map((s) => s.key);
  const native = ['android', 'ios', 'desktop'].includes(String(spec?.platform ?? '').toLowerCase());
  // Offline is only chosen when the founder asked for it AND nothing needs a server.
  const offline = spec?.offlineRequested === true && !auth && !multiUser && external.length === 0;
  // A server is owed to the founder only when something genuinely needs one. A single user
  // tracking their own medicines on their own phone does not: forcing a Worker + D1 onto it
  // would be its own kind of wrong product. Shared data, accounts, live updates and
  // external services all do.
  const needsBackend = multiUser || auth || realtime || external.length > 0 || native
    // A business's own records belong to the business. A store's catalog and orders, a CRM's
    // leads, a booking system's calendar and an operator's dashboard cannot live inside one
    // person's phone, so they owe the founder a server even when nobody said "login".
    || OPERATED_PRODUCTS.has(String(spec?.productType ?? ''));

  if (native) add('native-shell', 'Native shell', `Target is ${spec.platform}: the app ships in a platform shell, not as a web page.`);
  add('frontend', 'Frontend UI', 'The founder operates the product through a screen with real, bound controls.');

  if (!needsBackend) {
    add('local-store', 'Local store (device)', offline
      ? 'The founder asked for an offline, single-user product: data lives on the device and needs no server.'
      : 'One user owns this data and uses one device, so the records belong on the device and survive a refresh there.');
  } else {
    const why = [];
    if (multiUser) why.push('more than one person uses the data');
    if (auth) why.push('accounts must be protected');
    if (realtime) why.push('changes must reach other clients live');
    if (external.length) why.push('an external service is called');
    if (native) why.push('the native client talks to a server');
    add('worker-api', 'Worker API', `A server is required because ${why.join(', ')}.`);
    add('d1', 'D1 database', data ? 'Records must outlive the device and be shared between users.' : 'Sessions and server state must be persisted.');
  }

  if (auth) add('sessions', 'Session security', 'Login was requested: credentials are verified server-side and a session protects the API.');
  if (realtime) add('durable-object', 'Durable Object + WebSocket/SSE', 'Live updates were requested: a stateful per-room server pushes changes to connected clients.');
  if (external.length) add('external-integration', 'External integration', `The product calls ${external.join(', ')} and must handle timeout, retry and failure honestly.`);
  if (native) add('native-backend', 'Backend integration for the shell', 'The native client talks to the same API rather than working from a local file.');

  const id = offline ? 'offline-local'
    : realtime ? 'realtime-worker'
      : auth || multiUser ? 'multi-user-worker'
        : external.length ? 'external-api-worker'
          : needsBackend ? 'api-worker'
            : data ? 'local-data' : 'static-frontend';

  // Obligations are the checkable promises this architecture makes. The requirement matrix
  // verifies each one, so selecting a layer can never be a way to look thorough while
  // shipping something that does not do it.
  const obligations = [];
  if (needsBackend) {
    obligations.push({ id: 'backend-endpoint', requirement: 'A real HTTP endpoint exists on the backend and is reachable from the frontend', evidence: ['fetch', 'api', 'request', 'response'] });
    obligations.push({ id: 'backend-validation', requirement: 'The backend validates input before touching the database', evidence: ['validate', 'required', 'trim', 'length', 'error'] });
    obligations.push({ id: 'database-write', requirement: 'A record is actually written to the database and read back', evidence: ['insert', 'select', 'prepare', 'query', 'db', 'localstorage', 'setitem'] });
  } else {
    obligations.push({ id: 'local-persistence', requirement: 'Records are persisted locally and restored on load', evidence: ['localstorage', 'setitem', 'getitem'] });
  }
  if (auth) {
    obligations.push({ id: 'auth-register', requirement: 'Registration stores a user and login returns a session', evidence: ['register', 'signup', 'password', 'session', 'token'] });
    obligations.push({ id: 'auth-protected', requirement: 'A protected endpoint refuses a request without a session', evidence: ['401', 'unauthorized', 'session', 'token', 'authorization'] });
  }
  if (realtime) obligations.push({ id: 'realtime-channel', requirement: 'Clients subscribe to a server-pushed channel and receive another client\'s change', evidence: ['websocket', 'eventsource', 'sse', 'broadcast', 'onmessage'] });
  for (const service of spec?.externalServices ?? []) {
    obligations.push({ id: `external-${service.key}`, requirement: `${service.label} is called with a timeout, a bounded retry and a visible failure`, evidence: ['fetch', 'timeout', 'retry', service.key] });
  }
  if (native) obligations.push({ id: 'native-launch', requirement: 'The packaged app launches and reaches the backend API', evidence: ['android', 'manifest', 'capacitor', 'api'] });

  return {
    id,
    label: offline ? 'Offline single-device app'
      : realtime ? 'Real-time multi-user app (Worker + D1 + Durable Object)'
        : auth || multiUser ? 'Multi-user app with accounts (Worker + D1 + sessions)'
          : external.length ? 'App with an external integration (Worker + D1 + external API)'
            : data ? 'Single-user data app (frontend + device store)'
              : 'Single-page frontend app',
    layers,
    backend: needsBackend,
    database: needsBackend ? 'd1' : 'local',
    realtime,
    auth,
    native,
    offline: !needsBackend,
    externalApis: external,
    obligations
  };
}

/**
 * The layers the delivered code must actually contain, as path/pattern evidence.
 * Used by the requirement matrix to tell "we selected a real architecture" from "we
 * wrote the word in a comment".
 */
export function architectureEvidenceNeeds(architecture) {
  if (!architecture) return [];
  const needs = [];
  if (architecture.backend) {
    needs.push({ id: 'worker-route', file: /(?:^|\/)(?:worker|api|server|index)\.[cm]?js$/i, why: 'a Worker/API entry point' });
    needs.push({ id: 'db-binding', file: /env\s*\.\s*DB\b|\.\s*prepare\s*\(|\bD1\b/, why: 'a D1/SQL call' });
  }
  if (architecture.auth) {
    needs.push({ id: 'auth-guard', file: /401|unauthorized|authorization|session/i, why: 'session enforcement' });
  }
  if (architecture.realtime) {
    needs.push({ id: 'realtime-channel', file: /WebSocket|EventSource|webSocket|Accept\s*:\s*text\/event-stream/i, why: 'a server-pushed channel' });
  }
  return needs;
}

export default selectArchitecture;
