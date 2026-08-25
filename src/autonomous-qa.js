import { id, now } from './core.js';
import { store } from './store.js';
import { runQualityGate } from './quality-gate.js';
import { verifyResult, retryDecision } from './verification.js';
import { recoverFailure } from './recovery.js';

const pass = (name, details = {}) => ({ name, passed: true, ...details });
const fail = (name, reason, details = {}) => ({ name, passed: false, reason, ...details });

function requirementStage(task, execution) {
  const verification = verifyResult(task, execution);
  return { passed: verification.passed, checks: verification.checks, verification };
}

function securityStage(qualityGate) {
  const checks = qualityGate.checks.filter(check => /secret|eval|dangerous|private_key/i.test(check.name));
  return { passed: checks.every(check => check.passed), checks };
}

function artifactStage(qualityGate) {
  const checks = qualityGate.checks.filter(check => /artifact_(file_count|paths_unique|content_utf8)|unique_paths|files_present|valid_file_records|safe_paths|non_empty_files/i.test(check.name));
  return { passed: checks.length === 0 || checks.every(check => check.passed), checks };
}

function runtimeSmokeStage({ artifact, runtimeSmokeTest }) {
  if (typeof runtimeSmokeTest === 'function') {
    try { const result = runtimeSmokeTest(artifact); return { passed: result === true || result?.passed === true, result }; }
    catch (error) { return { passed: false, result: { error: String(error?.message ?? error) } }; }
  }
  const files = Array.isArray(artifact?.content?.files) ? artifact.content.files : [];
  if (!files.length) return { passed: false, result: fail('runtime_smoke', 'no_artifact_files') };
  const html = files.find(file => String(file.path).toLowerCase() === 'index.html');
  if (html) return { passed: /<html[\s>]/i.test(html.content) && /<body[\s>]/i.test(html.content), result: pass('runtime_smoke', { mode: 'static-html-smoke' }) };
  return { passed: true, result: pass('runtime_smoke', { mode: 'artifact-presence-smoke' }) };
}

function regressionStage(regressionTest) {
  if (typeof regressionTest !== 'function') return { passed: true, result: pass('regression', { mode: 'ci-regression-gate' }) };
  try { const result = regressionTest(); return { passed: result === true || result?.passed === true, result }; }
  catch (error) { return { passed: false, result: { error: String(error?.message ?? error) } }; }
}

export function runAutonomousQA({ task, artifact, execution, runtimeSmokeTest, regressionTest, maxRecoveryAttempts = 1 } = {}) {
  const qaId = id('qa');
  const attempts = [];
  let currentExecution = execution;
  let lastFailure = null;

  for (let attempt = 1; attempt <= Math.max(1, maxRecoveryAttempts + 1); attempt += 1) {
    const qualityGate = runQualityGate(task, artifact, { finalDelivery: true });
    const requirement = requirementStage(task, currentExecution);
    const security = securityStage(qualityGate);
    const artifactIntegrity = artifactStage(qualityGate);
    const runtimeSmoke = runtimeSmokeStage({ artifact, runtimeSmokeTest });
    const regression = regressionStage(regressionTest);
    const stages = {
      build: qualityGate.stages.automatedBuildTest,
      test: regression.passed,
      requirementVerification: requirement.passed,
      security: security.passed,
      artifactIntegrity: artifactIntegrity.passed,
      runtimeSmoke: runtimeSmoke.passed,
      regression: regression.passed,
      finalQA: qualityGate.passed && requirement.passed && security.passed && artifactIntegrity.passed && runtimeSmoke.passed && regression.passed
    };
    const result = { attempt, passed: Object.values(stages).every(Boolean), stages, details: { qualityGate, requirement, security, artifactIntegrity, runtimeSmoke, regression } };
    attempts.push(result);
    if (result.passed) {
      const final = { id: qaId, taskId: task?.id ?? null, passed: true, attempts, completedAt: now() };
      store.put('qaRuns', final); store.addEvent('qa.completed', final); return final;
    }
    lastFailure = result;
    if (attempt > maxRecoveryAttempts) break;
    const failedVerification = result.details.requirement.verification;
    const recovery = recoverFailure(task, { verification: failedVerification, execution: currentExecution, attempt });
    store.addEvent('qa.recovery', { qaId, attempt, action: recovery.action, classification: recovery.classification });
    if (recovery.action === 'escalate' || recovery.action === 'block') break;
    if (typeof task?.qaRetest === 'function') currentExecution = task.qaRetest({ recovery, attempt, execution: currentExecution });
  }

  const final = { id: qaId, taskId: task?.id ?? null, passed: false, attempts, failure: lastFailure, completedAt: now() };
  store.put('qaRuns', final); store.addEvent('qa.failed', final); return final;
}

export function qaRetryDecision(qaRun, maxAttempts = 2) {
  if (qaRun?.passed) return { action: 'complete', attempt: qaRun.attempts?.length ?? 1 };
  const attempt = qaRun?.attempts?.length ?? 1;
  return attempt < maxAttempts ? { action: 'retry', attempt: attempt + 1 } : { action: 'escalate', attempt, reason: 'qa_failed_after_retries' };
}
