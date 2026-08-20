import { id, now } from './core.js';
import { store } from './store.js';

export const TOOL_RISK = {
  read: 'low', write: 'high', destructive: 'critical', external: 'high',
  low: 'low', high: 'high', critical: 'critical'
};
const runtimeHandlers = new Map();

function normalizeRisk(risk = 'read') {
  if (risk === 'low') return 'read';
  if (risk === 'high') return 'write';
  if (risk === 'critical') return 'destructive';
  if (['read', 'write', 'destructive', 'external'].includes(risk)) return risk;
  throw new Error(`Unknown tool risk: ${risk}`);
}

export function registerTool({ name, description, risk = 'read', handler, capabilities = [], scope = 'internal', allowedAgents = [], allowedProjects = [] }) {
  if (!name || typeof name !== 'string') throw new Error('Tool name is required');
  const normalizedRisk = normalizeRisk(risk);
  const tool = store.put('tools', { id: id('tool'), name, description, risk: normalizedRisk, capabilities, scope, allowedAgents, allowedProjects, enabled: true, registeredAt: now() });
  if (typeof handler === 'function') runtimeHandlers.set(name, handler);
  return tool;
}

export function listTools() { return store.list('tools').filter(tool => tool.enabled !== false); }

const riskOrder = { read: 0, external: 1, write: 1, destructive: 2 };
export function selectTools(requiredCapabilities = [], options = {}) {
  const required = [...new Set(requiredCapabilities)];
  return listTools()
    .filter(tool => !options.scope || tool.scope === options.scope)
    .filter(tool => options.maxRisk == null || (riskOrder[tool.risk] ?? 99) <= (riskOrder[normalizeRisk(options.maxRisk)] ?? 99))
    .map(tool => { const matched = required.filter(cap => (tool.capabilities ?? []).includes(cap)); const score = required.length === 0 ? 1 : matched.length * 100 + (matched.length === required.length ? 50 : 0); return { tool, score }; })
    .filter(x => x.score > 0).sort((a,b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).map(x => x.tool);
}
export function toolsForTask(task, options = {}) { return selectTools(task?.requiredCapabilities ?? [], options).map(tool => tool.name); }

function agentAllowed(tool, context) { if (!tool.allowedAgents?.length) return true; return Boolean(context.agentId && tool.allowedAgents.includes(context.agentId)); }
function projectAllowed(tool, context) { if (!tool.allowedProjects?.length) return true; return Boolean(context.projectId && tool.allowedProjects.includes(context.projectId)); }

export function authorizeTool(tool, context = {}) {
  const risk = normalizeRisk(tool.risk);
  if (!agentAllowed(tool, context)) return { ok: false, reason: 'Agent not authorized' };
  if (!projectAllowed(tool, context)) return { ok: false, reason: 'Project not authorized' };
  if (tool.scope === 'external' && !context.allowExternal) return { ok: false, reason: 'External scope is not permitted' };
  if (risk !== 'read' && !context.approved) return { ok: false, reason: 'Approval required' };
  if (risk === 'destructive' && !context.approvalId) return { ok: false, reason: 'Approval ID required' };
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
