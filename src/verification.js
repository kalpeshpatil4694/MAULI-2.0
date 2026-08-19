import { id, now } from './core.js';
import { store } from './store.js';

function matchesAcceptance(task, result) {
  const acceptance = Array.isArray(task?.acceptance) ? task.acceptance : [];
  if (acceptance.length === 0) return true;
  if (!result || typeof result !== 'object') return false;

  return acceptance.every(rule => {
    if (typeof rule === 'string') return Object.values(result).some(value => String(value).includes(rule));
    if (!rule || typeof rule !== 'object') return true;
    if (!rule.field) return true;
    const actual = result[rule.field];
    if (Object.prototype.hasOwnProperty.call(rule, 'equals')) return actual === rule.equals;
    if (Object.prototype.hasOwnProperty.call(rule, 'includes')) return String(actual ?? '').includes(String(rule.includes));
    return actual !== undefined && actual !== null;
  });
}

export function verifyResult(task, execution) {
  const checks = [];
  checks.push({ name: 'execution_completed', passed: execution?.state === 'completed' });
  checks.push({ name: 'has_result', passed: execution?.result !== undefined && execution?.result !== null });
  checks.push({ name: 'task_identity', passed: execution?.taskId === task?.id });

  if (task?.agentId != null || task?.assignedAgentId != null) {
    const expectedAgent = task.agentId ?? task.assignedAgentId;
    checks.push({ name: 'agent_identity', passed: execution?.agentId === expectedAgent });
  }

  if (Array.isArray(task?.acceptance) && task.acceptance.length > 0) {
    checks.push({ name: 'acceptance_criteria', passed: matchesAcceptance(task, execution?.result) });
  }

  const passed = checks.every(x => x.passed);
  const result = {
    id: id('verification'),
    taskId: task?.id ?? null,
    executionId: execution?.id ?? null,
    passed,
    checks,
    verifiedAt: now()
  };
  store.put('verifications', result);
  store.addEvent('verification.completed', result);
  return result;
}

export function retryDecision(task, verification, attempt = 1) {
  if (verification.passed) return { action: 'complete', attempt };
  if (attempt < Number(task?.maxAttempts ?? 3)) return { action: 'retry', attempt: attempt + 1 };
  return { action: 'escalate', attempt, reason: 'verification_failed_after_retries' };
}
