import { store } from './store.js';
import { registerAgent, listAgents } from './agents.js';
import { recordAgentTaskLearning } from './agent-learning.js';
import { recoverFailure } from './recovery.js';

export function runAgentRecoverySelfTest() {
  const checks=[];
  const check=(name,passed,details='')=>checks.push({name,passed:Boolean(passed),details});
  const before=listAgents().length;
  const a=registerAgent({name:'SelfTest Failing Specialist',role:'Engineer',department:'Test',capabilities:['selftest-recovery'],tools:[]});
  const b=registerAgent({name:'SelfTest Recovery Specialist',role:'Engineer',department:'Test',capabilities:['selftest-recovery'],tools:[]});
  const task={id:'selftest-task',requiredCapabilities:['selftest-recovery'],requiredTools:[],toolNames:[],agentId:a.id,assignedAgentId:a.id,state:'working',maxAttempts:3};
  recordAgentTaskLearning({agentId:a.id,task,success:false});
  recordAgentTaskLearning({agentId:b.id,task,success:true});
  const persistedA=store.get('agents',a.id)?.metadata?.learning?.['selftest-recovery'];
  const persistedB=store.get('agents',b.id)?.metadata?.learning?.['selftest-recovery'];
  const recovery=recoverFailure(task,{error:'Agent failed during execution',attempt:1});
  check('agents registered',listAgents().length===before+2);
  check('failure learning persisted',persistedA?.failures===1);
  check('recovery learning persisted',persistedB?.successes===1);
  check('failure event recorded',store.recentEvents(50).some(e=>e.type==='agent.task_learning'&&e.payload?.agentId===a.id));
  check('agent recovery selects replacement',recovery.action==='retry'&&recovery.replacementAgentId===b.id,JSON.stringify(recovery));
  return {passed:checks.every(x=>x.passed),checks,testedAt:new Date().toISOString()};
}
