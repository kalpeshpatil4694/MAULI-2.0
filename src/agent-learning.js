import { store } from './store.js';
import { now } from './core.js';

export function recordAgentTaskLearning({ agentId, task, success, verification = null }) {
  if (!agentId || !task) return null;
  const agent = store.get('agents', agentId); if (!agent) return null;
  const metadata={...(agent.metadata??{}),learning:{...(agent.metadata?.learning??{})}};
  const key=(task.requiredCapabilities??[]).slice().sort().join('|')||'general';
  const current=metadata.learning[key]??{attempts:0,successes:0,failures:0,successRate:0,confidence:0,lastOutcomeAt:null};
  current.attempts+=1; if(success)current.successes+=1;else current.failures+=1;
  current.successRate=current.successes/current.attempts;
  current.confidence=Math.min(1,current.attempts/10); current.lastOutcomeAt=now(); metadata.learning[key]=current;
  const updated=store.put('agents',{...agent,metadata,id:agent.id});
  store.addEvent('agent.task_learning',{agentId,capabilityProfile:key,success,confidence:current.confidence,verificationId:verification?.id??null});
  return updated;
}
export function getAgentTaskLearning(agentId,capabilities=[]){const agent=store.get('agents',agentId);if(!agent)return null;const key=capabilities.slice().sort().join('|')||'general';return agent.metadata?.learning?.[key]??null;}
export function learningAdjustedRate(profile){if(!profile||!profile.attempts)return null;const confidence=Number.isFinite(profile.confidence)?profile.confidence:Math.min(1,profile.attempts/10);return 0.5+((profile.successRate??0)-0.5)*confidence;}
