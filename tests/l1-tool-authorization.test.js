import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeTool } from '../src/tools.js';

test('L1 tool authorization allows an explicitly authorized agent and project', () => {
  const tool = { name: 'test.tool', risk: 'read', scope: 'internal', allowedAgents: ['agent-1'], allowedProjects: ['project-1'] };
  assert.deepEqual(authorizeTool(tool, { agentId: 'agent-1', projectId: 'project-1' }), { ok: true });
});

test('L1 tool authorization blocks wrong project', () => {
  const tool = { name: 'test.tool', risk: 'read', scope: 'internal', allowedAgents: ['agent-1'], allowedProjects: ['project-1'] };
  assert.equal(authorizeTool(tool, { agentId: 'agent-1', projectId: 'project-2' }).ok, false);
});

test('L1 tool authorization requires approval for write tools', () => {
  const tool = { name: 'write.tool', risk: 'write', scope: 'internal' };
  assert.equal(authorizeTool(tool, { agentId: 'agent-1', projectId: 'project-1' }).reason, 'approval_required');
});

test('L1 destructive tools require an explicit approval ID', () => {
  const tool = { name: 'delete.tool', risk: 'destructive', scope: 'internal' };
  assert.equal(authorizeTool(tool, { approved: true }).reason, 'explicit_approval_id_required');
  assert.deepEqual(authorizeTool(tool, { approved: true, approvalId: 'approval-1' }), { ok: true });
});
