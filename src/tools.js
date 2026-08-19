import { id, now } from './core.js';
import { store } from './store.js';

export const TOOL_RISK = { read: 'low', write: 'high', destructive: 'critical', external: 'high' };
const runtimeHandlers = new Map();

export function registerTool({ name, description, risk = 'read', handler, capabilities = [], scope = 'internal', allowedAgents = [], allowedProjects = [] }) {
  if (!name || typeof name !== 'string') throw new Error('Tool name is required');
  if (!Object.prototype.hasOwnProperty.call(TOOL_RISK, risk)) throw new Error(`Unknown tool risk: ${risk}`);
  const tool = store.put('tools', { id: id('tool'), name, description, risk, capabilities, scope, allowedAgents, allowedProjects, enabled: true, registeredAt: now() });
  if (typeof handler === 'function') runtimeHandlers.set(name, handler);
  return tool;
}

export function listTools() { return store.list('tools').filter(tool => tool.enabled !== false); }

export function selectTools(requiredCapabilities = [], options = {}) {
  const required = [...new Set(requiredCapabilities)];
  return listTools()
    .filter(tool => !options.scope || tool.scope === options.scope)
    .filter(tool => !options.maxRisk || ['read','write','destructive','external'].indexOf(tool.risk) <= ['read','write','destructive','external'].indexOf(options.maxRisk))
    .map(tool => {
      const matched = required.filter(cap => (tool.capabilities ?? []).includes(cap));
      const score = required.length === 0 ? 1 : matched.length * 100 + (matched.length === required.length ? 50 : 0);
      return { tool, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map(x => x.tool);
}

export function toolsForTask(task, options = {}) {
  return selectTools(task?.requiredCapabilities ?? [], options).map(tool => tool.name);
}

function agentAllowed(tool, context) {
  if (!tool.allowedAgents?.length) return true;
  return Boolean(context.agentId && tool.allowedAgents.includes(context.agentId));
}
function projectAllowed(tool, context) {
  if (!tool.allowedProjects?.length) return true;
  return Boolean(context.projectId && tool.allowedProjects.includes(context.projectId));
}

export function authorizeTool(tool, context = {}) {
  if (!agentAllowed(tool, context)) return { ok: false, reason: 'agent_not_authorized' };
  if (!projectAllowed(tool, context)) return { ok: false, reason: 'project_not_authorized' };
  if (tool.scope === 'external' && !context.allowExternal) return { ok: false, reason: 'external_scope_denied' };
  if (tool.risk !== 'read' && !context.approved) return { ok: false, reason: 'approval_required' };
  if (tool.risk === 'destructive' && !context.approvalId) return { ok: false, reason: 'explicit_approval_id_required' };
  return { ok: true };
}

export async function executeTool(name, input = {}, context = {}) {
  const tool = listTools().find(t => t.name === name);
  if (!tool) throw new Error(`Tool not available: ${name}`);
  const authorization = authorizeTool(tool, context);
  if (!authorization.ok) throw new Error(`Tool authorization denied: ${authorization.reason}`);
  const handler = runtimeHandlers.get(name);
  if (typeof handler !== 'function') return { tool: name, status: 'registered_no_runtime', input };
  const startedAt = now();
  try {
    const result = await handler(input, context);
    store.addEvent('tool.executed', { tool: name, agentId: context.agentId ?? null, projectId: context.projectId ?? null, startedAt, finishedAt: now(), status: 'completed' });
    return result;
  } catch (error) {
    store.addEvent('tool.failed', { tool: name, agentId: context.agentId ?? null, projectId: context.projectId ?? null, startedAt, finishedAt: now(), error: error.message });
    throw error;
  }
}

registerTool({ name: 'health.check', description: 'Returns runtime health', risk: 'read', capabilities: ['diagnostics'], handler: () => ({ healthy: true, at: now() }) });
