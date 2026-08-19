import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, executeTool } from '../src/tools.js';

test('read tool can execute without approval', async () => {
  registerTool({name:'test.read',description:'test read',risk:'read',handler:()=>({ok:true})});
  assert.deepEqual(await executeTool('test.read'),{ok:true});
});

test('write tool requires approval', async () => {
  registerTool({name:'test.write',description:'test write',risk:'write',handler:()=>({ok:true})});
  await assert.rejects(()=>executeTool('test.write'),/Approval required/);
  assert.deepEqual(await executeTool('test.write',{}, {approved:true}),{ok:true});
});

test('agent allow-list is enforced', async () => {
  registerTool({name:'test.restricted',description:'restricted',risk:'read',allowedAgents:['agent-allowed'],handler:()=>({ok:true})});
  await assert.rejects(()=>executeTool('test.restricted',{}, {agentId:'agent-denied'}),/not authorized/);
  assert.deepEqual(await executeTool('test.restricted',{}, {agentId:'agent-allowed'}),{ok:true});
});

test('external tool requires external permission', async () => {
  registerTool({name:'test.external-tool',description:'external',risk:'external',scope:'external',handler:()=>({ok:true})});
  await assert.rejects(()=>executeTool('test.external-tool',{}, {approved:true,allowExternal:false}),/External scope is not permitted/);
  assert.deepEqual(await executeTool('test.external-tool',{}, {approved:true,allowExternal:true}),{ok:true});
});
