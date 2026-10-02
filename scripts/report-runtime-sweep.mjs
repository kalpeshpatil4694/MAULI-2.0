#!/usr/bin/env node
// MAULI 2.0 — RUNTIME SWEEP REPORT (CI).
//
// The per-project runtime sweep returns one row per generated project. How that result is
// PRESENTED is not cosmetic: a green job that silently skipped every project is exactly the
// misleading result the acceptance contract forbids. So the three states are named, printed
// and raised separately:
//
//   A. configuration failure — this repository is missing a credential (the caller fails the
//      job before it ever reaches this script)
//   B. generated-project runtime failure — a product did not survive its own acceptance
//   C. external dependency BLOCKED — a third-party service has no credential
//
// Usage: node scripts/report-runtime-sweep.mjs <sweep.json>

import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const file = process.argv[2] ?? '/tmp/runtime-sweep.json';
if (!existsSync(file)) {
  console.error(`No sweep response at ${file}; the sweep did not run, which is not a pass.`);
  process.exit(1);
}
const parsed = JSON.parse(readFileSync(file, 'utf8'));
const data = parsed?.data ?? parsed ?? {};
const rows = Array.isArray(data.projects) ? data.projects : [];

console.log(`  swept ${data.swept ?? 0} project(s); runtime executor: ${data.executorConfigured}, deploy executor: ${data.deployExecutorConfigured}`);
let blocked = 0;
const runtimeFailures = [];
for (const row of rows) {
  if (row.blocked) blocked += 1;
  // B: the product ran and did not survive. Distinct from C, which names a dependency.
  if (row.verdict === 'FAILED') runtimeFailures.push(row.projectId);
  console.log(`  ${row.blocked ? 'BLOCKED' : 'EVIDENCE'} ${row.projectId} - ${row.verdict}${row.reason ? ` (${row.reason})` : ''}`);
}

const lines = [
  '## Production runtime acceptance - every generated project',
  '',
  `swept **${data.swept ?? 0}** project(s) - runtime executor: **${data.executorConfigured}** - deploy executor: **${data.deployExecutorConfigured}**`,
  ''
];
if (data.blockingDependency) lines.push(`**BLOCKED - DEPENDENCY_REQUIRED:** ${data.blockingDependency}`, '');
if (!rows.length) {
  lines.push('No generated project is awaiting a runtime acceptance run.');
} else {
  lines.push('| project | deployment | runtime | URL | final delivery | reason |', '|---|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(`| ${row.projectId} | ${row.deploymentStatus} | ${row.verdict} | ${row.runtimeUrl ?? '-'} | ${row.finalDelivery} | ${(row.blockingCode ?? '')} ${row.reason ?? ''} |`);
  }
  lines.push('', `**${blocked} of ${rows.length} project(s) BLOCKED** - their Final Delivery stays blocked.`);
}
if (existsSync(process.env.GITHUB_STEP_SUMMARY ?? '')) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);

if (data.blockingDependency) {
  console.log(`::warning title=Production runtime acceptance BLOCKED::${data.blockingDependency}`);
} else if (runtimeFailures.length) {
  console.log(`::error title=Generated project runtime failure::${runtimeFailures.join(', ')} did not survive its own production runtime acceptance.`);
} else if (blocked) {
  console.log(`::warning title=${blocked} generated project(s) BLOCKED on runtime evidence::Their Final Delivery stays blocked; the gate decides what ships.`);
}
if (!rows.length) console.log('  no generated project is awaiting a runtime acceptance run');
else console.log(`  ${blocked} project(s) BLOCKED on runtime evidence - their Final Delivery stays blocked.`);
