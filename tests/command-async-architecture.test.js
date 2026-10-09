import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const endpoint = readFileSync(new URL('../src/command-endpoint.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const orchestrator = readFileSync(new URL('../src/orchestrator.js', import.meta.url), 'utf8');
const scheduler = readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');

// The deployed founder-command path is: worker.js routes the request to the endpoint module,
// which queues the command and hands execution to the scheduler. The endpoint lives in its own
// module because worker.js cannot be imported under Node (it re-exports the Durable Object,
// which pulls in `cloudflare:workers`), so an inline handler could only ever be tested by
// reading worker.js as text.
test('the worker delegates the founder command to the production endpoint', () => {
  assert.match(worker, /url\.pathname\s*===\s*['"]\/api\/command['"]/);
  assert.match(worker, /handleFounderCommand\(request, env, ctx\)/);
  assert.match(worker, /from\s+['"]\.\/command-endpoint\.js['"]/);
  assert.doesNotMatch(worker, /Promise\.race\(\[\s*planCommand\(/);
  assert.doesNotMatch(worker, /setTimeout\(\(\)=>rej\(new Error\(['"]timeout['"]\)\),60000\)/);
});

// Negative control for finding F-1. A second, synchronous implementation of POST /api/command
// used to live in src/index.js. It was unreachable in production (worker.js intercepts the path
// first) while the test suite drove it — 201 instead of 202, an inline run with a 60-second
// timeout instead of a durable queue, a different rate-limit scope, and no scheduler hand-off.
// If it ever comes back, this test must fail.
test('src/index.js does not implement a second, synchronous command route', () => {
  assert.doesNotMatch(index, /url\.pathname\s*===\s*['"]\/api\/command['"]/,
    'index.js must not handle POST /api/command; the endpoint module owns it');
  assert.doesNotMatch(index, /Promise\.race\(\[\s*planCommand\(/,
    'the 60-second synchronous command path must not be reintroduced');
  assert.doesNotMatch(index, /planCommand/,
    'index.js must not plan commands directly — that is the endpoint/scheduler path');
});

test('the endpoint queues the command and does not run it inline', () => {
  assert.match(endpoint, /queueCommand\(/);
  assert.match(endpoint, /schedulerTick\(/);
  assert.match(endpoint, /ctx\.waitUntil\(/);
  assert.match(endpoint, /status:\s*202|status: 202/);
  assert.doesNotMatch(endpoint, /Promise\.race\(\[\s*planCommand\(/);
  assert.doesNotMatch(endpoint, /setTimeout\(\(\)=>rej\(new Error\(['"]timeout['"]\)\),60000\)/);
});

test('Queued command has a durable run id and project correlation', () => {
  assert.match(orchestrator, /export async function queueCommand\(/);
  assert.match(orchestrator, /const runId=id\(['"]command['"]\)/);
  assert.match(orchestrator, /commandRunId:runId/);
  assert.match(orchestrator, /state:'queued'/);
});

test('Scheduler owns final command persistence and delivery', () => {
  assert.match(scheduler, /saveCommandResult/);
  assert.match(scheduler, /buildFinalDelivery/);
  assert.match(scheduler, /finalizeCommand\(/);
  assert.match(scheduler, /status\s*:\s*['"]completed['"]/);
});
