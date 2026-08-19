import { id, now } from './core.js';
import { store } from './store.js';
import { executeTool } from './tools.js';
import { code } from './ai.js';
import { startTask, markVerifying, completeTask, failTask } from './tasks.js';
import { verifyResult, retryDecision } from './verification.js';

const handlers = new Map();
const permissions = new Map();

export function registerExecutor(name, handler, meta = {}) {
  if (!name || typeof handler !== 'function') throw new Error('Executor name and handler are required');
  handlers.set(name, { handler, ...meta });
}

export function listExecutors() {
  return [...handlers.entries()].map(([name, x]) => ({ name, description: x.description ?? '', risk: x.risk ?? 'normal', capabilities: x.capabilities ?? [] }));
}

export function grantExecutor(name, scope = 'internal') {
  permissions.set(name, scope);
  return { name, scope };
}

export async function executeTask(task, context = {}) {
  const executorName = task.executor ?? 'internal.plan';
  const executor = handlers.get(executorName);
  const existing = task.id ? store.list('runs').filter(r => r.taskId === task.id && r.state === 'running').sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] : null;
  if (existing && !context.forceRestart) {
    store.addEvent('execution.recovered', { runId: existing.id, taskId: task.id, executor: executorName });
    return existing;
  }
  const run = { id: id('run'), taskId: task.id, executor: executorName, state: 'running', startedAt: now(), attempt: context.attempt ?? 1, agentId: task.agentId ?? task.assignedAgentId ?? context.agentId ?? null, recoverable: true };
  store.put('runs', run);
  store.addEvent('execution.started', run);
  try {
    if (!executor) throw new Error(`No executor registered: ${executorName}`);
    const scope = permissions.get(executorName) ?? executor.scope ?? 'internal';
    if (scope === 'external' && !context.allowExternal) throw new Error('External execution permission is not granted');
    if ((executor.risk === 'critical' || task.risk === 'critical') && !context.approved) throw new Error('Critical execution requires explicit approval');
    const result = await executor.handler({ task, ...context, callTool: (name, input = {}) => executeTool(name, input, context) });
    const completed = { ...run, state: 'completed', result, completedAt: now(), recoverable: false };
    store.put('runs', completed);
    store.addEvent('execution.completed', completed);
    return completed;
  } catch (error) {
    const failed = { ...run, state: 'failed', error: error.message, completedAt: now(), recoverable: false };
    store.put('runs', failed);
    store.addEvent('execution.failed', failed);
    return failed;
  }
}

export async function executeTaskLifecycle(task, context = {}) {
  if (!task?.id) return { status: 'failed', error: 'Task is required' };
  let currentTask = store.get('tasks', task.id) ?? task;
  if (currentTask.agentId == null && currentTask.assignedAgentId != null) currentTask = store.put('tasks', { ...currentTask, agentId: currentTask.assignedAgentId, id: currentTask.id });
  if (currentTask.state === 'queued' || currentTask.state === 'assigned' || currentTask.state === 'blocked') {
    if (currentTask.state === 'blocked' && !context.dependenciesComplete) return { status: 'blocked', task: currentTask, reason: currentTask.blockedReason ?? 'Dependencies incomplete' };
    currentTask = startTask(currentTask.id) ?? currentTask;
  }
  let attempt = Math.max(1, Number(currentTask.attempts ?? 1));
  let execution = await executeTask(currentTask, { ...context, attempt, agentId: currentTask.agentId ?? context.agentId });
  let verification = verifyResult(currentTask, execution);
  currentTask = markVerifying(currentTask.id, execution.result ?? { error: execution.error }) ?? currentTask;
  while (!verification.passed) {
    const decision = retryDecision(currentTask, verification, attempt);
    if (decision.action !== 'retry') {
      const failed = failTask(currentTask.id, execution.error ?? decision.reason) ?? currentTask;
      store.addEvent('task.escalated', { taskId: failed.id, executionId: execution.id, verificationId: verification.id, reason: decision.reason ?? 'verification_failed' });
      return { status: 'escalated', task: failed, execution, verification, decision };
    }
    attempt = decision.attempt;
    currentTask = startTask(currentTask.id) ?? currentTask;
    execution = await executeTask(currentTask, { ...context, retry: true, attempt, forceRestart: true, agentId: currentTask.agentId ?? context.agentId });
    verification = verifyResult(currentTask, execution);
    currentTask = markVerifying(currentTask.id, execution.result ?? { error: execution.error }) ?? currentTask;
  }
  const completed = completeTask(currentTask.id, execution.result ?? {}) ?? currentTask;
  store.addEvent('task.execution_lifecycle_completed', { taskId: completed.id, executionId: execution.id, verificationId: verification.id, attempts: completed.attempts });
  return { status: 'completed', task: completed, execution, verification };
}

export function recoverRunningExecutions() {
  return store.list('runs').filter(run => run.state === 'running').map(run => { store.addEvent('execution.recovery_candidate', { runId: run.id, taskId: run.taskId, executor: run.executor }); return run; });
}

registerExecutor('internal.plan', async ({ task, callTool }) => ({ type: 'plan', taskId: task.id, output: 'Execution plan generated.', diagnostics: await callTool('health.check') }), { description: 'Safe internal planning executor', risk: 'low', scope: 'internal' });
grantExecutor('internal.plan', 'internal');

/**
 * Free/open-model coding executor. It generates a structured workspace artifact
 * instead of directly mutating external systems. External writes remain behind
 * the Tool Registry and approval boundary.
 */
registerExecutor('internal.code', async ({ task, env }) => {
  if (!env) throw new Error('AI runtime environment is required for coding');
  const prompt = [
    'You are the MAULI Coding Agent.',
    'Produce implementation artifacts for the task.',
    'Return JSON only with this schema:',
    '{"summary":string,"files":[{"path":string,"content":string}],"tests":[string],"notes":[string]}',
    'Do not claim that files were written or tests were executed.',
    `Task: ${task.title ?? 'Coding task'}`,
    `Objective: ${task.description ?? ''}`,
    `Required capabilities: ${(task.requiredCapabilities ?? []).join(', ')}`,
    `Acceptance criteria: ${JSON.stringify(task.acceptance ?? [])}`
  ].join('\n');

  const raw = await code(env, [{ role: 'system', content: 'Generate safe, minimal, production-oriented code artifacts.' }, { role: 'user', content: prompt }]);
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { parsed = { summary: 'Code artifact generated as raw model output.', files: [], tests: [], notes: [String(raw)] }; }
  const files = Array.isArray(parsed?.files) ? parsed.files.filter(file => file && typeof file.path === 'string' && typeof file.content === 'string') : [];
  const artifact = store.put('artifacts', {
    id: id('artifact'),
    taskId: task.id,
    kind: 'code-workspace',
    summary: String(parsed?.summary ?? 'Code artifact'),
    files,
    tests: Array.isArray(parsed?.tests) ? parsed.tests : [],
    notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
    generatedAt: now()
  });
  store.addEvent('artifact.generated', { artifactId: artifact.id, taskId: task.id, fileCount: files.length });
  return { type: 'code', artifactId: artifact.id, summary: artifact.summary, files: artifact.files, tests: artifact.tests, notes: artifact.notes };
}, { description: 'Generates code workspace artifacts using the MAULI Intelligence Bus', risk: 'low', scope: 'internal', capabilities: ['coding', 'software-development'] });
grantExecutor('internal.code', 'internal');
