import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectProjectFiles, createZip } from '../src/zip.js';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';

const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const live = DASHBOARD_LIVE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');

// A real project in production ships one code-workspace artifact per run, each
// holding the whole file set, so /api/app-files listed www/index.html five times.
function duplicateArtifacts() {
  const files = [
    { path: 'www/index.html', content: '<html>v1</html>' },
    { path: 'www/app.js', content: 'console.log(1)' },
    { path: 'package.json', content: '{"name":"x"}' },
  ];
  return [
    { id: 'a1', type: 'code-workspace', projectId: 'p1', createdAt: '2026-09-28T01:00:00.000Z', content: { files } },
    { id: 'a2', type: 'code-workspace', projectId: 'p1', createdAt: '2026-09-29T01:00:00.000Z', content: { files } },
  ];
}

test('collectProjectFiles keeps one copy of each path', () => {
  const files = collectProjectFiles('p1', null, { list: () => duplicateArtifacts() }, duplicateArtifacts());
  assert.deepEqual(files.map(f => f.path).sort(), ['package.json', 'www/app.js', 'www/index.html']);
});

test('a deliverable zip holds unique entries the browser can open', () => {
  const files = collectProjectFiles('p1', null, { list: () => duplicateArtifacts() }, duplicateArtifacts());
  const zip = createZip(files);
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  // Count central-directory headers (PK\x01\x02) and make sure every name is distinct.
  const names = [];
  for (let i = 0; i + 4 <= zip.length; i++) {
    if (zip[i] === 0x50 && zip[i + 1] === 0x4b && zip[i + 2] === 0x01 && zip[i + 3] === 0x02) {
      const len = zip[i + 28] | (zip[i + 29] << 8);
      names.push(String.fromCharCode(...zip.slice(i + 46, i + 46 + len)));
    }
  }
  assert.equal(names.length, 3);
  assert.equal(new Set(names).size, 3, 'a zip with duplicate names breaks on some extractors');
});

test('/api/app-files and /api/project-download share the build-path authority', () => {
  // Both must read every code artifact D1 holds, not the capped in-memory cache,
  // and must dedupe through collectProjectFiles().
  assert.match(index, /url\.pathname==='\/api\/project-download'/);
  const appFiles = /url\.pathname==='\/api\/app-files'\)\{[\s\S]*?\n  \}/.exec(index)?.[0] ?? '';
  assert.ok(appFiles, 'the app-files route must exist');
  assert.match(appFiles, /await projectCodeArtifacts\(projectId,env\)/);
  assert.match(appFiles, /collectProjectFiles\(projectId,null,store,artifacts\)/);
  assert.doesNotMatch(appFiles, /store\.list\('artifacts'\)/, 'no capped in-memory read');
  const zipRoute = /url\.pathname==='\/api\/project-download'\)\{[\s\S]*?\n  \}/.exec(index)?.[0] ?? '';
  assert.ok(zipRoute, 'the project-download route must exist');
  assert.match(zipRoute, /createZip\(files\)/);
  assert.match(zipRoute, /content-disposition/);
});

test('the dashboard downloads one zip instead of one click per file', () => {
  const downloadZip = /window\.downloadZip=async function\(pid\)\{[\s\S]*?\n  \};/.exec(live)?.[0] ?? '';
  assert.ok(downloadZip, 'the downloadZip override must be present');
  assert.match(downloadZip, /\/api\/project-download\?projectId=/);
  assert.doesNotMatch(downloadZip, /saveProjectFiles/, 'no per-file download loop');
});

test('protected downloads are fetched with the founder header, never window.open', () => {
  // window.open('/api/download-artifact/...') cannot send the founder key header,
  // so the APK download answered 401 in a new tab and nothing was ever saved.
  assert.match(live, /async function fetchAsBlob\(url,retried\)/);
  assert.match(live, /function saveBlob\(blob,name\)/);
  assert.match(live, /__mauliFounderHeaders\(\{\}\)/);
  const startBuild = /window\.startBuild=async function[\s\S]*?\n  \};/.exec(live)?.[0] ?? '';
  assert.ok(startBuild, 'the startBuild override must be present');
  assert.match(startBuild, /await fetchAsBlob\(s\.downloadUrl,false\)/);
  assert.match(startBuild, /saveBlob\(blob,name\|\|/);
  assert.doesNotMatch(startBuild, /window\.open\(s\.downloadUrl/, 'no header-less navigation');
});
