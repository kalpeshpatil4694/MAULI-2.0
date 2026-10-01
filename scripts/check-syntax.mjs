// Parse-checks every JavaScript module in the repository without executing it.
//
// `node --test` only imports the files a test happens to touch, so a syntax error in an
// unused route or a freshly deleted module could reach deploy unnoticed. This walks the
// source trees and runs `node --check` on each file, which is exactly what the Worker will
// be parsed with. Kept in Node (not shell) so it behaves identically on CI and locally.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['src', 'scripts', 'tests', 'test'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', '.build-check', 'dist', 'coverage']);
const EXTS = ['.js', '.mjs'];

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (EXTS.some((ext) => full.endsWith(ext))) files.push(full);
  }
}

const files = [];
for (const root of ROOTS) {
  try {
    walk(root, files);
  } catch {
    // A tree that does not exist (e.g. `test/` in another checkout) is not a failure.
  }
}
// The Worker entrypoints and configuration-adjacent modules worth checking explicitly.
for (const entry of ['src/worker.js', 'src/index.js']) {
  if (!files.includes(entry)) files.push(entry);
}

let failed = 0;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`\n${file}\n${result.stderr || result.stdout || 'syntax error'}\n`);
  }
}

console.log(`Syntax check: ${files.length - failed}/${files.length} files parsed${failed ? ` — ${failed} FAILED` : ''}`);
process.exit(failed === 0 ? 0 : 1);
