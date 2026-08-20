import { now } from './core.js';
import { store } from './store.js';
import { validateCodeAction } from './tools/code-agent.js';

/**
 * L1 runtime boundary.
 * Zero-cost Worker-safe mode deliberately does not execute arbitrary shell/code.
 * It validates an approved change and returns an execution plan that a future
 * sandbox/container adapter can consume.
 */
export async function executeCodeAction(action = {}, context = {}) {
  const validation = validateCodeAction(action);
  if (!validation.ok) throw new Error(`Runtime action denied: ${validation.reason}`);
  if (!context.approved) throw new Error('Runtime execution requires approval');

  const result = {
    status: 'planned',
    mode: 'controlled-plan',
    operation: validation.operation,
    target: validation.target,
    requiresSandbox: true,
    at: now()
  };

  store.addEvent('runtime.execution_planned', {
    operation: validation.operation,
    target: validation.target,
    agentId: context.agentId ?? null,
    projectId: context.projectId ?? null
  });

  return result;
}
