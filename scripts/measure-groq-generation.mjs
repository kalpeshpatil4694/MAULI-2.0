// One-off measurement of the NEW generation path against the real Groq provider.
// Run from the repo root with GROQ_API_KEY present in the environment. Not part of the suite.
import { probeAiGeneration } from '../src/functional-code-executor.js';

const env = {
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  // Force the fallback chain: Workers AI "fails", exactly as it does in production.
  AI: { async run() { throw new Error('4006 daily free allocation exhausted'); } },
};

const objective = 'Build a responsive expense tracker web app with add, filter by month, ' +
  'delete, and monthly totals that persist across refreshes, with a polished dashboard look';

const results = [];
for (let i = 1; i <= 3; i++) {
  const started = Date.now();
  const probe = await probeAiGeneration(objective, { env });
  results.push(probe);
  console.log(
    `run ${i}: generated=${probe.generated} strategy=${probe.strategy ?? '-'} ` +
    `files=${probe.fileCount ?? '-'} fidelity=${probe.fidelity?.passed ?? '-'}/${probe.fidelity?.score ?? '-'} ` +
    `${((Date.now() - started) / 1000).toFixed(1)}s` +
    (probe.error ? ` err=${String(probe.error).slice(0, 90)}` : '')
  );
}

const ok = results.filter(r => r.generated).length;
console.log(`\nWHOLE-APP objective, new path: ${ok}/${results.length} generated`);
console.log('strategies:', results.map(r => r.strategy ?? 'failed').join(', '));
