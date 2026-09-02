import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('dashboard live bridge is injected by the production worker', () => {
  const worker=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  const bridge=fs.readFileSync(new URL('../src/dashboard-live.js',import.meta.url),'utf8');
  assert.match(worker,/DASHBOARD_LIVE_SCRIPT/);
  assert.match(worker,/injectDashboardLive/);
  assert.match(worker,/url\.pathname === '\/' \|\| url\.pathname === '\/dashboard'/);
  assert.match(bridge,/\/api\/state/);
  assert.match(bridge,/\/api\/project-progress\//);
  assert.match(bridge,/setInterval\(poll,3000\)/);
  assert.match(bridge,/Final delivery completed/);
});

test('scheduler does not execute approval-gated projects', () => {
  const scheduler=fs.readFileSync(new URL('../src/scheduler.js',import.meta.url),'utf8');
  assert.match(scheduler,/project\?\.state==='awaiting_approval'/);
  assert.match(scheduler,/if\(project\?\.state==='awaiting_approval'\)continue/);
  assert.match(scheduler,/return\{recovered,results,at:now\}/);
});
