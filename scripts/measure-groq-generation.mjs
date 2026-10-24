// Live measurement of the per-file generation path against the real Groq provider.
// Run from the repo root with GROQ_API_KEY present in the environment. Not part of the suite.
//
// Measures the path the executor ACTUALLY runs — per-file generation with pacing, bounded
// retries on rate limits, exponential backoff, and per-file failure reasons (not silent
// nulls) — across several distinct founder objectives, and reports the success rate plus the
// exact reason of every remaining failure.
//
// One run can't finish five real generations inside a bounded command window, so the script
// is resumable: `node scripts/measure-groq-generation.mjs 0 1` measures those apps only and
// journals every result to GROQ_MEASURE_STATE (default /tmp/groq-measure-state.json); with
// no arguments it measures the missing ones and aggregates over everything journaled.
import { probeAiGeneration } from '../src/functional-code-executor.js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  // Force the fallback chain: Workers AI "fails", exactly as it does in production when the
  // daily allowance is spent.
  AI: { async run() { throw new Error('4006 daily free allocation exhausted'); } },
};

const OBJECTIVES = [
  'Build a responsive expense tracker web app with add, filter by month, delete, and monthly totals that persist across refreshes, with a polished dashboard look',
  'Build a habit tracker web app where each day you check off habits, a streak counter is shown, and the daily history persists across refreshes',
  'Build a recipe box web app: add recipes with a name, ingredients and steps, list them, delete them, and persist everything locally across refreshes',
  'Build a simple budget planner web app: set a monthly budget, log expenses with categories, and show the remaining budget, all persisted locally',
  'Build a water intake tracker web app: log daily glasses of water, show a progress bar toward the daily goal, keep per-day history and persist across refreshes'
];

const STATE_PATH = process.env.GROQ_MEASURE_STATE ?? '/tmp/groq-measure-state.json';
const loadState = () => { try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; } };
const saveState = (s) => writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

const state = loadState();
const wanted = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < OBJECTIVES.length)
  : OBJECTIVES.map((_, i) => i).filter(i => !state[i]);

for (const i of wanted) {
  const started = Date.now();
  const probe = await probeAiGeneration(OBJECTIVES[i], { env });
  state[i] = {
    objective: OBJECTIVES[i],
    generated: probe.generated ?? false,
    strategy: probe.strategy ?? null,
    fileCount: probe.fileCount ?? null,
    fidelity: probe.fidelity ?? null,
    perFileErrors: probe.perFileErrors ?? [],
    error: probe.error ?? null,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  };
  saveState(state);
  console.log(
    `app ${i + 1}/${OBJECTIVES.length}: generated=${state[i].generated} strategy=${state[i].strategy ?? '-'} ` +
    `files=${state[i].fileCount ?? '-'} fidelity=${state[i].fidelity?.passed ?? '-'}/${state[i].fidelity?.score ?? '-'} ${state[i].seconds}s`
  );
  // Remaining failures are reported WITH reasons — never silently.
  for (const e of state[i].perFileErrors) console.log(`    FAIL ${e.path} (attempts ${e.attempts}): ${e.reason}`);
  if (!state[i].generated && !state[i].perFileErrors.length && state[i].error) {
    console.log(`    FAIL: ${String(state[i].error).slice(0, 200)}`);
  }
}

const recorded = OBJECTIVES.map((_, i) => state[i]).filter(Boolean);
const ok = recorded.filter(r => r.generated).length;
if (recorded.length) {
  console.log(`\nMULTI-APP generation, live Groq path: ${ok}/${recorded.length} generated (${Math.round((100 * ok) / recorded.length)}% success)`);
  console.log('strategies:', recorded.map(r => r.strategy ?? 'failed').join(', '));
} else {
  console.log('\nNothing measured yet (all apps already journaled — delete ' + STATE_PATH + ' to start over)');
}
