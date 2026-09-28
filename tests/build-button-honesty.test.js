import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';
import { dashboardHTML } from '../src/dashboard.js';

const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const live = DASHBOARD_LIVE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');

test('/api/state says whether a project can actually produce a build', () => {
  // hasCode only means a code-workspace artifact exists. This project has
  // server.js, package.json and README.md and no web app, so a 📱 button on it
  // could only ever come back as an error.
  assert.match(index, /function buildableProjectIds\(artifacts\)/);
  assert.match(index, /f\?\.path === 'www\/index\.html'/);
  assert.match(index, /canBuild: hasCode && buildable\.has\(p && p\.id\)/);
  // Both the cold D1 snapshot and the warm memory path must set it, or the flag
  // would flap depending on which one the dashboard happened to be served.
  assert.equal((index.match(/canBuild: hasCode && buildable\.has\(/g) ?? []).length, 2);
});

test('the Projects table does not offer a build button it knows will fail', () => {
  const renderProjects = /function renderProjects\(\)\{[\s\S]*?\n\}/.exec(dashboardHTML())?.[0] ?? '';
  assert.ok(renderProjects, 'renderProjects must exist');
  assert.match(renderProjects, /const canBuild=\('canBuild' in p\)/);
  assert.match(renderProjects, /if\(hasCode&&canBuild\)/);
  assert.match(renderProjects, /⚠️ web app नाही/);
});

test('the Builds page replaces an impossible APK button with the reason', () => {
  const loadBuilds = /window\.loadBuilds=function\(\)\{[\s\S]*?\n  \};/.exec(live)?.[0] ?? '';
  assert.ok(loadBuilds, 'the loadBuilds override must be present');
  assert.match(loadBuilds, /if\(hasCode&&canBuild\)/);
  assert.match(loadBuilds, /APK नाही — web app नाही/);
});

test('a failed build explains itself instead of dumping the API envelope', () => {
  // Tapping 📱 used to print this straight into the toast, on top of the header:
  //   {"ok":false,"error":{"message":"...","details":{"files":[...]}}}
  assert.match(live, /window\.startBuild=async function/);
  assert.match(live, /function buildErrorText\(err\)/);
  const text = /function buildErrorText\(err\)\{[\s\S]*?\n  \}/.exec(live)?.[0] ?? '';
  assert.ok(text, 'buildErrorText must exist');
  assert.match(text, /JSON\.parse\(raw\)/, 'it must read the structured error, not guess');
  assert.ok(text.includes("/www\\/index\\.html/i"), 'the www/index.html case must be named');
  // The live script carries regex literals, so these appear escaped.
  assert.ok(text.includes("/no package\\.json/i"), 'the missing package.json case must be named');
  assert.match(text, /No code artifact/i);
  assert.match(text, /Founder key/i);
  // The raw envelope must never be what the founder reads.
  assert.doesNotMatch(text, /toast\(raw/);
});

test('startBuild override restores the button label and reports the outcome', () => {
  const startBuild = /window\.startBuild=async function[\s\S]*?\n  \};/.exec(live)?.[0] ?? '';
  assert.ok(startBuild, 'the startBuild override must be present');
  assert.match(startBuild, /\/api\/build-app/);
  assert.match(startBuild, /\/api\/build-status\//);
  assert.match(startBuild, /btn\.textContent=label/, 'a failure must put the button back');
  assert.match(startBuild, /btn\.disabled=false/);
  assert.match(startBuild, /toast\(buildErrorText\(e\),'err'\)/);
});
