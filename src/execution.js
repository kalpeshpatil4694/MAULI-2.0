import { id, now } from './core.js';
import { store } from './store.js';

const handlers = new Map();
export function registerExecutor(name, handler, meta = {}) { handlers.set(name, { handler, ...meta }); }
export function listExecutors() { return [...handlers.entries()].map(([name, x]) => ({ name, description:x.description ?? '', risk:x.risk ?? 'normal' })); }

export async function executeTask(task, context = {}) {
  const executorName = task.executor ?? 'internal.plan';
  const executor = handlers.get(executorName);
  const startedAt = now();
  const run = { id:id('run'), taskId:task.id, executor:executorName, state:'running', startedAt };
  store.put('runs', run); store.addEvent('execution.started', run);
  try {
    if (!executor) throw new Error(`No executor registered: ${executorName}`);
    const result = await executor.handler({ task, ...context });
    const completed = { ...run, state:'completed', result, completedAt:now() };
    store.put('runs', completed); store.addEvent('execution.completed', completed);
    return completed;
  } catch (error) {
    const failed = { ...run, state:'failed', error:error.message, completedAt:now() };
    store.put('runs', failed); store.addEvent('execution.failed', failed);
    return failed;
  }
}

registerExecutor('internal.plan', async ({ task }) => ({ type:'plan', taskId:task.id, output:'Execution plan generated; specialist execution can continue after verification.' }), { description:'Safe internal planning executor', risk:'low' });
