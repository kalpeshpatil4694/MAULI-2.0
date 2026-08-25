import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask, recoverRunningExecutions } from '../src/execution.js';
import { createTask } from '../src/tasks.js';
import { registerAgent } from '../src/agents.js';
import { registerTool } from '../src/tools.js';
import { recoverFailure, recoverOrphanedExecutions } from '../src/recovery.js';
import { store } from '../src/store.js';

test('running execution recovery remains idempotent', async () => {
  const task = { id:`recovery_${Date.now()}`, executor:'internal.plan' };
  const first = await executeTask(task);
  assert.equal(first.state,'completed');
  assert.deepEqual(recoverRunningExecutions(),[]);
});

test('timeout recovery retries and eventually escalates safely', () => {
  const task = createTask({projectId:'recovery-project',title:'timeout recovery',maxAttempts:3});
  const retry = recoverFailure(task,{error:new Error('Execution timed out after 100ms'),attempt:1});
  assert.equal(retry.action,'retry');
  assert.equal(retry.classification,'timeout');
  const final = recoverFailure(task,{error:new Error('Execution timed out after 100ms'),attempt:3});
  assert.equal(final.action,'escalate');
});

test('agent failure can select a different capable agent', () => {
  const first = registerAgent({name:'Recovery Agent A',role:'Engineer',capabilities:['recovery-coding'],tools:['code.execute']});
  const second = registerAgent({name:'Recovery Agent B',role:'Engineer',capabilities:['recovery-coding'],tools:['code.execute']});
  const task = createTask({projectId:'recovery-project',title:'agent recovery',requiredCapabilities:['recovery-coding'],requiredTools:['code.execute'],assignedAgentId:first.id});
  const recovery = recoverFailure({...task,agentId:first.id,assignedAgentId:first.id},{error:new Error('agent failed during execution'),attempt:1});
  assert.equal(recovery.action,'retry');
  assert.equal(recovery.replacementAgentId,second.id);
});

test('tool failure can select a capability-compatible replacement', () => {
  registerTool({name:'recovery.primary',description:'primary',risk:'read',capabilities:['recovery-search'],handler:()=>({ok:true})});
  registerTool({name:'recovery.backup',description:'backup',risk:'read',capabilities:['recovery-search'],handler:()=>({ok:true})});
  const task = createTask({projectId:'recovery-project',title:'tool recovery',requiredCapabilities:['recovery-search'],requiredTools:['recovery.primary']});
  const recovery = recoverFailure(task,{error:new Error('Tool execution failed: recovery.primary'),attempt:1});
  assert.equal(recovery.action,'retry');
  assert.equal(recovery.replacementTool,'recovery.backup');
});

test('dependency recovery blocks and orphan recovery closes stale runs', () => {
  const dependency=createTask({projectId:'recovery-project',title:'dependency'});
  const task=createTask({projectId:'recovery-project',title:'dependent',dependsOn:[dependency.id]});
  const blocked=recoverFailure(task,{error:new Error('dependency incomplete'),attempt:1});
  assert.equal(blocked.action,'block');
  const run=store.put('runs',{id:'run_orphan_batch3',taskId:task.id,state:'running',startedAt:new Date(Date.now()-11*60*1000).toISOString()});
  const recovered=recoverOrphanedExecutions({staleAfterMs:10*60*1000});
  assert.ok(recovered.some(item=>item.id===run.id&&item.state==='failed'));
});
