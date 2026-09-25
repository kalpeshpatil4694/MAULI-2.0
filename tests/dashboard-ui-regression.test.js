import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHTML } from '../src/dashboard.js';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';
import { dedupeAgentList } from '../src/agents.js';

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

test('agent API records are unique by name and retain the richest copy', () => {
  const agents = dedupeAgentList([
    { id: 'agent-empty', name: 'Planning Agent', metadata: {} },
    { id: 'agent-rich', name: 'Planning Agent', metadata: { learning: { planning: { attempts: 4 } }, skillTree: { planning: { level: 8 } } } },
    { id: 'agent-qa', name: 'QA Agent', metadata: {} }
  ]);
  assert.deepEqual(agents.map(agent => agent.id), ['agent-rich', 'agent-qa']);
});

test('agent cards expose the unique id and live state uses dashboard deduplication', () => {
  const html = dashboardHTML();
  assert.match(html, /ID: '\+esc\(a\.id/);
  assert.match(html, /__applyDashboardState=applyDashboardState/);
  assert.match(DASHBOARD_LIVE_SCRIPT, /window\.__applyDashboardState/);
});
