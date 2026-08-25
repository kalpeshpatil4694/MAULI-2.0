import { now } from './core.js';
import { store } from './store.js';
import { selectAgents } from './agents.js';

export const RECOVERY_CLASSES = ['timeout','tool_failure','agent_failure','dependency_blocked','orphaned_execution','execution_failure','verification_failure','unknown'];

export function classifyFailure({ error, verification, execution } = {}) {
  const text = String(error?.message ?? error ?? execution?.error ?? '').toLowerCase();
  if (text.includes('timeout') || text.includes('timed out')) return 'timeout';
  if (text.includes('tool ') || text.includes('tool authorization') || text.includes('required tool')) return 'tool_failure';
  if (text.includes('agent') && (text.includes('failed') || text.includes('unavailable') || text.includes('not available'))) return 'agent_failure';
  if (text.includes('dependenc')) return 'dependency_blocked';
  if (execution?.state === 'running') return 'orphaned_execution';
  if (verification && !verification.passed) return 'verification_failure';
  if (text) return 'execution_failure';
  return 'unknown';
}

function alternativeAgent(task) {
  const requiredTools = Array.isArray(task?.requiredTools) && task.requiredTools.length ? task.requiredTools : (task?.toolNames ?? []);
  return selectAgents(task?.requiredCapabilities ?? [], null, {
    requiredTools,
    requireAllTools: true,
    allowCooldownFallback: false
  }).find(agent => agent.id !== task?.agentId && agent.id !== task?.assignedAgentId) ?? null;
}

function alternativeTool(task) {
  const required = new Set(task?.requiredCapabilities ?? []);
  const current = new Set((task?.requiredTools ?? task?.toolNames ?? []).map(String));
  const candidates = store.list('tools').filter(tool => tool.enabled !== false && !current.has(tool.name));
  return candidates
    .map(tool => ({ tool, score: [...required].filter(cap => (tool.capabilities ?? []).includes(cap)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))[0]?.tool ?? null;
}

export function recoverFailure(task, { error, verification, execution, attempt = 1 } = {}) {
  const classification = classifyFailure({ error, verification, execution });
  const maxAttempts = Math.max(1, Number(task?.maxAttempts ?? 3));
  const base = { taskId: task?.id ?? null, classification, attempt, at: now() };

  if (classification === 'dependency_blocked') {
    const unresolved = (task?.dependsOn ?? []).filter(id => store.get('tasks', id)?.state !== 'completed');
    store.addEvent('recovery.dependency_blocked', { ...base, dependencies: unresolved });
    return { action: 'block', ...base, dependencies: unresolved, reason: 'Dependencies incomplete' };
  }

  if (classification === 'tool_failure') {
    const replacement = alternativeTool(task);
    if (replacement) {
      const tools = Array.isArray(task.requiredTools) && task.requiredTools.length ? task.requiredTools : (task.toolNames ?? []);
      const replaced = tools.length ? [...tools.slice(0, -1), replacement.name] : [replacement.name];
      store.addEvent('recovery.tool_replaced', { ...base, replacementTool: replacement.name });
      return { action: 'retry', ...base, replacementTool: replacement.name, requiredTools: [...new Set(replaced)], reason: 'Alternative tool selected' };
    }
  }

  if (classification === 'agent_failure') {
    const replacement = alternativeAgent(task);
    if (replacement) {
      store.addEvent('recovery.agent_replaced', { ...base, replacementAgentId: replacement.id });
      return { action: 'retry', ...base, replacementAgentId: replacement.id, reason: 'Alternative capable agent selected' };
    }
  }

  if (attempt < maxAttempts) {
    store.addEvent('recovery.retry', { ...base, reason: classification });
    return { action: 'retry', ...base, reason: classification === 'timeout' ? 'Timeout recovery retry' : 'Recovery retry' };
  }

  store.addEvent('recovery.escalated', { ...base, reason: 'No safe recovery remained' });
  return { action: 'escalate', ...base, reason: 'No safe recovery remained' };
}

export function recoverOrphanedExecutions({ staleAfterMs = 10 * 60 * 1000 } = {}) {
  const nowMs = Date.now();
  const recovered = [];
  for (const run of store.list('runs').filter(item => item.state === 'running')) {
    const started = Date.parse(run.startedAt ?? '');
    if (Number.isFinite(started) && nowMs - started < staleAfterMs) continue;
    const failed = store.put('runs', { ...run, state: 'failed', error: 'Orphaned execution recovered', recoverable: true, recoveredAt: now() });
    store.put('executions', { ...failed, status: 'failed', executionId: failed.id });
    store.addEvent('recovery.orphaned', { runId: run.id, taskId: run.taskId, reason: 'stale_running_execution' });
    recovered.push(failed);
  }
  return recovered;
}
