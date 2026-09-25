import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { seedAgents } from '../src/agents.js';
import { sendMessage } from '../src/agent-communication.js';

const env = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };

const get = (path) => worker.fetch(new Request('https://mauli.test' + path), env);

test('L1 dashboard Messages tab: GET /api/messages works without an agentId', async () => {
  seedAgents();
  sendMessage({ fromAgentId: 'agent-a', toAgentId: 'agent-b', type: 'info', subject: 'handshake', body: 'ping' });

  const response = await get('/api/messages');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.data.messages), 'messages list is returned for the tab');
  assert.ok(body.data.messages.length >= 1, 'the message just sent is visible in the global feed');

  const perAgent = await get('/api/messages?agentId=agent-a');
  assert.equal(perAgent.status, 200);
});

test('L1 dashboard Learning tab: GET /api/learning/skill-tree works without an agentId', async () => {
  seedAgents();

  const response = await get('/api/learning/skill-tree');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(typeof body.data.skillTree, 'object');
  assert.ok(body.data.skillTree !== null, 'aggregated per-agent skill tree is returned');
  for (const [agentName, skills] of Object.entries(body.data.skillTree)) {
    assert.equal(typeof agentName, 'string');
    assert.equal(typeof skills, 'object');
  }
});

test('L1 dashboard API Explorer receives a populated catalog and search results', async () => {
  const catalogResponse = await get('/api/apis/catalog');
  assert.equal(catalogResponse.status, 200);
  const catalogBody = await catalogResponse.json();
  assert.ok(Array.isArray(catalogBody.data.catalog.weather));
  assert.ok(catalogBody.data.catalog.weather.length >= 1);
  assert.ok(catalogBody.data.categories.length >= 10);

  const searchResponse = await get('/api/apis/search?q=weather');
  assert.equal(searchResponse.status, 200);
  const searchBody = await searchResponse.json();
  assert.ok(searchBody.data.apis.length >= 1);
});

test('L1 dashboard homepage serves static HTML and the worker injects the live bridge', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  const html = await response.text();
  assert.ok(html.includes('<title>MAULI 2.0'), 'dashboard shell renders');

  // HTMLRewriter only exists on the Workers runtime, so assert the production entrypoint
  // wiring here: the live lifecycle bridge is appended to the homepage (and /dashboard).
  const entrySource = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(entrySource, /injectDashboardLive\(response\)/, 'response passes through the live bridge injector');
  assert.match(entrySource, /url\.pathname === "\/" \|\| url\.pathname === "\/dashboard"/, 'homepage is eligible for injection and never blocks on hydration');
});
