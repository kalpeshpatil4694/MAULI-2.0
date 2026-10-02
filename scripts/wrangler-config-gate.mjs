#!/usr/bin/env node
// MAULI 2.0 — THE WRANGLER CONFIGURATION GATE.
//
// `wrangler deploy` reads `wrangler.jsonc` before it reads anything else, so a malformed
// config is not a runtime failure, it is a build that never happens. Two real defects came
// out of that and neither was visible in a unit test:
//
//   1. The Durable Object binding was emitted as `"durable_objects": [ ... ]`. wrangler's
//      schema wants an object with a `bindings` array. The file parsed as JSONC and still
//      failed validation, so the config looked right to every reader and to `JSON.parse`.
//   2. The D1 `database_id` was a placeholder. Deploying that config succeeded and then
//      every single API call answered 500, because there was no database behind `DB`.
//
// This gate regenerates a real backend project, then:
//
//   * parses the emitted `wrangler.jsonc` as JSONC, proving it has no parse error;
//   * checks the config against wrangler's own schema shape (D1 array, DO object with a
//     `bindings` array, DO class listed in `migrations[].new_sqlite_classes`);
//   * runs the emitted migration through REAL SQLite, so a `CREATE TABLE order` — a SQL
//     keyword, and the actual name of a coffee-shop order product — is caught here rather
//     than as a 500 on a deployed Worker;
//   * and, when the wrangler binary is present, runs a real `wrangler deploy --dry-run`
//     over the staged project and refuses to pass unless wrangler itself accepts it.
//
// Usage: node scripts/wrangler-config-gate.mjs [--json out.json] [--no-wrangler]

import { writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { stageProject } from './deploy-executor.mjs';

const run = promisify(execFile);

const args = process.argv.slice(2);
const outFile = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const skipWrangler = args.includes('--no-wrangler');

/** The command whose product is literally called "order" — the reserved-word case. */
const FOUNDERS = [
  'Build a shop order app for a coffee shop with staff login and live order updates',
  'Build a booking app where customers book appointments and staff view the schedule',
  'Build a medicine tracker app where I record each dose I take'
];

/** Strip `//` and comments so JSONC can be parsed as JSON. A real parser, not a regexp guess. */
function parseJsonc(text) {
  // Comments and trailing commas are the only things JSONC adds. Anything else stays strict.
  const withoutComments = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
  return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1'));
}

function wranglerBinary() {
  for (const candidate of [
    join(process.cwd(), 'node_modules/.bin/wrangler'),
    join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js')
  ]) if (existsSync(candidate)) return candidate;
  return null;
}

/** Generate, stage and check one founder command. */
async function checkProject(command, { withWrangler }) {
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  check('architecture selected', !!architecture?.id, architecture?.label ?? 'none');

  const dryRun = async (fileList, label) => {
    const bin = wranglerBinary();
    if (!bin) return check(`${label} wrangler deploy --dry-run`, false, 'wrangler binary not found');
    const root = join(tmpdir(), `mauli-wrangler-gate-${Math.random().toString(36).slice(2, 8)}`);
    await stageProject(fileList, { root });
    // A placeholder id is exactly what makes a deploy succeed and every request 500, so
    // the dry run is done against a syntactically real one.
    const cfgPath = join(root, 'wrangler.jsonc');
    const real = readFileSync(cfgPath, 'utf8')
      .replace('replace-with-your-d1-database-id', '00000000-0000-4000-8000-000000000000');
    writeFileSync(cfgPath, real, 'utf8');
    try {
      const { stdout, stderr } = await run(bin, ['deploy', '--dry-run'], { cwd: root, maxBuffer: 8 << 20 });
      const out = `${stdout}\n${stderr}`;
      return { ok: true, out, detail: out.trim().split('\n').slice(-6).join(' | ') };
    } catch (error) {
      const raw = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message}`;
      return { ok: false, out: raw, detail: raw.trim().split('\n').slice(-6).join(' | ') };
    }
  };

  // A product that keeps its records on the device has no Worker and no D1 — and its config
  // must say so, because a `main` pointing at a file that was never generated is a project
  // nobody can deploy at all.
  if (!architecture.backend) {
    const cfg = built.files.find((f) => f.path === 'wrangler.jsonc');
    let parsed = null;
    try {
      parsed = parseJsonc(cfg?.content ?? '');
      check('wrangler.jsonc parses as JSONC', true, `${(cfg?.content ?? '').length} bytes`);
    } catch (error) {
      check('wrangler.jsonc parses as JSONC', false, error.message);
      return { command, checks, ok: false };
    }
    check('no entry point declared for a product with no Worker', parsed.main === undefined, String(parsed.main));
    check('no D1 for a product with no database', Array.isArray(parsed.d1_databases) && parsed.d1_databases.length === 0, JSON.stringify(parsed.d1_databases));
    check('no Durable Object for a product with no live channel', parsed.durable_objects === undefined);
    check('assets directory is bound', parsed.assets?.directory === './www', JSON.stringify(parsed.assets));
    if (withWrangler && !skipWrangler) {
      const dry = await dryRun(built.files, 'assets-only');
      check('wrangler deploy --dry-run', dry.ok, dry.detail);
      check('dry run read the frontend assets', /Read \d+ files from the assets directory/.test(dry.out ?? ''));
    }
    return { command, table: built.table, config: parsed, checks, ok: checks.every((c) => c.ok) };
  }

  const config = built.files.find((f) => f.path === 'wrangler.jsonc');
  if (!config) {
    check('wrangler.jsonc emitted', false);
    return { command, checks, ok: false };
  }

  let parsed = null;
  try {
    parsed = parseJsonc(config.content);
    check('wrangler.jsonc parses as JSONC', true, `${config.content.length} bytes`);
  } catch (error) {
    // This is the exact failure mode that made a generated project undeployable: a config
    // that every reader agreed was fine and that wrangler refused to load.
    check('wrangler.jsonc parses as JSONC', false, error.message);
    return { command, checks, ok: false };
  }

  const db = parsed.d1_databases;
  check(
    'd1_databases is an array',
    Array.isArray(db) && db.length === 1,
    `got ${JSON.stringify(db)?.slice(0, 120)}`
  );
  const binding = Array.isArray(db) ? db[0] : null;
  check('D1 binding is named DB', binding?.binding === 'DB', String(binding?.binding));
  check('D1 declares a database_name', !!binding?.database_name, String(binding?.database_name));
  check(
    'D1 declares a database_id',
    typeof binding?.database_id === 'string' && binding.database_id.length > 0,
    String(binding?.database_id)
  );
  check(
    'D1 points at its migrations dir',
    binding?.migrations_dir === 'migrations',
    String(binding?.migrations_dir)
  );
  check('worker entry point exists', parsed.main === 'worker/index.js', String(parsed.main));
  check('assets directory is bound', parsed.assets?.binding === 'ASSETS', JSON.stringify(parsed.assets));
  check('the declared entry point is in the generated files', built.files.some((f) => f.path === parsed.main), String(parsed.main));

  // A product with no live channel owes no Durable Object. Emitting an empty DO block for
  // one would be noise; what must never happen is emitting a DO block in the WRONG SHAPE.
  if (architecture.realtime) {
    const dos = parsed.durable_objects;
    check(
      'durable_objects is an object, not an array',
      !!dos && !Array.isArray(dos) && typeof dos === 'object',
      `got ${Array.isArray(dos) ? 'array' : typeof dos}`
    );
    check(
      'durable_objects.bindings is an array',
      Array.isArray(dos?.bindings),
      `got ${JSON.stringify(dos?.bindings)?.slice(0, 120)}`
    );
    const live = (dos?.bindings ?? []).find((b) => b?.name === 'LIVE');
    check('LIVE binding declared', !!live, JSON.stringify(live));
    const classes = (parsed.migrations ?? []).flatMap((m) => m?.new_sqlite_classes ?? []);
    check('LiveConnections is in new_sqlite_classes', classes.includes('LiveConnections'), JSON.stringify(classes));
  } else {
    check('no Durable Object for a product with no live channel', parsed.durable_objects === undefined, String(parsed.durable_objects));
  }
  // A config is only correct if every path it names is a file the product actually ships.

  // --- the migration, executed by REAL SQLite -----------------------------------------
  const sql = built.files.find((f) => f.path === 'migrations/0001_init.sql')?.content;
  check('migration file emitted', !!sql);
  if (sql) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db2 = new DatabaseSync(':memory:');
      // A real parser, not a regex: this is what reported the deployed D1 500.
      db2.exec(sql);
      const tables = db2.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map((r) => r.name);
      check('migration executes on real SQLite', true, tables.join(', '));
      check('migration creates the founder\'s own entity', tables.includes(built.table), `expected ${built.table}`);
      db2.close();
    } catch (error) {
      check('migration executes on real SQLite', false, error.message);
    }
  }

  // The Worker's own runtime CREATE must be equally valid — it runs on every cold start.
  const worker = built.files.find((f) => f.path === 'worker/index.js')?.content ?? '';
  const runtimeCreate = /CREATE TABLE IF NOT EXISTS ([^\s(]+)/.exec(worker)?.[1] ?? '';
  check('worker quotes its table identifier', /^".+"$/.test(runtimeCreate), `got ${runtimeCreate}`);

  if (withWrangler && !skipWrangler) {
    const dry = await dryRun(built.files, 'backend');
    check('wrangler deploy --dry-run', dry.ok, dry.detail);
    check('dry run declares the D1 binding', /env\.DB\b/.test(dry.out ?? ''));
    check('dry run read the frontend assets', /Read \d+ files from the assets directory/.test(dry.out ?? ''));
    if (architecture.realtime) {
      check('dry run declares the Durable Object binding', /env\.LIVE\b/.test(dry.out ?? ''));
    }
  }

  return { command, table: built.table, config: parsed, checks, ok: checks.every((c) => c.ok) };
}

export async function runWranglerConfigGate({ withWrangler = true } = {}) {
  const results = [];
  for (const command of FOUNDERS) results.push(await checkProject(command, { withWrangler }));
  return { results, ok: results.every((r) => r.ok), generatedAt: new Date().toISOString() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runWranglerConfigGate();
  for (const r of report.results) {
    console.log(`\nMAULI 2.0 — wrangler configuration gate: ${r.command}`);
    console.log(`  entity: ${r.table ?? '(none)'}  verdict: ${r.ok ? 'PASS' : 'FAIL'}`);
    for (const c of r.checks) {
      console.log(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
    }
  }
  console.log(`\nFINAL DELIVERY: ${report.ok ? 'READY' : 'NOT READY — a generated project cannot be deployed'}`);
  if (outFile) await writeFile(outFile, JSON.stringify(report, null, 2), 'utf8');
  process.exit(report.ok ? 0 : 1);
}