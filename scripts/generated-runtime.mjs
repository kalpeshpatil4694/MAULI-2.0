// MAULI 2.0 — a minimal but REAL Cloudflare Workers runtime for generated backends.
//
// Spec item 11 is blunt about this: if a generated app has a backend, execute it. Reading
// `server.js` and finding the word "database" is not verification — it is a text search
// that a wrong implementation passes.
//
// This module is the runtime the generated Worker is executed against:
//   * `env.DB` — an in-memory D1 that parses the SQL subset D1 actually accepts for
//     table setup and CRUD, so `prepare().bind().run()/all()/first()` really inserts,
//     really queries and really returns rows. A wrong WHERE clause returns nothing.
//   * `env.API_KEY` and friends — the configured environment, so credential validation
//     has something real to check.
//   * `crypto.subtle` — real PBKDF2/SHA-256, so a password hash is a hash.
//   * `WebSocketPair` — a real pair of connected sockets, so broadcast/reconnect/
//     duplicate-event behaviour can be observed rather than assumed.
//   * `fetch` inside the generated frontend is routed INTO this backend, which is how
//     "the frontend and the backend are connected" stops being an assumption.
//
// It is deliberately small. It supports the SQL a generated app needs; anything outside
// that throws with the statement, which is the honest outcome for an unsupported call.

import { webcrypto } from 'node:crypto';
import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'node:timers';

// Captured before the runtime ever installs its own globals. Otherwise the shim's setTimeout
// resolves globalThis.setTimeout — which is the shim — and calls itself forever.
const NATIVE = { setTimeout: nodeSetTimeout, clearTimeout: nodeClearTimeout };

// ---------------------------------------------------------------------------
// In-memory D1
// ---------------------------------------------------------------------------

const TYPES = { TEXT: 'TEXT', INTEGER: 'INTEGER', REAL: 'REAL' };

// A SQL identifier may be bare (`order` — which is a keyword and therefore invalid) or
// quoted (`"order"` — which is what real D1 requires and what the generator now emits). The
// shim must read both, because a harness that cannot parse the SQL the product actually
// issues reports a working product as broken. `table()` strips the quotes when it stores.
// The alternation is CAPTURING: callers read the name as match(...)[1].
const IDENT = '("[^"]+"|`[^`]+`|[A-Za-z_]\\w*)';

class D1Result {
  constructor(rows = [], meta = {}) {
    this.results = rows;
    this.success = true;
    this.meta = { changes: meta.changes ?? rows.length, last_row_id: meta.lastRowId ?? 0, duration: 0.1, rows_read: rows.length, rows_written: meta.changes ?? 0 };
  }
}

class D1Statement {
  constructor(db, sql) { this.db = db; this.sql = String(sql); this.values = []; }
  bind(...values) { this.values = values.flat(Infinity); return this; }
  async run() { return this.db.execute(this.sql, this.values, 'run'); }
  async all() { return this.db.execute(this.sql, this.values, 'all'); }
  // D1's `.first()` resolves to the row itself (or null) — NOT to a result envelope.
  // Returning the envelope made every `if (existing)` truthy, so a duplicate check
  // answered "already registered" for a brand new address and a user lookup produced
  // undefined fields. That is a false verdict about the product, produced by the harness.
  async first() { const r = await this.db.execute(this.sql, this.values, 'first'); return r.results?.[0] ?? null; }
  async raw() { return (await this.all()).results; }
}

class InMemoryD1 {
  constructor() { this.tables = new Map(); this.writes = 0; this.log = []; }
  prepare(sql) { return new D1Statement(this, sql); }

  table(name) {
    const key = String(name ?? '').replace(/["'`\[\]]/g, '').toLowerCase();
    // A statement whose table name this shim could not read is a harness gap, not an empty
    // table. Silently creating a table keyed '' let an unreadable statement look like a
    // working one that had simply found no rows.
    if (!key) throw new Error(`the shim could not read the table name from: ${String(name ?? '(none)')}`);
    if (!this.tables.has(key)) this.tables.set(key, { name: key, columns: [], rows: [] });
    return this.tables.get(key);
  }

  async execute(sql, values, mode) {
    const statement = String(sql).trim().replace(/;+\s*$/, '');
    this.log.push({ sql: statement, values });
    const upper = statement.toUpperCase();

    if (/^CREATE\s+TABLE/i.test(upper)) {
      const name = (statement.match(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'i')) ?? [])[1];
      const body = statement.slice(statement.indexOf('('));
      const columns = [...body.matchAll(/([A-Za-z_][\w]*)\s+(TEXT|INTEGER|REAL)/gi)].map((m) => ({ name: m[1].toLowerCase(), type: m[2].toUpperCase() }));
      const t = this.table(name);
      t.columns = columns.length ? columns : t.columns;
      return new D1Result([], { changes: 0 });
    }
    if (/^DROP\s+TABLE/i.test(upper)) {
      const name = (statement.match(new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i')) ?? [])[1];
      this.tables.delete(String(name).toLowerCase());
      return new D1Result([], { changes: 0 });
    }
    if (/^INSERT/i.test(upper)) {
      const name = (statement.match(new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${IDENT}`, 'i')) ?? [])[1];
      const t = this.table(name);
      const cols = [...(statement.match(/\(([^)]*)\)/i)?.[1] ?? '').split(',')].map((c) => c.trim().replace(/["'`]/g, '')).filter(Boolean);
      const explicit = cols.length > 0;
      const names = explicit ? cols.map((c) => c.toLowerCase()) : t.columns.map((c) => c.name);
      const row = {};
      names.forEach((n, i) => { row[n] = values[i] ?? null; });
      row.id = row.id ?? t.rows.length + 1;
      t.rows.push(row);
      this.writes++;
      return new D1Result([], { changes: 1, lastRowId: Number(row.id) || t.rows.length });
    }
    if (/^SELECT/i.test(upper)) {
      const name = (statement.match(new RegExp(`FROM\\s+${IDENT}`, 'i')) ?? [])[1];
      const t = this.table(name);
      let rows = t.rows.slice();
      const where = this.parseWhere(statement, values);
      if (where) rows = rows.filter(where);
      const projected = this.project(statement, rows, t);
      const limited = /\bLIMIT\s+(\d+)/i.exec(statement);
      const out = limited ? projected.slice(0, Number(limited[1])) : projected;
      return new D1Result(mode === 'first' ? out.slice(0, 1) : out, { changes: 0 });
    }
    if (/^UPDATE/i.test(upper)) {
      const name = (statement.match(new RegExp(`UPDATE\\s+${IDENT}`, 'i')) ?? [])[1];
      const t = this.table(name);
      const setPart = (statement.match(/\bSET\b([\s\S]*?)(?:\bWHERE\b|$)/i) ?? [])[1] ?? '';
      const assignments = [...setPart.matchAll(/([A-Za-z_][\w]*)\s*=\s*(\?|'[^']*'|\d+(?:\.\d+)?)/gi)];
      // Bound values follow the statement's own order: the SET placeholders come first, then
      // the WHERE placeholders. Reading them the other way round wrote the id into the title
      // column and left WHERE comparing against the timestamp, so a working UPDATE reported
      // "new value stored: false" for a 200 it had actually applied.
      const filter = this.parseWhere(statement, values.slice(assignments.length));
      let changes = 0;
      for (const row of t.rows) {
        if (filter && !filter(row)) continue;
        assignments.forEach((m, i) => { row[m[1].toLowerCase()] = this.literal(m[2], values[i]); });
        changes++;
      }
      this.writes += changes;
      return new D1Result([], { changes });
    }
    if (/^DELETE/i.test(upper)) {
      const name = (statement.match(new RegExp(`DELETE\\s+FROM\\s+${IDENT}`, 'i')) ?? [])[1];
      const t = this.table(name);
      const filter = this.parseWhere(statement, values);
      const before = t.rows.length;
      t.rows = filter ? t.rows.filter((r) => !filter(r)) : [];
      const changes = before - t.rows.length;
      this.writes += changes;
      return new D1Result([], { changes });
    }
    throw new Error(`unsupported SQL in generated backend: ${statement.slice(0, 120)}`);
  }

  literal(token, value) {
    const t = String(token).trim();
    if (t === '?') return value ?? null;
    if (t === 'NULL') return null;
    if (/^'/.test(t)) return t.slice(1, -1);
    const n = Number(t);
    return Number.isNaN(n) ? t : n;
  }

  // WHERE a = ? AND b = 'x' AND c IS NULL — the whole condition language generated code
  // uses. Anything richer throws rather than silently matching everything.
  parseWhere(statement, values) {
    const clause = (statement.match(/\bWHERE\b([\s\S]*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/i) ?? [])[1];
    if (!clause || !clause.trim()) return null;
    const terms = [];
    let index = 0;
    for (const part of clause.split(/\s+AND\s+/i)) {
      const m = part.trim().match(/^([A-Za-z_][\w]*)\s*(=|<>|!=|>=|<=|>|<|LIKE|IS\s+NOT|IS)\s*(\?|'[^']*'|\d+(?:\.\d+)?|NULL)$/i);
      if (!m) throw new Error(`unsupported WHERE clause in generated backend: ${part.trim().slice(0, 80)}`);
      const [, column, opRaw, tokenRaw] = m;
      const op = opRaw.toUpperCase().replace(/\s+/g, ' ');
      if (tokenRaw === '?') terms.push({ column: column.toLowerCase(), op, value: values[index++] });
      else terms.push({ column: column.toLowerCase(), op, value: this.literal(tokenRaw, undefined) });
    }
    return (row) => terms.every(({ column, op, value }) => {
      const actual = row[column];
      if (op === 'IS') return (actual ?? null) === null;
      if (op === 'IS NOT') return (actual ?? null) !== null;
      if (op === 'LIKE') return String(actual ?? '').toLowerCase().includes(String(value ?? '').replace(/%/g, '').toLowerCase());
      switch (op) {
        case '=': return String(actual ?? '') === String(value ?? '');
        case '<>': case '!=': return String(actual ?? '') !== String(value ?? '');
        case '>': return Number(actual) > Number(value);
        case '<': return Number(actual) < Number(value);
        case '>=': return Number(actual) >= Number(value);
        case '<=': return Number(actual) <= Number(value);
        default: return false;
      }
    });
  }

  project(statement, rows, table) {
    const cols = (statement.match(/^SELECT\s+([\s\S]*?)\s+FROM/i)?.[1] ?? '*').trim();
    if (cols === '*' || cols === '') return rows.map((r) => ({ ...r }));
    const names = cols.split(',').map((c) => c.trim().replace(/["'`]/g, '').split(/\s+AS\s+/i).pop().toLowerCase()).filter(Boolean);
    return rows.map((r) => {
      const out = {};
      for (const n of names) {
        const source = table.columns.find((c) => c.name === n);
        out[n] = Object.prototype.hasOwnProperty.call(r, n) ? r[n] : (source ? r[source.name] ?? null : null);
      }
      return out;
    });
  }

  snapshot() {
    return [...this.tables.values()].map((t) => ({ table: t.name, rows: t.rows.map((r) => ({ ...r })) }));
  }
}

// ---------------------------------------------------------------------------
// WebSocket pair — two genuinely connected endpoints.
// ---------------------------------------------------------------------------

class ShimSocket {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.closed = false;
    this.accepted = false;
    this._peer = null;
  }
  accept() { this.accepted = true; return this; }
  send(data) {
    if (this.closed) throw new Error('socket closed');
    const text = typeof data === 'string' ? data : String(data);
    this.messages.push(text);
    // A Worker sends to a client, or broadcasts to every other client. Relay to the peer
    // so an observer on the other end can prove the message actually arrived.
    if (this._peer && !this._peer.closed) this._peer.messages.push(text);
    return 0;
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    this.closed = true;
    this.closeInfo = { code, reason };
    // The runtime notifies the Durable Object that owns this socket, so a hibernation DO can
    // drop it from its own broadcast set. Without this a closed client stays registered and
    // a later broadcast is written into a dead socket.
    for (const fn of this._handlers?.close ?? []) {
      try { fn({ type: 'close', code, reason }); } catch (_) { /* a closing handler cannot fail the close */ }
    }
  }
  // Handlers ACCUMULATE. Storing one handler per type silently discarded every listener but
  // the last: a Durable Object that registers both a message and a close handler kept only
  // the close one, so a disconnected client was never removed from the broadcast set and a
  // reconnected client then received nothing. The DOM's own semantics here are a list.
  addEventListener(type, fn) { ((this._handlers ||= {})[type] ||= []).push(fn); }
  removeEventListener() {}
  // Used by the verifier to push a message FROM the client INTO the server handler.
  receive(text) { for (const fn of this._handlers?.message ?? []) fn({ data: text }); }
}

function WebSocketPair() {
  const server = new ShimSocket('server');
  const client = new ShimSocket('client');
  server._peer = client; client._peer = server;
  server[0] = server; server[1] = client;
  return server;
}

// Workers answer a WebSocket upgrade with 101, which the WHATWG Response constructor
// forbids ("must be in the range of 200 to 599"). Constructing the handshake this way kept
// the shim faithful without rewriting the generated app to avoid a legitimate Worker API.
class ShimResponse extends Response {
  constructor(body, init = {}) {
    const status = Number(init.status ?? 200);
    super(body, { ...init, status: status === 101 ? 200 : status });
    if (status === 101) Object.defineProperty(this, 'status', { value: 101, configurable: true });
    if (init.webSocket) this.webSocket = init.webSocket;
  }
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

/**
 * The client-side WebSocket a generated FRONTEND constructs.
 *
 * Without this shim the frontend's `new WebSocket(...)` fell through to Node's built-in
 * client, which opened a real connection to a host that does not exist, sat there until its
 * close-handshake timer fired and then threw — AFTER the acceptance run had printed its
 * verdict, failing CI for a run that passed. A frontend's socket attempt is also evidence:
 * it records that the product tried to open a live channel and where it pointed.
 */
class ShimClientWebSocket {
  constructor(url, protocols) {
    this.url = String(url ?? '');
    this.readyState = 0;
    this.sent = [];
    this._handlers = {};
    this._accepted = false;
    setTimeout(() => {
      this.readyState = 1;
      for (const fn of this._handlers.open ?? []) fn({ type: 'open' });
    }, 0);
  }
  addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); }
  removeEventListener() {}
  send(data) { this.sent.push(String(data)); }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    for (const fn of this._handlers.close ?? []) fn({ type: 'close', code: 1000 });
  }
}

export function createRuntime({ env = {}, fetchImpl = null, files = [] } = {}) {
  const DB = new InMemoryD1();
  const sockets = [];
  const timers = new Set();

  const runtimeEnv = {
    DB,
    ...env,
    // A real credential check needs a credential. Generated code that validates
    // `env.SOMETHING_API_KEY` sees the value the harness was given, and nothing else.
    caches: { default: { match: async () => undefined, put: async () => undefined } },
    AI: env.AI ?? null,
    WebSocketPair: () => { const pair = WebSocketPair(); sockets.push(pair); return pair; }
  };

  // A `fetch` for generated code: an absolute URL goes to the injected network (off by
  // default — nothing in verification is allowed to depend on the internet), and a
  // same-origin relative path is routed into the generated backend itself.
  async function routeFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input));
    if (/^https?:\/\//i.test(url) && fetchImpl) return fetchImpl(input, init);
    return { __unavailable: true, url };
  }

  function globals() {
    return {
      // `console` is deliberately NOT replaced. Installing a silent console on globalThis
      // also silenced the verifier's own output for as long as the runtime was loaded, so
      // a failure inside the harness printed nothing at all and looked like a clean exit.
      // Generated frontend code still runs against a silenced console in the DOM shim.
      setTimeout: (fn, ms = 0) => { const t = NATIVE.setTimeout(fn, ms); timers.add(t); return t; },
      clearTimeout: (t) => { NATIVE.clearTimeout(t); timers.delete(t); },
      setInterval: () => 0,
      clearInterval: () => {},
      crypto: webcrypto,
      Request, Response: ShimResponse, Headers, URL,
      URLSearchParams, TextEncoder, TextDecoder,
      AbortController,
      atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
      btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
      fetch: routeFetch,
      WebSocketPair,
      // A frontend's live-channel attempt is recorded rather than dialled for real.
      WebSocket: function ClientWebSocket(url, protocols) {
        const socket = new ShimClientWebSocket(url, protocols);
        sockets.push(socket);
        return socket;
      },
      console_: undefined
    };
  }

  return {
    DB,
    env: runtimeEnv,
    files,
    sockets,
    globals,
    routeFetch,
    async dispose() { for (const t of timers) clearTimeout(t); timers.clear(); },
    disposeGlobals() { if (this._restore) { this._restore(); this._restore = null; } },
    snapshot: () => DB.snapshot()
  };
}

/**
 * Load a generated backend entry point and return a callable Worker.
 * Accepts the standard Worker shape (`export default { fetch }`) as well as a
 * named `fetch` export or a bare function export.
 */
export async function loadWorker(files, runtime) {
  // Generated code runs LATER, not at import time: a Durable Object class opened by the
  // journey references WebSocketPair minutes after the module was evaluated. Installing the
  // runtime globals only for the import meant the live route threw "WebSocketPair is not
  // defined" — a harness bug reported as a missing real-time feature.
  runtime._restore = installGlobals(runtime);
  const entry = (Array.isArray(files) ? files : [])
    .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
    .sort((a, b) => {
      const rank = (p) => (/^src\/index\.[cm]?js$/.test(p) ? 0 : /(?:^|\/)(?:worker|api|server|index)\.[cm]?js$/.test(p) ? 1 : 5);
      return rank(a.path) - rank(b.path);
    })[0];
  if (!entry) return null;

  // A Worker module is ESM. Transpile nothing; import it as a module with the runtime's
  // globals installed on globalThis for the duration of the call, which is exactly how a
  // Worker sees them.
  //
  // `cloudflare:workers` is a Worker-runtime module, not a real URL scheme, so a `data:`
  // module cannot import it (ERR_UNSUPPORTED_ESM_URL_SCHEME). A generated Durable Object
  // extends DurableObject from that module, so the import is rewritten to a local definition
  // of the same base class. Rewriting the SPECIFIER and nothing else keeps the generated
  // source byte-for-byte what ships.
  const source = entry.content.replace(
    /(['"])cloudflare:workers\1/g,
    `'cloudflare:workers:shim'`
  );
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(withRuntimeModule(source), 'utf8').toString('base64')}#${encodeURIComponent(entry.path)}`);
    attachDurableObjectBindings(mod, runtime);
    const handler = typeof mod.default === 'function' ? mod.default
      : typeof mod.default?.fetch === 'function' ? mod.default.fetch.bind(mod.default)
        : typeof mod.fetch === 'function' ? mod.fetch
          : null;
    if (!handler) return { entry: entry.path, handler: null, module: mod };
    return { entry: entry.path, handler, module: mod };
  } finally {
    // The module is loaded; the globals stay installed for the duration of the run and are
    // released by runtime.disposeGlobals().
  }
}

/**
 * Give the loaded module the Durable Object namespaces its own wrangler config declares.
 *
 * A generated Worker's live channel is routed through `env.LIVE.fetch(...)`, exactly as it
 * is on Cloudflare. Without a namespace here, the module's own entry point answered
 * /api/live with 501 while the feature was reported as working — so the shim reads the
 * binding table out of the generated wrangler config and puts a real namespace in front of
 * the exported class. Every client of one binding shares ONE instance, which is what makes
 * a broadcast from one client reach the others.
 */
function attachDurableObjectBindings(mod, runtime) {
  const files = Array.isArray(runtime?.files) ? runtime.files : [];
  const config = files.find((f) => /wrangler\.(?:jsonc?|toml)/i.test(String(f?.path ?? '')))?.content ?? '';
  const bindings = [];
  const jsonMatch = /"bindings"\s*:\s*\[([\s\S]*?)\]/.exec(config);
  if (jsonMatch) {
    for (const m of jsonMatch[1].matchAll(/"name"\s*:\s*"([^"]+)"[\s\S]*?"class_name"\s*:\s*"([^"]+)"/g)) bindings.push({ name: m[1], className: m[2] });
  } else {
    for (const m of config.matchAll(/\[\s*durable_objects\s*\]\s*binding\s*=\s*"([^"]+)"[\s\S]*?class_name\s*=\s*"([^"]+)"/g)) bindings.push({ name: m[1], className: m[2] });
  }
  for (const binding of bindings) {
    const Cls = mod?.[binding.className];
    if (typeof Cls !== 'function') continue;
    const doSockets = new Set();
    const doCtx = {
      id: { name: binding.name, toString: () => binding.name },
      acceptWebSocket(socket) {
        doSockets.add(socket);
        // A hibernation Durable Object is told when one of its sockets goes away, and drops
        // it from the set. Nothing called the DO's own webSocketClose handler, so a closed
        // client stayed registered and every later broadcast was written into a dead socket
        // — which reads to the founder as "reconnecting stopped working".
        socket.addEventListener?.('close', () => {
          doSockets.delete(socket);
          const handler = instance?.webSocketClose;
          if (typeof handler === 'function') {
            try { handler.call(instance, socket); } catch (_) { /* a closing socket cannot fail the close */ }
          }
        });
      },
      getWebSockets() { return [...doSockets].filter((s) => s && !s.closed); }
    };
    const instance = new Cls(doCtx);
    instance.env = runtime.env;
    // Cloudflare's Durable Object namespace exposes BOTH the stub API (`get`) and the direct
    // `fetch`. Generated code calls `env.<BINDING>.fetch(...)`, so a shim that only answers
    // `get` makes the live route answer 501 while the feature still looks present in source.
    runtime.env[binding.name] = {
      idFromName: () => ({ name: binding.name }),
      get: () => instance,
      fetch: (request, env) => instance.fetch(request, env ?? runtime.env),
      // The sockets the Durable Object registered through ctx.acceptWebSocket(). A
      // hibernation-style DO broadcasts on these, which is NOT necessarily the half it
      // returns to the runtime, so the HTTP harness needs to see them to forward the right
      // one over the socket. It is a Set, not an Array — a consumer that checks it with
      // Array.isArray silently gets an empty list and forwards the half nobody broadcasts
      // on, which looks exactly like a product whose live channel never connects.
      __sockets: doSockets
    };
  }
  return bindings.length;
}

/**
 * The local stand-in for `cloudflare:workers`, inlined into the module before it is imported.
 *
 * It carries only what a generated Durable Object needs — the base class its `extends`
 * clause names. The constructor stores the context and state, which is all `LiveConnections`
 * touches; everything real (WebSocketPair, crypto, fetch) already comes from the globals the
 * runtime installs, exactly as on Cloudflare.
 */
const RUNTIME_MODULE_SHIM = `const DurableObject = class DurableObject {
  constructor(ctx, state) { this.ctx = ctx; this.state = state; }
};
export { DurableObject };
`;

function withRuntimeModule(source) {
  if (!source.includes('cloudflare:workers:shim')) return source;
  // The replacement is a JS string literal, so it must be quoted and escaped — substituting
  // a bare `data:...` URL produced "Unexpected identifier 'data'".
  const literal = JSON.stringify('data:text/javascript;base64,' + Buffer.from(RUNTIME_MODULE_SHIM, 'utf8').toString('base64'));
  return source.replace(/(['"])cloudflare:workers:shim\1/g, literal);
}

/** Install the runtime's Worker globals on globalThis; returns a restore function. */
export function installGlobals(runtime) {
  const saved = [];
  for (const [k, v] of Object.entries(runtime.globals())) {
    if (v === undefined) continue;
    saved.push([k, Object.getOwnPropertyDescriptor(globalThis, k)]);
    // `crypto` is a getter-only property on globalThis in Node: a plain assignment throws
    // and takes the whole verification down. defineProperty replaces it correctly.
    Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true, enumerable: false });
  }
  return function restoreGlobals() {
    for (const [k, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else delete globalThis[k];
    }
  };
}

export { InMemoryD1, WebSocketPair, ShimSocket, ShimClientWebSocket, ShimResponse, TYPES };
