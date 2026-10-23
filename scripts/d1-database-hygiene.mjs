#!/usr/bin/env node
// MAULI 2.0 — D1 database hygiene.
//
// Cloudflare's free plan allows 10 D1 databases per ACCOUNT and that ceiling never resets.
// `deploy-executor.mjs` now keeps exactly one database per generated project (its current
// schema), but every project deployed before that change still owns one database per schema
// revision it ever had. Those leftovers are what filled the account (measured: 9/10 with a
// single product deployed) and the next deploy would have failed with Cloudflare's
// "maximum number of databases" error.
//
// This tool is the one-time cleanup, and it is safe to keep: it only ever considers
// `generated-<project>-<10 hex>` databases, keeps the newest schema version of each project,
// and deletes nothing unless it is asked to.
//
// Usage:
//   node scripts/d1-database-hygiene.mjs                     # dry run: print the plan
//   node scripts/d1-database-hygiene.mjs --prune             # delete the stale ones
//   node scripts/d1-database-hygiene.mjs --keep generated-shop-1a2b3c4d5e --prune
//
// `--keep <name>` may be repeated; a kept database is never deleted even if it is not the
// newest of its project (use it when an older schema is the one actually deployed).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { planDatabaseHygiene, D1_ACCOUNT_DATABASE_LIMIT } from './deploy-executor.mjs';

const WRANGLER_BIN = join(process.cwd(), 'node_modules', '.bin', 'wrangler');

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, 120000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: String(error?.message ?? error) }); });
  });
}

function parseArgs(argv) {
  const keep = [];
  let prune = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prune') prune = true;
    else if (argv[i] === '--keep') { if (argv[i + 1]) keep.push(String(argv[++i])); }
    else if (argv[i].startsWith('--keep=')) keep.push(argv[i].slice('--keep='.length));
  }
  return { prune, keep };
}

async function listDatabases() {
  const listed = await run(WRANGLER_BIN, ['d1', 'list', '--json']);
  if (listed.code !== 0) {
    return { ok: false, message: String(listed.stderr || listed.stdout || 'wrangler d1 list failed').trim() };
  }
  try {
    const parsed = JSON.parse(listed.stdout || '[]');
    const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.result) ? parsed.result : []);
    return {
      ok: true,
      databases: rows
        .map((row) => ({ id: row?.uuid ?? row?.database_id ?? null, name: row?.name ?? null, createdAt: row?.created_at ?? null }))
        .filter((row) => row.name)
    };
  } catch (_) {
    return { ok: false, message: 'wrangler d1 list did not return JSON' };
  }
}

async function main() {
  const { prune, keep } = parseArgs(process.argv.slice(2));
  if (!existsSync(WRANGLER_BIN)) {
    console.error('no local pinned Wrangler binary found at node_modules/.bin/wrangler — run npm ci (or bun install) first');
    process.exit(2);
  }
  const listed = await listDatabases();
  if (!listed.ok) {
    console.error('could not list the account\'s D1 databases: ' + listed.message);
    process.exit(1);
  }
  const plan = planDatabaseHygiene(listed.databases, { keep });
  console.log(`D1 account: ${plan.total}/${plan.limit} databases (free-plan ceiling)`);
  if (plan.total >= plan.limit) {
    console.log('⚠ the account is AT or over its database ceiling — a new project cannot get a database until a slot is freed');
  }
  if (!plan.groups.length) {
    console.log('nothing to clean: every generated project already owns exactly one database');
    return 0;
  }
  console.log('');
  for (const group of plan.groups) {
    console.log(`project ${group.project}`);
    console.log(`  keep    ${group.kept}`);
    for (const stale of group.stale) console.log(`  ${prune ? 'delete ' : 'stale  '} ${stale.name}`);
  }
  const stale = plan.groups.flatMap((group) => group.stale);
  console.log('');
  if (!prune) {
    console.log(`${stale.length} superseded database(s) can be deleted. Re-run with --prune to delete them.`);
    return 0;
  }
  let failures = 0;
  for (const entry of stale) {
    const deleted = await run(WRANGLER_BIN, ['d1', 'delete', entry.name, '-y']);
    if (deleted.code === 0) {
      console.log(`deleted ${entry.name}`);
    } else {
      failures += 1;
      console.error(`FAILED to delete ${entry.name}: ${String(deleted.stderr || deleted.stdout).trim().slice(0, 400)}`);
    }
  }
  console.log('');
  console.log(`done: ${stale.length - failures} deleted, ${failures} failed, ${plan.total - (stale.length - failures)}/${D1_ACCOUNT_DATABASE_LIMIT} remain`);
  return failures ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
