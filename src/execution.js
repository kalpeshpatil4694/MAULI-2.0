import { id, now } from './core.js';
import { store } from './store.js';
import { executeTool } from './tools.js';

const handlers = new Map();
const permissions = new Map();

export function registerExecutor(name, handler, meta = {}) {
  if (!name || typeof handler !== 'function') throw new Error('Executor name and handler are required');
  handlers.set(name, { handler, ...meta });
}
export function listExecutors() { return [...handlers.entries()].map(([name, x]) => ({ name, description:x.description ?? '', risk:x.risk ?? 'normal', capabilities:x.capabilities ?? [] })); }
export function grantExecutor(name, scope = 'internal') { permissions.set(name, scope); return { name, scope }; }

export async function executeTask(task, context = {}) {
  const executorName = task.executor ?? 'internal.plan';
  const executor = handlers.get(executorName);
  const startedAt = now();
  const run = { id:id('run'), taskId:task.id, executor:executorName, state:'running', startedAt, attempt:context.attempt ?? 1 };
  store.put('runs', run); store.addEvent('execution.started', run);
  try {
    if (!executor) throw new Error(`No executor registered: ${executorName}`);
    const scope = permissions.get(executorName) ?? executor.scope ?? 'internal';
    if (scope === 'external' && !context.allowExternal) throw new Error('External execution permission is not granted');
    if ((executor.risk === 'critical' || task.risk === 'critical') && !context.approved) throw new Error('Critical execution requires explicit approval');
    const result = await executor.handler({ task, ...context, callTool: (name, input = {}) => executeTool(name, input, context) });
    const completed = { ...run, state:'completed', result, completedAt:now() };
    store.put('runs', completed); store.addEvent('execution.completed', completed);
    return completed;
  } catch (error) {
    const failed = { ...run, state:'failed', error:error.message, completedAt:now() };
    store.put('runs', failed); store.addEvent('execution.failed', failed);
    return failed;
  }
}

registerExecutor('internal.plan', async ({ task, callTool }) => ({ type:'plan', taskId:task.id, output:'Execution plan generated.', diagnostics:await callTool('health.check') }), { description:'Safe internal planning executor', risk:'low', scope:'internal' });
grantExecutor('internal.plan', 'internal');
