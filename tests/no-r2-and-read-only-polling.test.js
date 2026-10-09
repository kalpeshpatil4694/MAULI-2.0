// Locks in two guarantees the founder asked for explicitly:
//
//   1. R2 is completely gone. The platform runs on Workers + D1 + Durable Objects +
//      Workers AI only — there must be no object-storage binding, module, config,
//      catalog entry or documentation that could reintroduce an R2 dependency.
//   2. Dashboard polling is read-only. GET /api/state and GET /api/projects/:id/detail
//      used to fire a throttled scheduler tick, so a founder who left the dashboard open
//      triggered D1 writes and could start duplicate task runs. Execution is now owned
//      exclusively by the cron trigger and by explicit POST routes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const exists = (p) => fs.existsSync(new URL(p, root));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(new URL(dir, root))) {
    const rel = path.posix.join(dir, entry);
    if (fs.statSync(new URL(rel, root)).isDirectory()) walk(rel + '/', out);
    else out.push(rel);
  }
  return out;
}

test('R2 is fully removed: no module, no binding, no code, no catalog entry', () => {
  assert.equal(exists('src/r2-storage.js'), false, 'src/r2-storage.js must be deleted');

  const config = read('wrangler.jsonc');
  assert.doesNotMatch(config, /r2_buckets/, 'wrangler.jsonc must not declare an R2 bucket binding');
  assert.doesNotMatch(config, /"ARTIFACTS"/, 'no object-storage binding may be configured');

  const offenders = [];
  for (const file of walk('src/')) {
    if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
    const source = read(file);
    if (/r2-storage|hasR2|artifactZipKey|putArtifactZip|getArtifactObject|r2Key|R2Bucket|r2_buckets/.test(source)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], `R2 code references remain in: ${offenders.join(', ')}`);

  // Service catalogs are data, not configuration, but a listed "Cloudflare R2" entry is
  // still an R2 reference the audit asked to remove.
  const catalogs = read('src/free-services.js') + read('src/public-apis.js');
  assert.doesNotMatch(catalogs, /Cloudflare R2/, 'R2 must not appear in the service catalogs');

  // The health probe and usage report must not advertise an R2 binding or R2 limits.
  assert.doesNotMatch(read('src/index.js'), /r2:Boolean/, 'health must not report an R2 binding');
  assert.doesNotMatch(read('src/db.js'), /r2StorageGBMonth|r2ClassAOperationsMonth|r2ClassBOperationsMonth/,
    'the usage report must not carry R2 free-tier limits');
});

test('dashboard polling is read-only and never triggers execution', () => {
  const worker = read('src/worker.js');

  // The old poll self-heal paths are gone.
  assert.doesNotMatch(worker, /dashboard-poll/, 'GET /api/state must not trigger the scheduler');
  assert.doesNotMatch(worker, /project-detail/, 'GET /api/projects/:id/detail must not trigger the scheduler');
  assert.doesNotMatch(worker, /state\.scheduler_error/, 'no poll-triggered scheduler error path');
  assert.doesNotMatch(worker, /project\.detail_scheduler_error/, 'no detail-poll scheduler error path');

  // The only scheduler triggers left are explicit, founder-initiated actions. The command
  // trigger lives in the endpoint module the worker delegates to, so both HTTP entry modules
  // are scanned: moving this code must not be a way to smuggle in a polling trigger.
  const entrySources = [worker, read('src/command-endpoint.js')];
  const triggers = entrySources.flatMap((src) => [...src.matchAll(/trigger: '([a-z-]+)'/g)].map((m) => m[1])).sort();
  assert.deepEqual(triggers, ['approval-granted', 'chat-message', 'founder-command'],
    `execution must only start from explicit actions, found: ${triggers.join(', ')}`);

  // Cron still owns periodic progress.
  assert.match(worker, /async scheduled\(/, 'the cron handler must remain');
});
