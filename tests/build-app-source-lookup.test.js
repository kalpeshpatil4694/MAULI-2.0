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
  // Capacitor 7 needs `javac` source release 21 and this job runs Java 17, so an
  // unpinned install fails with "error: invalid source release: 21".
  assert.match(buildWorkflow, /@capacitor\/core@6/);
  assert.match(buildWorkflow, /@capacitor\/cli@6/);
  assert.match(buildWorkflow, /@capacitor\/android@6/);
  assert.match(buildWorkflow, /java-version:\s*17/);
});

test('the HTTP init path can await hydration when a hydration-enabled route needs it', () => {
  // initOnce() used to kick hydration off with ctx.waitUntil and return immediately,
  // so the first requests of a cold isolate ran against an empty store. That is how
  // /api/build-app answered "No code artifact found for this project" for projects
  // whose files were already in D1, and how /api/build-status answered a false 404.
  const initOnce = /async function initOnce\(env, ctx, \{ hydrate = true \} = \) \{[\s\S]*?\n\}/.exec(index)?.[0] ?? '';
  assert.ok(initOnce, 'initOnce must exist');
  assert.match(initOnce, /await store\.hydrateOnce\(\)/, 'initOnce must await hydration');
  assert.doesNotMatch(initOnce, /ctx\.waitUntil\(hydration\)/, 'hydration must not be left in the background');
});

test('the worker light HTTP path does not hydrate the full store before answering', () => {
  // Full HTTP hydration was deliberately removed from the Worker entrypoint because
  // dashboard polling/cold isolates were consuming the D1 rows_read budget. The
  // application layer owns hydration only for routes that explicitly need it.
  assert.match(worker, /Request hydration is handled by the application layer/);
  assert.doesNotMatch(worker, /if \(!store\.hydrated\) await store\.hydrateOnce\(\)/);
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

test('the build record is written as a critical row so it survives the write budget', () => {
  // /api/build-app writes the record on one isolate and /api/build-status reads it
  // from whichever isolate answers the next dashboard poll. Written non-critically
  // it was dropped whenever the write budget was tight, so a build that really was
  // running on GitHub answered 404 forever.
  const store = readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const critical = /const CRITICAL_TYPES = new Set\(\[([^\]]*)\]\)/.exec(store)?.[1] ?? '';
  assert.match(critical, /'builds'/, 'builds must be a critical write');
  assert.match(critical, /'build_locks'/);
});

test('build-app keeps the isolate alive until the build row is durable', () => {
  // store.put() does not await its D1 write, and the build record is created on the last
  // line of the handler. The response therefore returned with the INSERT still in flight
  // and the isolate was torn down before it landed: D1 held only 2 build rows while the
  // dashboard had started several builds, so /api/build-status answered a permanent 404
  // for a build that was genuinely running on GitHub.
  const row = /store\.put\('builds',\{id:buildId,[^\n]*\n\s*store\.addEvent\('build\.started'[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*await store\.flush\(\)\.catch\(\(\)=>\{\}\);/;
  assert.match(index, row, 'the build row must be flushed before the handler answers');
});

test('collectProjectFiles can be given the authoritative artifact list', () => {
  const emptyStore = { list: () => [] };
  const artifacts = [
    { projectId: 'p1', type: 'code-workspace', createdAt: '2026-09-28T01:00:00.000Z', content: { files: [
      { path: 'www/index.html', content: 'A' },
      { path: 'www/index.html', content: 'A' },
      { path: 'www/app.js', content: 'B' },
    ] } },
    { projectId: 'p1', type: 'code-workspace', createdAt: '2026-09-29T01:00:00.000Z', content: { files: [
      { path: 'www/index.html', content: 'A' },
      { path: 'www/app.js', content: 'B2' },
    ] } },
  ];

  const fromProvided = collectProjectFiles('p1', artifacts[0], emptyStore, artifacts);
  assert.deepEqual(fromProvided, [
    { path: 'www/index.html', content: 'A' },
    { path: 'www/app.js', content: 'B2' },
  ], 'repeated paths must collapse to the NEWEST copy, whatever order the pool arrives in');

  // Same result with the pool reversed: the rule is the newest artifact, not list order.
  const reversed = collectProjectFiles('p1', artifacts[0], emptyStore, [...artifacts].reverse());
  assert.deepEqual(reversed, fromProvided);

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
