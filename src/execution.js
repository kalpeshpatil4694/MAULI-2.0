import { id, now } from './core.js';
import { store } from './store.js';
import { executeTool } from './tools.js';
import { startTask, markVerifying, completeTask, failTask } from './tasks.js';
import { verifyResult, retryDecision } from './verification.js';

const handlers = new Map();
const permissions = new Map();

export function registerExecutor(name, handler, meta = {}) {
  if (!name || typeof handler !== 'function') throw new Error('Executor name and handler are required');
  handlers.set(name, { handler, ...meta });
}

export function listExecutors() {
  return [...handlers.entries()].map(([name, x]) => ({
    name,
    description: x.description ?? '',
    risk: x.risk ?? 'normal',
    capabilities: x.capabilities ?? []
  }));
}

export function grantExecutor(name, scope = 'internal') {
  permissions.set(name, scope);
  return { name, scope };
}

export async function executeTask(task, context = {}) {
  const executorName = task.executor ?? 'internal.plan';
  const executor = handlers.get(executorName);
  const existing = task.id
    ? store.list('runs')
        .filter(r => r.taskId === task.id && r.state === 'running')
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0]
    : null;

  if (existing && !context.forceRestart) {
    store.addEvent('execution.recovered', { runId: existing.id, taskId: task.id, executor: executorName });
    return existing;
  }

  const startedAt = now();
  const run = {
    id: id('run'),
    taskId: task.id,
    executor: executorName,
    state: 'running',
    startedAt,
    attempt: context.attempt ?? 1,
    recoverable: true
  };
  store.put('runs', run);
  store.addEvent('execution.started', run);

  try {
    if (!executor) throw new Error(`No executor registered: ${executorName}`);
    const scope = permissions.get(executorName) ?? executor.scope ?? 'internal';
    if (scope === 'external' && !context.allowExternal) throw new Error('External execution permission is not granted');
    if ((executor.risk === 'critical' || task.risk === 'critical') && !context.approved) throw new Error('Critical execution requires explicit approval');

    const result = await executor.handler({
      task,
      ...context,
      callTool: (name, input = {}) => executeTool(name, input, context)
    });

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
  if (currentTask.state !== 'working') {
    currentTask = startTask(currentTask.id) ?? currentTask;
  }

  let attempt = Number(currentTask.attempts ?? 1);
  let execution = await executeTask(currentTask, { ...context, attempt });
  let verification = verifyResult(currentTask, execution);
  currentTask = markVerifying(currentTask.id, execution.result ?? { error: execution.error }) ?? currentTask;

  while (!verification.passed) {
    const decision = retryDecision(currentTask, verification, attempt);
    if (decision.action !== 'retry') {
      const failed = failTask(currentTask.id, execution.error ?? decision.reason) ?? currentTask;
      store.addEvent('task.escalated', {
        taskId: failed.id,
        executionId: execution.id,
        verificationId: verification.id,
        reason: decision.reason ?? 'verification_failed'
      });
      return { status: 'escalated', task: failed, execution, verification, decision };
    }

    attempt = decision.attempt;
    currentTask = startTask(currentTask.id) ?? currentTask;
    execution = await executeTask(currentTask, {
      ...context,
      retry: true,
      attempt,
      forceRestart: true
    });
    verification = verifyResult(currentTask, execution);
    currentTask = markVerifying(currentTask.id, execution.result ?? { error: execution.error }) ?? currentTask;
  }

  const completed = completeTask(currentTask.id, execution.result ?? {}) ?? currentTask;
  store.addEvent('task.execution_lifecycle_completed', {
    taskId: completed.id,
    executionId: execution.id,
    verificationId: verification.id,
    attempts: completed.attempts
  });
  return { status: 'completed', task: completed, execution, verification };
}

export function recoverRunningExecutions() {
  return store.list('runs').filter(run => run.state === 'running').map(run => {
    store.addEvent('execution.recovery_candidate', { runId: run.id, taskId: run.taskId, executor: run.executor });
    return run;
  });
}

registerExecutor(
  'internal.plan',
  async ({ task, callTool }) => ({
    type: 'plan',
    taskId: task.id,
    output: 'Execution plan generated.',
    diagnostics: await callTool('health.check')
  }),
  { description: 'Safe internal planning executor', risk: 'low', scope: 'internal' }
);
grantExecutor('internal.plan', 'internal');
