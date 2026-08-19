import { id, now } from './core.js';
import { store } from './store.js';

export function verifyResult(task, execution) {
  const checks = [];
  checks.push({ name:'execution_completed', passed: execution?.state === 'completed' });
  checks.push({ name:'has_result', passed: execution?.result !== undefined && execution?.result !== null });
  checks.push({ name:'task_identity', passed: execution?.taskId === task?.id });
  const passed = checks.every(x => x.passed);
  const result = { id:id('verification'), taskId:task.id, executionId:execution?.id ?? null, passed, checks, verifiedAt:now() };
  store.put('verifications', result); store.addEvent('verification.completed', result);
  return result;
}

export function retryDecision(task, verification, attempt = 1) {
  if (verification.passed) return { action:'complete', attempt };
  if (attempt < Number(task.maxAttempts ?? 3)) return { action:'retry', attempt:attempt + 1 };
  return { action:'escalate', attempt, reason:'verification_failed_after_retries' };
}
