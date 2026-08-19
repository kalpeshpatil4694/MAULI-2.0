import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, executeTool } from '../src/tools.js';

test('read-only tool can execute for an authorized agent', async () => {
  const name = `read_${Date.now()}`;
  registerTool({ name, description:'test', risk:'read', allowedAgents:['agent_a'], handler:() => ({ok:true}) });
  const result = await executeTool(name, {}, { agentId:'agent_a' });
  assert.equal(result.ok, true);
});

test('agent outside allow-list is blocked', async () => {
  const name = `restricted_${Date.now()}`;
  registerTool({ name, description:'test', risk:'read', allowedAgents:['agent_a'], handler:() => ({ok:true}) });
  await assert.rejects(() => executeTool(name, {}, { agentId:'agent_b' }), /not authorized/);
});

test('write tool requires approval', async () => {
  const name = `write_${Date.now()}`;
  registerTool({ name, description:'test', risk:'write', handler:() => ({ok:true}) });
  await assert.rejects(() => executeTool(name, {}, { agentId:'agent_a' }), /Approval required/);
  const result = await executeTool(name, {}, { agentId:'agent_a', approved:true });
  assert.equal(result.ok, true);
});

test('destructive tool requires explicit approval id', async () => {
  const name = `destroy_${Date.now()}`;
  registerTool({ name, description:'test', risk:'destructive', handler:() => ({ok:true}) });
  await assert.rejects(() => executeTool(name, {}, { agentId:'agent_a', approved:true }), /Explicit approval ID/);
  const result = await executeTool(name, {}, { agentId:'agent_a', approved:true, approvalId:'approval_1' });
  assert.equal(result.ok, true);
});
