import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';

const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const buildWorkflow = readFileSync(new URL('../.github/workflows/build-apps.yml', import.meta.url), 'utf8');
const live = DASHBOARD_LIVE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');

const projectBuilds = /if\(request\.method==='GET'&&url\.pathname\.startsWith\('\/api\/project-builds\/'\)\)\{[\s\S]*?\n  \}/.exec(index)?.[0] ?? '';
const buildStatus = /if\(request\.method==='GET'&&url\.pathname\.startsWith\('\/api\/build-status\/'\)\)\{[\s\S]*?\n  \}/.exec(index)?.[0] ?? '';

test('/api/project-builds only lists the runs of the project it was asked about', () => {
  // The route asked GitHub for the newest runs of the whole repository (no branch
  // filter), so every project was shown the same unrelated CI runs — including other
  // projects' build branches — and bestAPK could point at an artifact belonging to a
  // different founder command. A build for project X lives on build/project-X.
  assert.ok(projectBuilds, 'the project-builds route must exist');
  assert.ok(
    projectBuilds.includes("const buildBranch='build/project-'+safeProjectId;"),
    'the route must derive the project build branch the way /api/build-app names it'
  );
  assert.match(projectBuilds, /actions\/runs\?branch='\+encodeURIComponent\(buildBranch\)\+'&per_page=20'/);
});

test('/api/project-builds reads build rows from D1 when the cache has none', () => {
  assert.match(projectBuilds, /if\(!localBuilds\.length&&hasD1\(env\)\)localBuilds=\(await d1List\(env,'builds',\{limit:200\}\)/);
});

test('a run page is never reported as a downloadable APK', () => {
  // When the artifacts API refuses (403) or the artifact expired, the only thing left
  // is the run page. Returning it as downloadAPK/downloadUrl made the dashboard save a
  // GitHub HTML page such as mauli-android.apk.
  assert.ok(buildStatus, 'the build-status route must exist');
  assert.doesNotMatch(projectBuilds, /downloadAPK=viewUrl/);
  assert.doesNotMatch(projectBuilds, /downloadEXE=viewUrl/);
  assert.match(projectBuilds, /const withAPK=allBuilds\.find\(b=>b\.downloadUrlAPK\|\|/);
  assert.doesNotMatch(projectBuilds, /b\.downloadUrl\|\|b\.downloadUrlAPK\|\|b\.viewUrl/);
  assert.match(projectBuilds, /downloadUrlAPK:downloadAPK,downloadUrlEXE:downloadEXE,viewUrl:viewUrl/);

  assert.doesNotMatch(buildStatus, /downloadUrl=r\.html_url/, 'the run page is not the APK');
  assert.match(buildStatus, /let viewUrl=null;/);
  assert.match(buildStatus, /if\(bestRun\.html_url\)viewUrl=bestRun\.html_url;/);
  assert.match(buildStatus, /return ok\(\{buildId,status:conclusion\|\|status,downloadUrl,viewUrl,/);
});

test('the dashboard says so when a finished build has no artifact left', () => {
  assert.match(live, /if\(s&&!s\.downloadUrl&&s\.viewUrl&&s\.status==='success'\)\{/);
  assert.match(live, /window\.open\(s\.viewUrl,'_blank','noopener'\)/);
});

test('the worker no longer generates its own copy of the build workflow', () => {
  // The handler built ~90 lines of workflow YAML and PUT it onto the build branch on
  // every build. Writing under .github/workflows needs a token scope GITHUB_TOKEN does
  // not have, so the PUT always answered 403 and its response was never checked: two
  // wasted GitHub API calls per build plus a staler second copy of the pipeline waiting
  // for the day the token gains that scope. The repository file is the single source.
  assert.doesNotMatch(index, /wfLines/);
  assert.doesNotMatch(index, /wfBody/);
  assert.doesNotMatch(index, /contents\/'\+encodeURIComponent\('\.github\/workflows\/build-apps\.yml'\)/);
  assert.match(buildWorkflow, /branches:\s*\n\s*- 'build\/\*\*'/);
  assert.match(buildWorkflow, /android\/app\/build\/outputs\/apk\/debug\/\*\.apk/);
});
