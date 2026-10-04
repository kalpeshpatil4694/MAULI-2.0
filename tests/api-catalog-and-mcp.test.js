import test from 'node:test';
import assert from 'node:assert/strict';
import { getAPICatalog, getAPICategories } from '../src/public-apis.js';
import { getAllMCPServers, getMCPCategories } from '../src/mcp-integration.js';
import { dashboardHTML } from '../src/dashboard.js';

// The API Explorer renders this catalog as clickable endpoints, so a retired host or a
// "YOUR_DOMAIN" placeholder is a broken link the founder actually hits — not a cosmetic
// detail. Three were observed dead: api-inference.huggingface.co and chat.lmsys.org no
// longer resolve in DNS, and Auth0's Management API base is per-tenant.
test('every catalog entry points at a real, non-placeholder https endpoint', () => {
  const entries = Object.values(getAPICatalog()).flat();
  assert.ok(entries.length >= 30, `expected the full catalog, got ${entries.length}`);
  const retired = ['api-inference.huggingface.co', 'chat.lmsys.org'];
  for (const api of entries) {
    assert.match(api.url, /^https:\/\//, `${api.name} must use https`);
    assert.doesNotMatch(api.url, /YOUR_DOMAIN|\{\{|<your|example\.com/i, `${api.name} must not ship a placeholder URL`);
    for (const host of retired) assert.ok(!api.url.includes(host), `${api.name} still points at the retired host ${host}`);
  }
});

// Negative control: the check above only matters if it would actually catch a dead URL. This
// pins the exact string that shipped before the fix, so the rule cannot quietly stop working.
test('the dead-link rule rejects the placeholder that shipped before', () => {
  const shippedBefore = 'https://YOUR_DOMAIN.auth0.com/api/v2';
  assert.match(shippedBefore, /YOUR_DOMAIN/i);
  assert.ok(shippedBefore.includes('YOUR_DOMAIN'), 'the placeholder is what the rule looks for');
});

test('the AI fallback recommendation still resolves to a real entry', () => {
  const ai = getAPICatalog().ai ?? [];
  assert.ok(ai.length >= 3, 'the ai group carries the fallback provider');
  assert.match(ai[2].url, /^https:\/\//);
  assert.match(ai[2].url, /groq\.com/);
});

test('categories stay consistent with the catalog after the URL edits', () => {
  const cats = getAPICategories();
  const total = cats.reduce((n, c) => n + c.count, 0);
  assert.equal(total, Object.values(getAPICatalog()).flat().length);
});

// The dashboard read the servers as an array while /api/mcp/servers ships an object keyed by
// slug ([/api/integrations] already wraps it in Object.values for the same reason), so the MCP
// card rendered nothing at all. The loader must accept the object shape.
test('the MCP card renders the object shape the API actually returns', () => {
  const servers = getAllMCPServers();
  assert.equal(typeof servers, 'object');
  assert.ok(!Array.isArray(servers), 'the API ships an object keyed by slug');
  assert.ok(Object.values(servers).length >= 5, 'the registry is not empty');

  const html = dashboardHTML();
  assert.match(
    html,
    /const raw=r\.servers\|\|r;const srv=Array\.isArray\(raw\)\?raw:Object\.values\(raw\|\|\{\}\)\.filter/,
    'the loader must normalise the object map before iterating'
  );
  // The founder asked what MCP is; the card has to say, not just list rows.
  assert.match(html, /MCP = Model Context Protocol/);
  assert.match(html, /apiexp:loadApiExplorer/);
});

test('MCP categories and lookups stay consistent with the object registry', () => {
  const cats = getMCPCategories();
  assert.ok(Object.keys(cats).length >= 3);
  assert.equal(Object.values(cats).flat().length, Object.values(getAllMCPServers()).length);
});
