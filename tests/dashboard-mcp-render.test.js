import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHTML } from '../src/dashboard.js';
import { getAllMCPServers, getMCPCategories } from '../src/mcp-integration.js';
import { getAPICatalog } from '../src/public-apis.js';
import { makeDashboardDom } from '../scripts/dashboard-dom.mjs';

// The API Explorer's MCP card was empty because /api/mcp/servers ships its servers as an OBJECT
// keyed by slug while the loader iterated it as an array. These tests EXECUTE the real loaders in
// a DOM against the real payload, so a source-reading regex is never the only proof.
const MCP_SERVERS = getAllMCPServers();
const MCP_CATEGORIES = getMCPCategories();

const ok = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const read = (v) => (typeof v === 'function' ? v() : v);

/** Build a dashboard DOM whose endpoints answer from `sources` (values or getters). */
function domWith(sources = {}) {
  return makeDashboardDom(dashboardHTML(), {
    fetch: async (path) => {
      if (path === '/api/mcp/servers') return ok(read(sources.mcp) ?? { servers: MCP_SERVERS, categories: MCP_CATEGORIES });
      if (path === '/api/apis/catalog') return ok(read(sources.catalog) ?? { catalog: getAPICatalog() });
      if (path === '/api/integrations') return ok(read(sources.integrations) ?? { integrations: [], counts: {} });
      return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }), text: async () => '{}' };
    }
  });
}

/** Replace an element's innerHTML with a counting accessor so a test can prove nothing wrote. */
function countWrites(el) {
  const desc = Object.getOwnPropertyDescriptor(el, 'innerHTML');
  let writes = 0;
  Object.defineProperty(el, 'innerHTML', {
    configurable: true, enumerable: desc.enumerable,
    get() { return desc.value; },
    set(v) { writes += 1; desc.value = v; }
  });
  return () => writes;
}

test('loadMcp() renders the object map /api/mcp/servers actually returns', async () => {
  const dom = domWith({ mcp: { servers: MCP_SERVERS, categories: MCP_CATEGORIES } });
  await dom.ctx.loadMcp();

  const html = dom.elements.get('mcpOut').innerHTML;
  const count = Object.keys(MCP_SERVERS).length;
  assert.ok(count >= 5, `the registry should not be empty, got ${count}`);
  assert.match(html, new RegExp(count + ' MCP servers'), 'the card states how many servers loaded');
  assert.match(html, /Filesystem MCP/);
  assert.match(html, /GitHub MCP/);
  assert.doesNotMatch(html, /No MCP servers/, 'a populated registry must not read as empty');
  assert.ok(dom.requests.some((r) => r.path === '/api/mcp/servers'), 'the renderer reads the real endpoint');
});

// Negative control: this is the pre-fix expression the loader used, applied to the real payload.
// If the registry were ever changed to an array the control would stop reproducing the bug, so it
// pins the exact shape that made the card empty.
test('an array-only read of the same payload renders nothing (control)', () => {
  assert.equal(MCP_SERVERS.length, undefined, 'the registry is an object, so .length is undefined');
  const howTheLoaderReadItBefore = Array.isArray(MCP_SERVERS) ? MCP_SERVERS : [];
  assert.equal(howTheLoaderReadItBefore.length, 0, 'array-only iteration saw zero servers — the empty card');
});

test('an empty registry says so instead of rendering a blank card', async () => {
  const dom = domWith({ mcp: { servers: {}, categories: {} } });
  await dom.ctx.loadMcp();
  assert.match(dom.elements.get('mcpOut').innerHTML, /No MCP servers/);
});

test('the loader is shape-agnostic: an array payload still renders', async () => {
  const list = Object.values(MCP_SERVERS).slice(0, 3);
  const dom = domWith({ mcp: { servers: list, categories: {} } });
  await dom.ctx.loadMcp();
  const html = dom.elements.get('mcpOut').innerHTML;
  assert.match(html, /3 MCP servers/);
  assert.match(html, new RegExp(list[0].name));
});

// Proves the await that makes a background refresh's scroll restore cover the MCP card: the page
// render promise must not settle until MCP has painted.
test('a page refresh paints MCP before the render promise settles', async () => {
  const dom = domWith({ mcp: { servers: MCP_SERVERS, categories: MCP_CATEGORIES } });
  await dom.ctx.renderPage('apiexp', true);
  const html = dom.elements.get('mcpOut').innerHTML;
  assert.match(html, /MCP server/, 'MCP finished rendering before the page render promise settled');
  assert.doesNotMatch(html, /No MCP servers/);
});

// The blink: the poll re-renders the page every few seconds and each renderer used to rewrite its
// container's innerHTML even when nothing changed, tearing the DOM down and rebuilding it.
test('a repeat refresh with unchanged data performs no DOM writes (no blink)', async () => {
  const dom = domWith({});
  await dom.ctx.renderPage('apiexp', true);          // first paint
  const apiRes = dom.elements.get('apiRes');
  const mcpOut = dom.elements.get('mcpOut');
  assert.ok(apiRes.innerHTML.length > 0 && mcpOut.innerHTML.length > 0, 'first paint rendered something');

  const apiWrites = countWrites(apiRes);
  const mcpWrites = countWrites(mcpOut);
  await dom.ctx.renderPage('apiexp', true);          // background poll, identical data

  assert.equal(apiWrites(), 0, 'an unchanged catalog must not be re-written');
  assert.equal(mcpWrites(), 0, 'an unchanged MCP list must not be re-written');
});

// Control for the test above: the skip must not be so aggressive that real changes stop painting.
test('a refresh with changed data still re-renders (control)', async () => {
  const mutable = { servers: MCP_SERVERS, categories: MCP_CATEGORIES };
  const dom = domWith({ mcp: () => mutable });
  await dom.ctx.loadMcp();
  const mcpOut = dom.elements.get('mcpOut');
  const writes = countWrites(mcpOut);

  mutable.servers = { ...MCP_SERVERS, extra: { name: 'Extra MCP', description: 'a new server', capabilities: [], category: 'core', agents: [] } };
  await dom.ctx.loadMcp();

  assert.ok(writes() > 0, 'a real change must still repaint the card');
  assert.match(mcpOut.innerHTML, /Extra MCP/);
});

test('the Integrations page also skips a no-op refresh', async () => {
  const row = { icon: '💾', name: 'D1 Database', category: 'Persistence', detail: 'bound', status: 'connected', statusLabel: 'Connected', hint: '' };
  const dom = domWith({ integrations: { integrations: [row], counts: { connected: 1, warning: 0, missing: 0 } } });
  await dom.ctx.renderIntegrations();
  const list = dom.elements.get('intList');
  assert.match(list.innerHTML, /D1 Database/);

  const writes = countWrites(list);
  await dom.ctx.renderIntegrations();
  assert.equal(writes(), 0, 'an unchanged integration list must not be re-written');
});
