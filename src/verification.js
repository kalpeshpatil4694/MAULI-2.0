import { id, now } from './core.js';
import { store } from './store.js';

function matchesAcceptance(task, result) {
  const acceptance = Array.isArray(task?.acceptance) ? task.acceptance : [];
  if (acceptance.length === 0) return { passed: true, checks: [] };
  if (!result || typeof result !== 'object') return { passed: false, checks: acceptance.map(rule => ({ rule, passed: false, reason: 'missing_result' })) };

  const checks = acceptance.map(rule => {
    if (typeof rule === 'string') {
      const needle = rule.toLowerCase().trim();
      const values = Object.values(result).map(value => String(value ?? '').toLowerCase());
      let passed = values.some(value => value.includes(needle));
      if (!passed && needle.includes('clear requirements')) passed = Boolean(task?.description || task?.projectId || task?.title);
      if (!passed && needle.includes('execution plan')) passed = result.type === 'plan' || values.some(value => value.includes('plan'));
      if (!passed && needle.includes('verification')) passed = result.type === 'verification' || values.some(value => value.includes('verif'));
      return { rule, passed, mode: 'text-match' };
    }
    if (!rule || typeof rule !== 'object') return { rule, passed: true, mode: 'ignored' };
    if (!rule.field) return { rule, passed: true, mode: 'ignored' };
    const actual = result[rule.field];
    if (Object.prototype.hasOwnProperty.call(rule, 'equals')) return { rule, passed: actual === rule.equals, actual, mode: 'equals' };
    if (Object.prototype.hasOwnProperty.call(rule, 'includes')) return { rule, passed: String(actual ?? '').toLowerCase().includes(String(rule.includes).toLowerCase()), actual, mode: 'includes' };
    return { rule, passed: actual !== undefined && actual !== null, actual, mode: 'exists' };
  });
  return { passed: checks.every(x => x.passed), checks };
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

  const acceptance = matchesAcceptance(task, execution?.result);
  if (Array.isArray(task?.acceptance) && task.acceptance.length > 0) checks.push({ name: 'acceptance_criteria', passed: acceptance.passed, details: acceptance.checks });

  const passed = checks.every(x => x.passed);
  const result = { id: id('verification'), taskId: task?.id ?? null, executionId: execution?.id ?? null, passed, checks, verifiedAt: now() };
  store.put('verifications', result);
  store.addEvent('verification.completed', result);
  return result;
}

export function retryDecision(task, verification, attempt = 1) {
  if (verification.passed) return { action: 'complete', attempt };
  if (attempt < Number(task?.maxAttempts ?? 3)) return { action: 'retry', attempt: attempt + 1 };
  return { action: 'escalate', attempt, reason: 'verification_failed_after_retries' };
}
