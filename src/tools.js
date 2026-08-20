export function authorizeTool(tool, context = {}) {
  if (!agentAllowed(tool, context)) return { ok: false, reason: 'agent_not_authorized' };
  if (!projectAllowed(tool, context)) return { ok: false, reason: 'project_not_authorized' };
  if (tool.scope === 'external' && !context.allowExternal) return { ok: false, reason: 'External scope permission required' };
  if (tool.risk !== 'read' && !context.approved) return { ok: false, reason: 'Approval required' };
  if (tool.risk === 'destructive' && !context.approvalId) return { ok: false, reason: 'Approval ID required' };
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
