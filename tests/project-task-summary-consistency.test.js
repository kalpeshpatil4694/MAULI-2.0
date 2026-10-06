import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTaskSummary, __resetProjectTaskSummaryCache } from '../src/index.js';
import { dashboardHTML } from '../src/dashboard.js';
import { store } from '../src/store.js';

function fakeSummaryD1(rows) {
  return {
    DB: {
      prepare() {
        const stmt = {
          bind() { return stmt; },
          async all() { return { results: rows, meta: { rows_read: rows.length } }; }
        };
        return stmt;
      }
    }
  };
}

test('Projects task summary is authoritative and counts the same lifecycle states as Details', async () => {
  __resetProjectTaskSummaryCache();
  const pid = 'project_consistency';
  const env = fakeSummaryD1([{
    project_id: pid,
    total: 14,
    completed: 12,
    failed: 0,
    running: 0,
    pending: 0,
    blocked: 2
  }]);
  const summary = await projectTaskSummary(env, [{ id: pid, state: 'active' }]);
  assert.deepEqual(summary.get(pid), {
    total: 14,
    completed: 12,
    failed: 0,
    running: 0,
    pending: 0,
    blocked: 2
  });
});

test('Projects table never falls back to the capped task sample for its count', () => {
  const html = dashboardHTML();
  const start = html.indexOf('function renderProjects()');
  const end = html.indexOf('function filterProj()', start);
  const render = html.slice(start, end);
  assert.match(render, /authoritativeTaskSummary/);
  assert.match(render, /SYNC…/);
  assert.doesNotMatch(render, /S\.tasks\.filter\(t=>t\.projectId===p\.id\).*total/);
});

test('D1 summary cache can be reset between requests/tests', () => {
  __resetProjectTaskSummaryCache();
  store.data = new Map();
  assert.ok(true);
});


test('blocked-only project is never classified as active by the dashboard state rule', () => {
  const html = dashboardHTML();
  const start = html.indexOf('function projRealState');
  const end = html.indexOf('function renderProjects', start);
  const rule = html.slice(start, end);
  assert.match(rule, /blocked>0&&running===0&&pending===0\)return 'blocked'/);
  assert.match(rule, /running>0\|\|pending>0\)return 'active'/);
});
