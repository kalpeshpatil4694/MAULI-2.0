// An independent end-to-end check of the live channel, deliberately NOT part of the test
// suite: it drives a raw RFC 6455 client over a real TCP socket against a real deployment
// harness, so nothing here can be satisfied by an in-process shortcut.
//
// Confirms, in order: the upgrade, the server-side confirmation, the broadcast reaching BOTH
// connected clients exactly once, a disconnected client being dropped from the broadcast set,
// and a reconnected client receiving the next write.
import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { startDeploymentHarness } from './deployment-harness.mjs';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const COMMAND = 'Build a shop order app for a coffee shop with staff login and live order updates';

function connect(url, sink) {
  return new Promise((resolve, reject) => {
    const target = new URL(url.replace(/^ws/i, 'http'));
    const key = randomBytes(16).toString('base64');
    const socket = net.connect(Number(target.port), target.hostname);
    let buffered = Buffer.alloc(0);
    let upgraded = false;
    const expect = createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.on('error', () => reject(new Error('socket error')));
    socket.on('connect', () => {
      socket.write([
        `GET ${target.pathname} HTTP/1.1`, `Host: ${target.host}`,
        'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!upgraded) {
        const end = buffered.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buffered.subarray(0, end).toString('utf8');
        buffered = buffered.subarray(end + 4);
        if (!/^HTTP\/1\.1 101/.test(head) || !head.includes(expect)) {
          reject(new Error(`no upgrade: ${head.split('\r\n')[0]}`));
          return;
        }
        upgraded = true;
        resolve({
          close() {
            const mask = randomBytes(4);
            try { socket.write(Buffer.concat([Buffer.from([0x88, 0x80]), mask])); socket.end(); } catch (_) { /* gone */ }
          }
        });
      }
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 0x0f;
        let length = buffered[1] & 0x7f;
        let offset = 2;
        if (length === 126) { if (buffered.length < 4) break; length = buffered.readUInt16BE(2); offset = 4; }
        else if (length === 127) { if (buffered.length < 10) break; length = Number(buffered.readBigUInt64BE(2)); offset = 10; }
        if (buffered.length < offset + length) break;
        const payload = buffered.subarray(offset, offset + length).toString('utf8');
        buffered = buffered.subarray(offset + length);
        if (opcode === 0x1 || opcode === 0x2) sink.push(payload);
        if (opcode === 0x8) { try { socket.end(); } catch (_) { /* closed */ } }
      }
    });
  });
}

// Loading the generated Worker installs a `fetch` on globalThis that routes INTO the Worker
// rather than out over the network. This audit has to talk to the real HTTP server, so the
// real one is captured before anything is loaded.
const httpFetch = globalThis.fetch.bind(globalThis);

const spec = extractRequirementSpec({ command: COMMAND, platform: 'web' });
const architecture = selectArchitecture(spec);
const built = generateFullStackApp(spec, architecture, { objective: COMMAND });
const harness = await startDeploymentHarness(built.files, { env: {} });
const http = (path, options = {}) => httpFetch(harness.url + path, {
  ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

try {
  const a = [], b = [];
  const wsUrl = harness.url.replace(/^http/i, 'ws') + '/api/live';
  const socketA = await connect(wsUrl, a);
  const socketB = await connect(wsUrl, b);
  await new Promise((r) => setTimeout(r, 250));
  check('server confirms each accepted socket', a.some((m) => m.includes('"type":"connected"')) && b.some((m) => m.includes('"type":"connected"')),
    `A: ${a.length}, B: ${b.length}`);

  const stub = harness.runtime.env.LIVE.get(harness.runtime.env.LIVE.idFromName('global'));
  check('the Durable Object holds both clients', stub.clients.size === 2, `${stub.clients.size} registered`);

  await http('/api/register', { method: 'POST', body: JSON.stringify({ email: 'audit@local.test', password: 'Audit-1234!' }) });
  const login = JSON.parse(await (await http('/api/login', { method: 'POST', body: JSON.stringify({ email: 'audit@local.test', password: 'Audit-1234!' }) })).text());
  const before = { a: a.length, b: b.length };
  const created = await http('/api/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ title: 'audit probe' })
  });
  check('the write is accepted', created.status === 201, `HTTP ${created.status}`);
  await new Promise((r) => setTimeout(r, 250));
  const gotA = a.slice(before.a).filter((m) => m.includes('audit probe'));
  const gotB = b.slice(before.b).filter((m) => m.includes('audit probe'));
  check('BOTH clients received the write exactly once', gotA.length === 1 && gotB.length === 1, `A: ${gotA.length}, B: ${gotB.length}`);

  socketB.close();
  await new Promise((r) => setTimeout(r, 200));
  check('a disconnected client leaves the broadcast set', stub.clients.size === 1, `${stub.clients.size} still registered`);

  const c = [];
  await connect(wsUrl, c);
  await new Promise((r) => setTimeout(r, 200));
  const beforeC = c.length;
  await http('/api/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ title: 'after reconnect' })
  });
  await new Promise((r) => setTimeout(r, 250));
  check('a reconnected client receives the next write', c.slice(beforeC).some((m) => m.includes('after reconnect')),
    `${c.slice(beforeC).length} message(s)`);
  socketA.close();
} finally {
  harness.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live-channel checks passed.`);
process.exit(failed.length ? 1 : 0);