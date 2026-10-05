// The Messaging panel looked empty after a founder pressed Send. The route passed the
// dashboard's short body ({from,to,content}) straight into sendMessage(), which required
// {fromAgentId,toAgentId,body} and threw before storing anything; and even a stored message
// rendered as "— → —" because the renderer read the short names the record never used. These
// tests drive the REAL route and the REAL dashboard script, so "a sent message appears" is
// observed rather than asserted from a source regex.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { seedAgents } from '../src/agents.js';
import { dashboardHTML } from '../src/dashboard.js';
import { makeDashboardDom } from '../scripts/dashboard-dom.mjs';

const testEnv = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };

async function call(method, path, body) {
  const request = new Request('https://mauli.test' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await worker.fetch(request, testEnv);
  const json = await response.json().catch(() => null);
  return { status: response.status, data: json?.data ?? json };
}

test('a message sent with the dashboard field names is stored and read back', async () => {
  const send = await call('POST', '/api/messages/send', {
    from: 'agent-a', to: 'agent-b', content: 'hello from the panel', type: 'info',
  });
  assert.ok([200, 201].includes(send.status), `unexpected status ${send.status}`);
  const message = send.data?.message;
  assert.ok(message, 'the route must return the stored message');
  assert.equal(message.fromAgentId, 'agent-a');
  assert.equal(message.toAgentId, 'agent-b');
  assert.equal(message.body, 'hello from the panel');

  const list = await call('GET', '/api/messages');
  const found = (list.data?.messages ?? []).find((m) => m.id === message.id);
  assert.ok(found, 'the sent message must appear in the feed');
  assert.equal(found.body, 'hello from the panel');
});

test('a broadcast that carries only content is delivered to the agents', async () => {
  seedAgents();
  const res = await call('POST', '/api/messages/broadcast', { content: 'standup now', type: 'alert' });
  assert.ok([200, 201].includes(res.status), `unexpected status ${res.status}`);
  const messages = res.data?.messages ?? [];
  assert.ok(messages.length > 0, 'a broadcast must reach at least one agent');
  assert.equal(messages[0].fromAgentId, 'founder');
  assert.equal(messages[0].body, 'standup now');
});

test('the Messaging panel renders canonical fields, never blank dashes', async () => {
  const dom = makeDashboardDom(dashboardHTML(), {
    fetch: async (path) => {
      if (path === '/api/messages') {
        return {
          ok: true, status: 200,
          json: async () => ({
            ok: true,
            data: {
              messages: [{
                id: 'm1', fromAgentId: 'agent-a', toAgentId: 'agent-b', type: 'info',
                subject: 'Kickoff', body: 'hello from the panel',
                createdAt: '2026-10-05T00:00:00.000Z',
              }],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '{}' };
    },
  });

  await dom.ctx.loadMsgs();
  const html = dom.elements.get('msgList').innerHTML;
  assert.match(html, /agent-a/, 'the sender must be rendered');
  assert.match(html, /agent-b/, 'the recipient must be rendered');
  assert.match(html, /hello from the panel/, 'the message body must be rendered');
  assert.match(html, /Kickoff/, 'the subject must be rendered as detail');
  assert.doesNotMatch(html, /— → —/, 'a stored message must not render as an empty envelope');
});
