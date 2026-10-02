// MAULI 2.0 — THE DEPLOYMENT BOUNDARY.
//
// A generated project that has only ever run inside the harness has not been proven. This
// serves the generated Worker over a REAL `node:http` server — real sockets, real HTTP
// status lines, real WebSocket upgrades — so the production runtime acceptance drives it
// exactly the way a founder's browser drives a deployed endpoint: over the network.
//
// It is deliberately NOT a mock and NOT a second test system. It has no D1 shim of its own
// (the app writes through its own `env.DB`, which the runtime provides), no canned
// responses and no fabricated status codes. Everything it answers came out of the generated
// code itself. The one thing it adds over Cloudflare is a real network between the acceptance
// run and the product, which is the property the acceptance contract is actually about.
//
// The WebSocket upgrade is implemented because a real-time requirement cannot be proven any
// other way: a Durable Object hands back a socket, and two independent clients must both
// receive a write made over HTTP.

import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createRuntime, loadWorker } from './generated-runtime.mjs';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** The `Sec-WebSocket-Accept` value the RFC requires for the 101 handshake. */
function acceptKey(key) {
  return createHash('sha1').update(String(key ?? '') + WS_GUID).digest('base64');
}

/** One server→client text frame (FIN + opcode 0x1), unfragmented. */
function textFrame(text) {
  const payload = Buffer.from(String(text), 'utf8');
  let header;
  if (payload.length < 126) { header = Buffer.alloc(2); header[1] = payload.length; }
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  header[0] = 0x81;
  return Buffer.concat([header, payload]);
}

/**
 * Serve a generated project's files over real HTTP.
 *
 * @returns {Promise<{url:string, port:number, close:()=>void, runtime:object, handler:Function}>}
 */
export async function startDeploymentHarness(files, { env = {}, host = '127.0.0.1' } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const runtime = createRuntime({ env, files: list });
  const loaded = await loadWorker(list, runtime);
  if (!loaded?.handler) {
    runtime.disposeGlobals?.();
    throw new Error('the generated project exposes no Worker fetch handler, so it cannot be deployed');
  }
  const handler = loaded.handler;
  const workerEnv = loaded.env ?? runtime.env;

  const toRequest = (req, body) => new Request(`http://${req.headers.host ?? host}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
    body: body && body.length ? body : undefined
  });

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const response = await handler(toRequest(req, Buffer.concat(chunks)), workerEnv, {});
        res.statusCode = response.status;
        response.headers?.forEach?.((v, k) => res.setHeader(k, v));
        // No keep-alive: the acceptance run issues many short requests and a pooled socket
        // left half-read when the harness closes makes undici throw on process exit.
        res.setHeader('Connection', 'close');
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Connection', 'close');
        res.end(String(error?.message ?? error));
      }
    });
  });

  // A real WebSocket upgrade. The generated Durable Object returns a socket; this completes
  // the handshake on a real TCP connection and forwards everything it sends as real frames.
  server.on('upgrade', async (req, socket) => {
    socket.on('error', () => {});
    try {
      const response = await handler(toRequest(req, null), workerEnv, {});
      const shim = response?.status === 101 ? response.webSocket : null;
      if (!shim) {
        socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n');
        return;
      }
      // Which half does the generated Worker hand back? A Durable Object that uses the
      // hibernation API registers the SERVER half with ctx.acceptWebSocket() and returns the
      // CLIENT half to the runtime, so every broadcast is sent on `server` — while a plain
      // implementation registers and returns the same half. Forwarding whichever half the
      // DO actually broadcasts on is what keeps a real two-client proof honest.
      const registered = workerEnv?.LIVE?.__sockets;
      const candidates = registered ? [...registered] : [];
      const outbound = candidates.find((s) => s !== shim) ?? shim;
      // Exactly one blank line terminates the handshake. A second one is read by the client
      // as a stray frame and closes the socket with "invalid opcode".
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key'])}`,
        '', ''
      ].join('\r\n'));
      const originalSend = outbound.send.bind(outbound);
      outbound.send = (data) => {
        try { socket.write(textFrame(typeof data === 'string' ? data : String(data))); } catch (_) { /* the client went away */ }
        return originalSend(data);
      };
      // The generated channel is server→client, so the only client frame that matters is
      // the close handshake. Answering it keeps undici's parser from being left waiting on a
      // socket the server has already gone away from — which used to surface as an
      // undici parser timer throwing AFTER the acceptance summary printed, and failed CI.
      socket.on('data', (chunk) => {
        try {
          const opcode = chunk[0] & 0x0f;
          if (opcode === 0x8) {
            socket.write(Buffer.from([0x88, 0x00]));
            socket.end();
          }
        } catch (_) { /* the client is already gone */ }
      });
    } catch (error) {
      try { socket.destroy(); } catch (_) { /* already gone */ }
      void error;
    }
  });

  await new Promise((resolve) => server.listen(0, host, resolve));
  server.unref();
  const port = server.address().port;
  return {
    url: `http://${host}:${port}`,
    port,
    runtime,
    handler,
    id: `dep_${randomUUID().slice(0, 8)}`,
    close() {
      try { server.closeAllConnections?.(); server.close(); } catch (_) { /* already closed */ }
      runtime.disposeGlobals?.();
    }
  };
}

export default startDeploymentHarness;
