// Regression coverage for the final audit finding that the dashboard could not tell
// which projects actually shipped code, and that the Overview/Monitor numbers were read
// from the capped /api/state lists:
//   - /api/state ships only the newest 100 of 429 artifacts, so the client's
//     `S.artifacts.some(type === 'code-workspace')` gate hid the download, preview and
//     build buttons for finished projects whose artifact sat outside that window
//     (the reported project returned `code-workspace in st`, 0 for this project);
//   - the capped lists made the Monitor grid read "300 tasks / 100 artifacts" while the
//     header said 738/429.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../src/index.js';
import { store } from '../src/store.js';

const env = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };

test('/api/state marks which projects have code and reports true totals', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const withCode = `p-code-${suffix}`;
  const withoutCode = `p-plain-${suffix}`;

  store.hydrated = true;
  store.put('projects', { id: withCode, name: 'Builds code', state: 'completed' });
  store.put('projects', { id: withoutCode, name: 'Research only', state: 'completed' });
  store.put('artifacts', {
    id: `art-code-${suffix}`,
    projectId: withCode,
    type: 'code-workspace',
    content: { files: [{ path: 'index.js', content: 'console.log(1)' }] },
  });

  const res = await worker.fetch(new Request('https://mauli.test/api/state'), env);
  assert.equal(res.status, 200);
  const data = (await res.json()).data;

  const coded = data.projects.find(p => p.id === withCode);
  const plain = data.projects.find(p => p.id === withoutCode);
  assert.ok(coded, 'the project with a code-workspace artifact must be in the payload');
  assert.ok(plain, 'the project without one must be in the payload');
  assert.equal(coded.hasCode, true, 'a project that shipped code must say so');
  assert.equal(plain.hasCode, false, 'a project with no code must say so');

  const totals = data.summary && data.summary.totals;
  assert.ok(totals, 'summary.totals must always be present so counters are not capped');
  assert.ok(totals.artifacts >= data.artifacts.length, 'totals must be at least the shipped list');
  assert.ok(totals.tasks >= data.tasks.length, 'task totals must not be below the shipped list');
  assert.ok(totals.projects >= data.projects.length, 'project totals must not be below the shipped list');
});

test('dashboard prefers the server hasCode flag over the capped artifact sample', () => {
  const dash = fs.readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
  const live = fs.readFileSync(new URL('../src/dashboard-live.js', import.meta.url), 'utf8');

  // Projects page (download/preview/build buttons)
  assert.match(dash, /\('hasCode' in p\)\?!!p\.hasCode/);
  // Overview + Monitor must read the server totals, not the capped list length
  assert.match(dash, /\$\('ovArt'\)\)\$\('ovArt'\)\.textContent=totals\.artifacts\?\?S\.artifacts\.length/);
  assert.match(dash, /const tot=\(S\.summary&&S\.summary\.totals\)\|\|\{\}/);
  assert.match(dash, /\{l:'Tasks',v:tot\.tasks\?\?S\.tasks\.length/);
  assert.match(dash, /\{l:'Artifacts',v:tot\.artifacts\?\?S\.artifacts\.length/);
  // Builds page is overridden in the injected layer with the same preference
  assert.match(live, /window\.loadBuilds=function/);
  assert.match(live, /\('hasCode' in p\)\?!!p\.hasCode/);
});
