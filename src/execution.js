// MAULI 2.0 — execution lifecycle primitives.
// Candidate discovery and stale-run recovery are intentionally separate.

import { id, now } from './core.js';
import { store } from './store.js';
import { executeTool } from './tools.js';
import { startTask, markVerifying, completeTask, failTask } from './tasks.js';
import { verifyResult, retryDecision } from './verification.js';
import { remember } from './memory.js';
import { getExecutor, getExecutorScope } from './executor-registry.js';
import './functional-code-executor.js';

export { registerExecutor, listExecutors, grantExecutor } from './executor-registry.js';

const EXECUTION_LEASE_MS = 90_000;
const MAX_RECOVERY_ATTEMPTS = 3;

function persistExecution(record) {
  store.put('executions', { ...record, status: record.state, executionId: record.id });
  return record;
}
function publicExecution(record) { return { ...record, status: record.state, executionId: record.id }; }
function grantedApprovalForTask(task) { return store.list('approvals').find(a => a.state === 'approved' && (a.taskId === task?.id || (!a.taskId && a.projectId === task?.projectId))) ?? null; }
function latestExecutionForTask(taskId) { return store.list('runs').filter(e => e.taskId === taskId).sort((a,b) => String(b.completedAt ?? b.startedAt ?? '').localeCompare(String(a.completedAt ?? a.startedAt ?? '')))[0] ?? null; }
function completedLifecycleResponse(task) { const execution = latestExecutionForTask(task.id); const verification = execution ? verifyResult(task, execution) : null; return { status: 'completed', task, execution: execution ? publicExecution(execution) : null, verification: verification ?? { passed: true, result: task.result ?? task.output ?? null } }; }
function requiredToolNames(task) { return [...new Set((task?.toolNames ?? task?.requiredTools ?? []).map(String).filter(Boolean))]; }

async function authorizeRequiredTools(task, context, callTool) {
  const results = [];
  for (const name of requiredToolNames(task)) {
    const tool = store.list('tools').find(t => t.name === name && t.enabled !== false);
    if (!tool) throw new Error(`Required tool is not registered: ${name}`);
    results.push({ name, authorization: await callTool(name, { ...context, type: 'authorization-check', taskId: task.id, projectId: task.projectId, approved: Boolean(context.approved), approvalId: context.approvalId ?? null, allowExternal: Boolean(context.allowExternal) }) });
  }
  return results;
}

export function heartbeatExecution(runId) {
  const run = store.get('runs', runId);
  if (!run || run.state !== 'running') return false;
  const timestamp = now();
  store.put('runs', { ...run, heartbeatAt: timestamp, updatedAt: timestamp, id: run.id });
  return true;
}

export async function executeTask(task, context = {}) {
  const executorName = task.executor ?? 'internal.plan';
  const executor = getExecutor(executorName);
  const existing = task.id ? store.list('runs').filter(r => r.taskId === task.id && r.state === 'running').sort((a,b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] : null;
  if (existing && !context.forceRestart) {
    if (isStaleRun(existing)) recoverRun(existing);
    else { heartbeatExecution(existing.id); store.addEvent('execution.recovered', { runId: existing.id, taskId: task.id, executor: executorName }); return publicExecution(existing); }
  }
  const timestamp = now();
  const run = { id: id('run'), taskId: task.id, executor: executorName, state: 'running', startedAt: timestamp, heartbeatAt: timestamp, attempt: context.attempt ?? 1, agentId: task.agentId ?? task.assignedAgentId ?? context.agentId ?? null, recoverable: true };
  store.put('runs', run); store.addEvent('execution.started', run);
  try {
    if (!executor) throw new Error(`No executor registered: ${executorName}`);
    const scope = getExecutorScope(executorName, executor.scope ?? 'internal');
    if (scope === 'external' && !context.allowExternal) throw new Error('External execution permission is not granted');
    if ((executor.risk === 'critical' || task.risk === 'critical') && !context.approved) throw new Error('Critical execution requires explicit approval');
    const callTool = (name, input = {}) => executeTool(name, input, { ...context, agentId: run.agentId, projectId: task.projectId, approved: context.approved, approvalId: context.approvalId });
    const requiredTools = await authorizeRequiredTools(task, { ...context, agentId: run.agentId, projectId: task.projectId }, callTool);
    heartbeatExecution(run.id);
    const result = await executor.handler({ task, ...context, agentId: run.agentId, callTool, requiredTools });
    const timestampDone = now();
    const completed = { ...store.get('runs', run.id) ?? run, state: 'completed', result, requiredTools, completedAt: timestampDone, heartbeatAt: timestampDone, recoverable: false, id: run.id };
    store.put('runs', completed); persistExecution(completed); store.addEvent('execution.completed', completed); return publicExecution(completed);
  } catch (error) {
    const timestampFailed = now();
    const failed = { ...store.get('runs', run.id) ?? run, state: 'failed', error: error?.message ?? String(error), completedAt: timestampFailed, heartbeatAt: timestampFailed, recoverable: false, id: run.id };
    store.put('runs', failed); persistExecution(failed); store.addEvent('execution.failed', failed); return publicExecution(failed);
  }
}

export async function executeTaskLifecycle(task, context = {}) {
  if (!task?.id) return { status: 'failed', error: 'Task is required' };
  let currentTask = store.get('tasks', task.id) ?? task;
  const approval = grantedApprovalForTask(currentTask);
  const lifecycleContext = { ...context, approved: context.approved || Boolean(approval), approvalId: context.approvalId ?? approval?.id };
  if (currentTask.agentId == null && currentTask.assignedAgentId != null) currentTask = store.put('tasks', { ...currentTask, agentId: currentTask.assignedAgentId, id: currentTask.id });
  if (currentTask.state === 'blocked') {
    const ready = (currentTask.dependsOn ?? []).every(depId => store.get('tasks', depId)?.state === 'completed');
    if (!ready && !lifecycleContext.dependenciesComplete) return { status: 'blocked', task: currentTask, reason: currentTask.blockedReason ?? 'Dependencies incomplete' };
    currentTask = store.put('tasks', { ...currentTask, state: 'queued', blockedReason: null, id: currentTask.id });
  }
  if (currentTask.state === 'completed') return completedLifecycleResponse(currentTask);
  if (currentTask.state === 'verifying') return { status: 'verifying', task: currentTask };
  if (currentTask.state !== 'running') startTask(currentTask.id);
  const execution = await executeTask({ ...currentTask, state: 'running' }, lifecycleContext);
  if (execution.state === 'completed') {
    markVerifying(currentTask.id);
    const verification = verifyResult(currentTask, execution);
    if (verification?.passed) { completeTask(currentTask.id, verification.result ?? execution.result); return { status: 'completed', task: store.get('tasks', currentTask.id), execution, verification }; }
    const retry = retryDecision(currentTask, verification, execution.attempt ?? 1);
    if (retry?.action === 'retry') return executeTaskLifecycle(store.get('tasks', currentTask.id) ?? currentTask, { ...lifecycleContext, attempt: (execution.attempt ?? 1) + 1 });
    failTask(currentTask.id, verification?.error ?? 'Verification failed');
    return { status: 'failed', task: store.get('tasks', currentTask.id), execution, verification };
  }
  failTask(currentTask.id, execution.error ?? 'Execution failed');
  return { status: 'failed', task: store.get('tasks', currentTask.id), execution };
}

function isStaleRun(run, at = Date.now()) {
  if (!run || run.state !== 'running') return false;
  const heartbeat = Date.parse(run.heartbeatAt ?? run.startedAt ?? 0);
  return !Number.isFinite(heartbeat) || at - heartbeat > EXECUTION_LEASE_MS;
}

function recoverRun(run) {
  const timestamp = now();
  const task = store.get('tasks', run.taskId);
  store.put('runs', { ...run, state: 'failed', error: 'Execution lease expired; task returned to scheduler recovery.', completedAt: timestamp, recoveredAt: timestamp, recoverable: true, id: run.id });
  if (task && !['completed', 'cancelled'].includes(task.state)) {
    const attempts = Number(task.attempts ?? 0);
    const maxAttempts = Number(task.maxAttempts ?? MAX_RECOVERY_ATTEMPTS);
    const nextState = attempts < maxAttempts ? 'queued' : 'failed';
    store.put('tasks', { ...task, state: nextState, attempts: attempts + 1, blockedReason: nextState === 'queued' ? 'Recovered from stale execution' : task.blockedReason, error: nextState === 'failed' ? 'Execution lease expired after maximum recovery attempts' : task.error, updatedAt: timestamp, id: task.id });
    if (task.assignedAgentId) {
      const agent = store.get('agents', task.assignedAgentId);
      if (agent) store.put('agents', { ...agent, state: 'available', currentTaskId: null, heartbeatAt: timestamp, updatedAt: timestamp, id: agent.id });
    }
  }
  store.addEvent('execution.recovered', { runId: run.id, taskId: run.taskId, at: timestamp });
  return true;
}

// Backward-compatible candidate discovery: ONLY running executions are returned.
// It does not mutate state. Actual stale recovery is performed by recoverStaleExecutions().
export function recoverRunningExecutions() {
  return store.list('runs').filter(run => run.state === 'running').map(run => ({ ...run, status: run.state, executionId: run.id }));
}

export function recoverStaleExecutions() {
  const recovered = [];
  for (const run of store.list('runs').filter(r => r.state === 'running')) {
    if (isStaleRun(run)) { recoverRun(run); recovered.push(run); }
  }
  return recovered;
}

export function schedulerTick() {
  recoverStaleExecutions();
  return store.list('tasks').filter(t => t.state === 'queued').map(t => t.id);
}

export function getExecutorHandler(name) { return getExecutor(name)?.handler ?? null; }
