import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
// The command response envelope moved with the endpoint. Assert against the module that owns
// it, and against the worker's delegation, so neither half can change unnoticed.
const endpoint = fs.readFileSync(new URL('../src/command-endpoint.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
const liveBridge = fs.readFileSync(new URL('../src/dashboard-live.js', import.meta.url), 'utf8');

test('founder command response keeps dashboard-compatible top-level result', () => {
  assert.match(endpoint, /const responseData\s*=\s*\{/);
  assert.match(endpoint, /data:\s*responseData/);
  assert.match(endpoint, /\.\.\.responseData/);
  assert.match(worker, /handleFounderCommand\(request, env, ctx\)/, 'the worker must serve the real endpoint');
  // The contract is that the dashboard unwraps `result` off the envelope. What it used to
  // DO with that envelope — stringify it into the founder's view — was the thing this file
  // used to pin, and is now covered by tests/dashboard-command-outcome.test.js. Assert the
  // contract itself, not the raw dump it used to produce.
  assert.match(dashboard, /r\.result\|\|r/);
});

test('founder command dashboard refreshes state through the adaptive live bridge after queue acknowledgement', () => {
  assert.match(liveBridge, /async function poll\(\)/);
  // The bridge now attaches the founder key header, so the fetch keeps the same
  // no-store polling but carries credentials.
  assert.match(liveBridge, /fetch\('\/api\/state',\{cache:'no-store',headers:/);
  assert.match(liveBridge, /__mauliFounderHeaders/);
  assert.match(liveBridge, /schedulePoll\(500\)/);
  assert.match(liveBridge, /schedulePoll\(state\.retrySoon\?2000:\(active\?5000:20000\)\)/);
  assert.doesNotMatch(liveBridge, /window\.setInterval\(poll,5000\)/);
});
