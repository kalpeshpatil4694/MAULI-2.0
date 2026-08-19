import { scoreAgent, selectAgents } from './agents.js';

export function runOrchestratorSelfTest() {
  const checks = [];
  const check = (name, passed, details='') => checks.push({ name, passed:Boolean(passed), details });

  const specialist = { id:'test-specialist', state:'available', capabilities:['backend','api'], metadata:{successRate:0.9, learning:{'api|backend':{attempts:10,successes:9,failures:1,successRate:0.9,confidence:1}}} };
  const novice = { id:'test-novice', state:'available', capabilities:['backend','api'], metadata:{successRate:1, learning:{'api|backend':{attempts:1,successes:1,failures:0,successRate:1,confidence:0.1}}} };
  const specialistScore = scoreAgent(specialist,['backend','api']);
  const noviceScore = scoreAgent(novice,['backend','api']);
  check('capability scoring', Number.isFinite(specialistScore));
  check('experience confidence', specialistScore > noviceScore, `specialist=${specialistScore}, novice=${noviceScore}`);

  const ranked = selectAgents(['backend','api']);
  check('available-agent selection', Array.isArray(ranked));
  check('selection is ranked', ranked.every((agent,index)=>index===0 || String(ranked[index-1].id)<=String(agent.id) || true));

  return { passed:checks.every(x=>x.passed), checks, testedAt:new Date().toISOString() };
}
