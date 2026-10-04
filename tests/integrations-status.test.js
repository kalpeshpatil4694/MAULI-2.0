import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { readFileSync } from 'node:fs';

const env = { MAULI_TEST_MODE:'true', SKIP_RESULT_PERSISTENCE:'true' };

async function integrations(extra = {}) {
  const response = await worker.fetch(new Request('https://mauli.test/api/integrations'), { ...env, ...extra });
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data;
}

test('integrations status is read from the Worker, not painted into the page', async () => {
  const data = await integrations();
  assert.ok(Array.isArray(data.integrations) && data.integrations.length >= 6);
  for (const row of data.integrations) {
    assert.ok(['connected', 'warning', 'missing'].includes(row.status), `${row.id} has status ${row.status}`);
    assert.ok(row.name && row.icon && row.category, `${row.id} is missing presentation fields`);
    assert.ok(row.detail, `${row.id} has no detail`);
    // A template hole must never reach the page. The catalogs are objects keyed by
    // id/category, so reading `.length` off them once shipped "undefined in catalog".
    for (const field of ['statusLabel', 'detail', 'hint']) {
      assert.ok(!/undefined|NaN|\[object/.test(String(row[field] ?? '')), `${row.id}.${field} renders "${row[field]}"`);
    }
  }
});

test('the catalog rows count real entries', async () => {
  const data = await integrations();
  const mcp = data.integrations.find(r => r.id === 'mcp');
  const apis = data.integrations.find(r => r.id === 'apis');
  for (const row of [mcp, apis]) {
    assert.match(row.statusLabel, /^\d+ in catalog$/);
    assert.notEqual(row.status, 'missing', 'a catalog that ships with entries is not a missing dependency');
  }
});

test('an unset credential is reported as missing, never as Configured', async () => {
  const data = await integrations();
  const github = data.integrations.find(r => r.id === 'github');
  assert.equal(github.status, 'missing');
  assert.equal(github.statusLabel, 'No token');
  assert.match(github.detail, /GITHUB_TOKEN/);
  assert.match(github.hint, /Settings/);
});

test('a configured credential is reported as connected', async () => {
  const data = await integrations({ GITHUB_TOKEN:'ghp_example_not_a_real_secret' });
  const github = data.integrations.find(r => r.id === 'github');
  assert.equal(github.status, 'connected');
  assert.equal(github.statusLabel, 'Configured');
});

test('the D1 row follows the actual binding', async () => {
  const data = await integrations();
  const d1 = data.integrations.find(r => r.id === 'd1');
  assert.equal(d1.status, 'missing');
  assert.match(d1.detail, /No D1 binding/);
});

test('the deploy executor row explains why a project is NOT_DEPLOYED', async () => {
  const data = await integrations();
  const deploy = data.integrations.find(r => r.id === 'deploy');
  assert.equal(deploy.status, 'missing');
  assert.match(deploy.detail, /MAULI_DEPLOY_EXECUTOR/);
  assert.match(deploy.detail, /NOT_DEPLOYED/);
});

test('no credential value is ever returned', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/integrations'), {
    ...env,
    GITHUB_TOKEN:'ghp_super_secret_value',
    MAULI_FOUNDER_KEY:'founder-secret-value',
  });
  const text = await response.text();
  assert.ok(!text.includes('ghp_super_secret_value'));
  assert.ok(!text.includes('founder-secret-value'));
});

test('the counts add up to the number of rows', async () => {
  const data = await integrations();
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, data.integrations.length);
});

test('the founder key row reflects keyless mode instead of claiming it is enforced', async () => {
  const data = await integrations();
  const founder = data.integrations.find(r => r.id === 'founder');
  assert.equal(founder.status, 'warning');
  assert.equal(founder.statusLabel, 'Keyless mode');
});

test('the dashboard Integrations page fetches the endpoint and has no hardcoded rows left', () => {
  const source = readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('function renderIntegrations'), source.indexOf('function renderApprovals'));
  assert.ok(fn.includes("api('/api/integrations')"), 'the page must ask the Worker for status');
  assert.ok(!fn.includes("s:'Configured'"), 'the hardcoded Configured card must be gone');
  assert.ok(!fn.includes("{n:'GitHub'"), 'the hardcoded integration list must be gone');
});

test('the Integrations card offers a refresh', () => {
  const source = readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
  // The card's ↻ now goes through the shared refresh path: it still re-renders Integrations (via
  // renderPage for the current page) but keeps the founder's scroll position. The old handler
  // called renderIntegrations() directly, which collapsed the list and snapped the view to the top.
  assert.match(source, /id="pg-integrations"[\s\S]{0,400}onclick="refreshPage\(\)"/);
  assert.match(source, /integrations:renderIntegrations/);
  assert.match(source, /function refreshPage\(\)\{return renderPage\(curPage,true\)\}/);
});