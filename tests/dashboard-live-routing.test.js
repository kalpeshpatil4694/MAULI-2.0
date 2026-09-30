import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';
import { dashboardHTML } from '../src/dashboard.js';

const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
const live = DASHBOARD_LIVE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');

test('the tool buttons the founder actually taps are routed to the live layer', () => {
  // dashboard.js delegates clicks in the bubble phase and calls its LOCAL
  // downloadZip()/startBuild(). Those are the original implementations, so every
  // override this layer installs on window was bypassed for the Projects table and
  // the Builds page — the per-file download loop and window.open() kept running.
  assert.match(live, /document\.addEventListener\('click',e=>\{/);
  assert.match(live, /closest\('\.dl-btn,\.bld-btn,\.pv-btn'\)/);
  assert.match(live, /e\.preventDefault\(\);e\.stopPropagation\(\);/);
  // Capture phase, so it runs before the dashboard's own bubble-phase handler.
  assert.match(live, /\},true\);/);
  assert.match(live, /window\.downloadZip\(t\.dataset\.pid\)/);
  assert.match(live, /window\.startBuild\(t\.dataset\.pid,t\.dataset\.plat,t\)/);
  assert.match(live, /window\.__mauliOpenPreview\(t\.dataset\.pid\)/);
});

test('the preview button no longer opens a founder-protected URL in a bare tab', () => {
  assert.match(dashboard, /class="btn btn-a btn-s pv-btn" data-pid="/);
  // window.open('/api/preview-app?...') sent no founder key and answered 401.
  assert.doesNotMatch(dashboard, /window\.open\([^)]*\/api\/preview-app/);
  assert.match(live, /window\.__mauliOpenPreview=async function\(pid\)/);
  assert.match(live, /await fetchAsBlob\('\/api\/preview-app\?projectId='/);
});

test('the preview inlines www/ assets so a blob url still renders the app', () => {
  const preview = /window\.__mauliOpenPreview=async function\(pid\)\{[\s\S]*?\n  \};/.exec(live)?.[0] ?? '';
  assert.ok(preview, 'the preview opener must exist');
  assert.match(preview, /fetchProjectFiles\(pid,false\)/);
  assert.match(preview, /p\.startsWith\('www\/'\)/);
  assert.match(preview, /'<style>'\+f\.content\+'<\/style>'/);
  // Injected into the page inside a <script> tag, so the closing tag must be split.
  assert.ok(preview.includes("'<scr'+'ipt>'"), 'the inline script tag must be split');
  assert.doesNotMatch(preview, /<\/script>/);
  assert.match(preview, /URL\.createObjectURL/);
});

test('/api/build-status survives a cold isolate instead of answering a false 404', () => {
  // The route still read the capped in-memory build list, so polling one build id
  // returned 404/404/200/404 and a finished build never offered its download.
  const route = /url\.pathname\.startsWith\('\/api\/build-status\/'\)\)\{[\s\S]*?\n  \}/.exec(index)?.[0] ?? '';
  assert.ok(route, 'the build-status route must exist');
  assert.match(route, /const build=await findBuild\(buildId,env\);/);
  assert.doesNotMatch(route, /store\.list\('builds'\)/);
  assert.match(index, /async function findBuild\(buildId, env\) \{[\s\S]*?d1Get\(env, 'builds', buildId\)/);
});

test('a build whose D1 row was lost still offers the GitHub artifact', () => {
  // /api/build-app creates the build record on its last line, so the D1 write could lose
  // the race against the response. /api/build-status then answered "Build not found"
  // forever for a build that was already running, and the founder polled a dead id for
  // ten minutes and got no download. Fall back to the project's GitHub runs.
  const startBuild = /window\.startBuild=async function\(pid,plat,btn\)\{[\s\S]*?\n  \};/.exec(live)?.[0] ?? '';
  assert.ok(startBuild, 'startBuild must exist');
  assert.match(startBuild, /let viaProjectBuilds=false;/);
  assert.match(startBuild, /if\(\/Build not found\/i\.test\(String\(\(e&&e\.message\)\|\|e\|\|''\)\)\)viaProjectBuilds=true;/);
  assert.match(startBuild, /api\('\/api\/project-builds\/'\+encodeURIComponent\(pid\)\)/);
  assert.match(startBuild, /plat==='android'\?\(r&&r\.bestAPK\):\(r&&r\.bestEXE\)/);
  // The download button has to stay one implementation, used by both paths: window.open
  // cannot send the founder key, so the APK has to be fetched and saved as a blob.
  assert.match(startBuild, /const attachDownload=url=>\{/);
  assert.equal((startBuild.match(/attachDownload\(/g) ?? []).length, 2, 'used by both the poll and the fallback path');
});

test('every build button is rendered with the pid the live layer needs', () => {
  // The live handlers read dataset.pid, so the markup has to carry it.
  const html = dashboardHTML();
  assert.match(html, /window\.__mauliDownloadProject=downloadZip/);
  assert.match(dashboard, /class="btn btn-g btn-s bld-btn" data-pid="'\+p\.id\+'"/);
});
