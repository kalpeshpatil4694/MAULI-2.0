import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHTML } from '../src/dashboard.js';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';

test('dashboard unwraps standard API envelopes', () => {
  const html = dashboardHTML();
  assert.match(html, /j\.data&&typeof j\.data==='object'/);
  assert.match(html, /\{...j\.data,ok:true\}/);
});

test('live lifecycle polling is bounded and serialized', () => {
  assert.match(DASHBOARD_LIVE_SCRIPT, /if\(state\.polling\)return/);
  assert.match(DASHBOARD_LIVE_SCRIPT, /setInterval\(poll,30000\)/);
  assert.doesNotMatch(DASHBOARD_LIVE_SCRIPT, /setInterval\(poll,15000\)/);
});

test('project detail bridge is exposed to dashboard buttons', () => {
  assert.match(DASHBOARD_LIVE_SCRIPT, /window\.__showProjDetail=showProjectDetail/);
  assert.match(dashboardHTML(), /proj-detail/);
});
