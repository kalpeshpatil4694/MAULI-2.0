import { registerTool } from '../tools.js';

const BLOCKED = /(?:rm\s+-rf|mkfs|shutdown|reboot|curl\s+[^\s]+\s*\|\s*(?:sh|bash)|wget\s+[^\s]+\s*\|\s*(?:sh|bash)|chmod\s+\+x\s+.*\/|sudo\s+)/i;

export function validateCodeAction(action = {}) {
  const operation = action.operation || 'inspect';
  const target = String(action.target || '');
  const content = String(action.content || '');
  if (!['inspect', 'create', 'update'].includes(operation)) return { ok: false, reason: 'unsupported_operation' };
  if (!target || target.startsWith('/') || target.includes('..')) return { ok: false, reason: 'unsafe_target' };
  if (BLOCKED.test(content) || BLOCKED.test(target)) return { ok: false, reason: 'blocked_command_pattern' };
  return { ok: true, operation, target };
}

registerTool({
  name: 'code-agent.safe',
  description: 'Plans and validates repository code changes without executing shell commands',
  risk: 'write',
  capabilities: ['code-generation', 'code-editing', 'repository-work'],
  scope: 'internal',
  handler: async (input = {}) => {
    const validation = validateCodeAction(input);
    if (!validation.ok) throw new Error(`Code action denied: ${validation.reason}`);
    return {
      status: 'validated',
      operation: validation.operation,
      target: validation.target,
      content: input.content || '',
      requiresRuntimeExecutor: true
    };
  }
});
