import { store } from './store.js';
import { registerAgent, listAgents } from './agents.js';
import { recordAgentTaskLearning } from './agent-learning.js';

export function runAgentRecoverySelfTest() {
  const checks=[];
  const check=(name,passed,details='')=>checks.push({name,passed:Boolean(passed),details});
  const before=listAgents().length;
  const a=registerAgent({name:'SelfTest Failing Specialist',role:'Engineer',department:'Test',capabilities:['selftest-recovery']});
  const b=registerAgent({name:'SelfTest Recovery Specialist',role:'Engineer',department:'Test',capabilities:['selftest-recovery'],metadata:{successRate:0.9}});
  const task={id:'selftest-task',requiredCapabilities:['selftest-recovery'],state:'failed'};
  recordAgentTaskLearning({agentId:a.id,task,success:false});
  recordAgentTaskLearning({agentId:b.id,task,success:true});
  const persistedA=store.get('agents',a.id)?.metadata?.learning?.['selftest-recovery'];
  const persistedB=store.get('agents',b.id)?.metadata?.learning?.['selftest-recovery'];
  check('agents registered',listAgents().length===before+2);
  check('failure learning persisted',persistedA?.failures===1);
  check('recovery learning persisted',persistedB?.successes===1);
  check('failure event recorded',store.recentEvents(50).some(e=>e.type==='agent.task_learning'&&e.payload?.agentId===a.id));
  return {passed:checks.every(x=>x.passed),checks,testedAt:new Date().toISOString()};
}
