import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectProjectFiles } from '../src/zip.js';

const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const buildWorkflow = readFileSync(new URL('../.github/workflows/build-apps.yml', import.meta.url), 'utf8');

test('the repository ships a push-triggered workflow for the build branches', () => {
  // /api/build-app used to generate .github/workflows/build-apps.yml onto the build
  // branch and ignore the PUT response. Writing there needs a token scope the
  // worker's GITHUB_TOKEN does not have, so it always failed and no build ever ran.
  // The workflow therefore lives in the repository and fires on the file pushes the
  // worker can already make.
  assert.match(buildWorkflow, /branches:\s*\n\s*-\s*'build\/\*\*'/);
  assert.match(buildWorkflow, /name:\s*android-apk/);
  assert.match(buildWorkflow, /app\/build\/outputs\/apk\/debug\/\*\.apk/);
  assert.match(buildWorkflow, /actions\/upload-artifact@v4/);
  // Every project file is pushed separately, so only the last run should finish.
  assert.match(buildWorkflow, /cancel-in-progress:\s*true/);
});

test('the HTTP path hydrates before serving instead of racing background hydration', () => {
  // initOnce() used to kick hydration off with ctx.waitUntil and return immediately,
  // so the first requests of a cold isolate ran against an empty store. That is how
  // /api/build-app answered "No code artifact found for this project" for projects
  // whose files were already in D1, and how /api/build-status answered a false 404.
  const initOnce = /async function initOnce\(env, ctx\) \{[\s\S]*?\n\}/.exec(index)?.[0] ?? '';
  assert.ok(initOnce, 'initOnce must exist');
  assert.match(initOnce, /await store\.hydrateOnce\(\)/, 'initOnce must await hydration');
  assert.doesNotMatch(initOnce, /ctx\.waitUntil\(hydration\)/, 'hydration must not be left in the background');
});

test('the worker light path also hydrates before answering', () => {
  assert.match(worker, /if \(!store\.hydrated\) await store\.hydrateOnce\(\)/);
});

test('build-app resolves project code from the authoritative artifact list', () => {
  // The route must not re-derive the artifact set from the row-capped cache only.
  assert.match(index, /async function projectCodeArtifacts\(projectId, env\)/);
  assert.match(index, /const codeArtifacts=await projectCodeArtifacts\(projectId,env\)/);
  // ...and the resolved list is what actually gets pushed, not a second cache read.
  assert.match(index, /collectProjectFiles\(projectId,latest,store,codeArtifacts\)/);
});

test('build-app refuses to start a build that Capacitor cannot package', () => {
  // www/index.html is the Capacitor webDir and package.json is required by the
  // generated workflow. Failing here beats pushing a branch whose build dies.
  assert.match(index, /no www\/index\.html/);
  assert.match(index, /no package\.json/);
  assert.match(index, /f\.path==='www\/index\.html'/);
});

test('build-status falls back to D1 when the capped in-memory list lacks the build', () => {
  assert.match(index, /async function findBuild\(buildId, env\)/);
  assert.match(index, /d1Get\(env, 'builds', buildId\)/);
});

test('collectProjectFiles can be given the authoritative artifact list', () => {
  const emptyStore = { list: () => [] };
  const artifacts = [
    { projectId: 'p1', type: 'code-workspace', content: { files: [
      { path: 'www/index.html', content: 'A' },
      { path: 'www/index.html', content: 'A' },
      { path: 'www/app.js', content: 'B' },
    ] } },
    { projectId: 'p1', type: 'code-workspace', content: { files: [
      { path: 'www/index.html', content: 'A' },
      { path: 'www/app.js', content: 'B2' },
    ] } },
  ];

  const fromProvided = collectProjectFiles('p1', artifacts[0], emptyStore, artifacts);
  assert.deepEqual(fromProvided, [
    { path: 'www/index.html', content: 'A' },
    { path: 'www/app.js', content: 'B2' },
  ], 'repeated paths must collapse to one entry, and the newest content wins');

  // Without the explicit list the function keeps its original cache-based behaviour.
  const fromCache = collectProjectFiles('p1', artifacts[0], { list: () => artifacts });
  assert.deepEqual(fromCache, fromProvided);
});

test('collectProjectFiles still falls back to the artifact argument when nothing is cached', () => {
  const artifact = { projectId: 'p2', type: 'code-workspace', content: { files: [
    { path: 'www/index.html', content: 'only' },
  ] } };
  const files = collectProjectFiles('p2', artifact, { list: () => [] });
  assert.deepEqual(files, [{ path: 'www/index.html', content: 'only' }]);
});
