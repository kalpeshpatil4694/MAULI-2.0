import { id, now } from './core.js';
import { store } from './store.js';

export const TOOL_RISK = { read: 'low', write: 'high', destructive: 'critical', external: 'high' };
const runtimeHandlers = new Map();

export function registerTool({ name, description, risk = 'read', handler, capabilities = [], scope = 'internal' }) {
  if (!name || typeof name !== 'string') throw new Error('Tool name is required');
  if (!Object.prototype.hasOwnProperty.call(TOOL_RISK, risk)) throw new Error(`Unknown tool risk: ${risk}`);
  const tool = store.put('tools', { id: id('tool'), name, description, risk, capabilities, scope, enabled: true, registeredAt: now() });
  if (typeof handler === 'function') runtimeHandlers.set(name, handler);
  return tool;
}

export function listTools() { return store.list('tools'); }

export async function executeTool(name, input = {}, context = {}) {
  const tool = store.list('tools').find(t => t.name === name && t.enabled);
  if (!tool) throw new Error(`Tool not available: ${name}`);
  if (tool.scope === 'external' && !context.allowExternal) throw new Error(`External scope is not permitted for ${name}`);
  if (tool.risk !== 'read' && !context.approved) throw new Error(`Approval required for ${name}`);
  if (tool.risk === 'destructive' && context.approvalId == null) throw new Error(`Explicit approval ID required for destructive tool ${name}`);
  const handler = runtimeHandlers.get(name);
  if (typeof handler !== 'function') return { tool: name, status: 'registered_no_runtime', input };
  const startedAt = now();
  try {
    const result = await handler(input, context);
    store.addEvent('tool.executed', { tool: name, startedAt, finishedAt: now(), status: 'completed' });
    return result;
  } catch (error) {
    store.addEvent('tool.failed', { tool: name, startedAt, finishedAt: now(), error: error.message });
    throw error;
  }
}

registerTool({ name: 'health.check', description: 'Returns runtime health', risk: 'read', capabilities: ['diagnostics'], handler: () => ({ healthy: true, at: now() }) });
