import { id, now } from './core.js';
import { store } from './store.js';

export const TOOL_RISK = { read: 'low', write: 'high', destructive: 'critical', external: 'high' };

export function registerTool({ name, description, risk = 'read', handler }) {
  const tool = store.put('tools', { id: id('tool'), name, description, risk, enabled: true });
  if (handler) tool.handler = handler;
  return tool;
}

export function listTools() { return store.list('tools').map(({ handler, ...safe }) => safe); }

export async function executeTool(name, input, context = {}) {
  const tool = store.list('tools').find(t => t.name === name && t.enabled);
  if (!tool) throw new Error(`Tool not available: ${name}`);
  if (tool.risk !== 'read' && !context.approved) throw new Error(`Approval required for ${name}`);
  if (typeof tool.handler !== 'function') return { tool: name, status: 'registered_no_runtime', input };
  const startedAt = now();
  const result = await tool.handler(input, context);
  store.addEvent('tool.executed', { tool: name, startedAt, finishedAt: now(), result });
  return result;
}

registerTool({ name: 'health.check', description: 'Returns runtime health', risk: 'read', handler: () => ({ healthy: true, at: now() }) });
