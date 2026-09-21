import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const dashboard = fs.readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
const liveBridge = fs.readFileSync(new URL('../src/dashboard-live.js', import.meta.url), 'utf8');

test('founder command response keeps dashboard-compatible top-level result', () => {
  assert.match(worker, /const responseData\s*=\s*\{/);
  assert.match(worker, /data:\s*responseData/);
  assert.match(worker, /\.\.\.responseData/);
  assert.match(dashboard, /JSON\.stringify\(r\.result\|\|r/);
});

test('founder command dashboard refreshes state through the live bridge after queue acknowledgement', () => {
  assert.match(liveBridge, /async function poll\(\)/);
  assert.match(liveBridge, /fetch\('\/api\/state',\{cache:'no-store'\}\)/);
  assert.match(liveBridge, /window\.setTimeout\(poll,500\)/);
  assert.match(liveBridge, /window\.setInterval\(poll,15000\)/);
});
