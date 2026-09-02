import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const orchestrator = readFileSync(new URL('../src/orchestrator.js', import.meta.url), 'utf8');
const scheduler = readFileSync(new URL('../src/scheduler.js', import.meta.url), 'utf8');

test('Founder command is scheduler-backed and does not use the old 60s timeout path', () => {
  assert.match(worker, /url\.pathname\s*===\s*['"]\/api\/command['"]/);
  assert.match(worker, /queueCommand\(/);
  assert.match(worker, /schedulerTick\(/);
  assert.match(worker, /ctx\.waitUntil\(/);
  assert.doesNotMatch(worker, /Promise\.race\(\[planCommand\(/);
  assert.doesNotMatch(worker, /setTimeout\(\(\)=>rej\(new Error\(['"]timeout['"]\)\),60000\)/);
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
