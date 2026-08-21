import { capability, id, now } from './core.js';
import { store } from './store.js';
import { learningAdjustedRate } from './agent-learning.js';

export const AGENT_STATES = ['registered','available','assigned','working','verifying','completed','blocked','escalated','offline'];
export function registerAgent({ name, role, department = 'General', capabilities = [], tools = [], metadata = {} }) { const agent=store.put('agents',{id:id('agent'),name,role,department,capabilities,tools,state:'available',heartbeatAt:now(),metadata}); store.addEvent('agent.registered',agent); return agent; }
export function updateAgent(idValue, patch) { const current=store.get('agents',idValue); if(!current)return null; const next=store.put('agents',{...current,...patch,id:current.id}); store.addEvent('agent.updated',next); return next; }
export function listAgents(){return store.list('agents');}
export function recordAgentOutcome(agentId,outcome={}){const agent=store.get('agents',agentId);if(!agent)return null;const metadata={...(agent.metadata??{})};const total=Math.max(0,Number(metadata.outcomeCount??0));const successes=Math.max(0,Number(metadata.successCount??0));const success=outcome.success===true;const nextTotal=total+1;const nextSuccesses=successes+(success?1:0);metadata.outcomeCount=nextTotal;metadata.successCount=nextSuccesses;metadata.failureCount=Math.max(0,nextTotal-nextSuccesses);metadata.successRate=nextSuccesses/nextTotal;metadata.lastOutcomeAt=now();metadata.lastOutcome=success?'success':'failure';metadata.reliabilityScore=Math.round(metadata.successRate*100);if(!success){metadata.consecutiveFailures=Math.max(0,Number(metadata.consecutiveFailures??0))+1;}else{metadata.consecutiveFailures=0;}if(metadata.consecutiveFailures>=3){metadata.cooldownUntil=Date.now()+300000;}return updateAgent(agentId,{metadata});}
function contextualRate(agent, requiredCapabilities=[]){const key=[...new Set(requiredCapabilities)].sort().join('|')||'general';return learningAdjustedRate(agent.metadata?.learning?.[key]);}
function workloadPenalty(agent,options={}){const active=Number(agent.metadata?.activeTaskCount??0);const max=Number(agent.metadata?.maxConcurrentTasks??1);if(options.ignoreWorkload)return 0;if(active>=max)return -100;return Math.max(-30,-active*10);}
function reliabilityPenalty(agent){const metadata=agent.metadata??{};if(metadata.cooldownUntil&&Date.now()<Number(metadata.cooldownUntil))return -Infinity;const failures=Number(metadata.consecutiveFailures??0);return failures>0?-Math.min(35,failures*8):0;}
function toolMatch(agent,requiredTools=[]){const required=[...new Set(requiredTools.filter(Boolean))];const available=new Set(agent.tools??[]);const matched=required.filter(tool=>available.has(tool));const missing=required.filter(tool=>!available.has(tool));return{matched,missing,score:matched.length===required.length?Math.min(30,matched.length*10):0};}
export function scoreAgent(agent,requiredCapabilities=[],options={}){const required=[...new Set(requiredCapabilities)];const caps=new Set(agent.capabilities??[]);const matched=required.filter(c=>caps.has(c));if(required.length&&matched.length!==required.length)return -Infinity;const tools=toolMatch(agent,options.requiredTools??[]);if(tools.missing.length&&options.requireAllTools!==false)return -Infinity;let score=matched.length*100+Math.min((agent.capabilities??[]).length,20)+tools.score;if(options.department&&agent.department===options.department)score+=25;if(options.preferredRole&&agent.role===options.preferredRole)score+=15;if(agent.state==='available')score+=20;const metadata=agent.metadata??{};if(Number.isFinite(metadata.successRate))score+=Math.max(0,Math.min(20,metadata.successRate*20));if(Number.isFinite(metadata.reliabilityScore))score+=Math.max(0,Math.min(20,metadata.reliabilityScore*.2));if(Number.isFinite(metadata.priority))score+=metadata.priority;const rate=contextualRate(agent,required);if(rate!==null)score+=Math.max(0,Math.min(40,rate*40));score+=reliabilityPenalty(agent);score+=workloadPenalty(agent,options);return score;}
export function selectAgents(requiredCapabilities=[],department=null,options={}){return listAgents().filter(a=>a.state==='available'&&(!department||a.department===department)).map(agent=>({agent,score:scoreAgent(agent,requiredCapabilities,{...options,department})})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score||String(a.agent.id).localeCompare(String(b.agent.id))).map(x=>x.agent);}
export function selectBestAgent(requiredCapabilities=[],options={}){return selectAgents(requiredCapabilities,options.department??null,options)[0]??null;}

const DEFAULT_AGENTS=[['SK Executive','Executive','Executive',['planning','governance','delegation'],[]],['Research Agent','Research','Research',['research','analysis'],['web.search']],['Product Agent','Product','Business',['requirements','product-planning','planning'],['planning.execute']],['Frontend Agent','Engineer','Engineering',['frontend','javascript','ui'],['code.execute','test.run']],['Backend Agent','Engineer','Engineering',['backend','api','javascript'],['code.execute','test.run']],['Database Agent','Engineer','Engineering',['database','schema','sql'],['database.query','code.execute']],['Security Agent','Reviewer','Security',['security','audit'],['security.scan']],['QA Agent','Tester','Quality',['testing','verification'],['test.run','code.execute']]];

function activeTaskOwnedBy(agent){const taskId=agent?.currentTaskId;if(!taskId)return false;const task=store.get('tasks',taskId);return Boolean(task&&task.agentId===agent.id&&['assigned','working','verifying'].includes(task.state));}

export function seedAgents(){
  const existingByName=new Map(listAgents().map(agent=>[agent.name,agent]));
  for(const [name,role,department,caps,tools] of DEFAULT_AGENTS){
    const current=existingByName.get(name);
    if(!current){registerAgent({name,role,department,capabilities:caps,tools});continue;}
    const mergedCapabilities=[...new Set([...(current.capabilities??[]),...caps])];
    const mergedTools=[...new Set([...(current.tools??[]),...tools])];
    const patch={capabilities:mergedCapabilities,tools:mergedTools,heartbeatAt:now()};
    // Persisted agent state must not block L1 scheduling after a restart/hydration.
    // Keep assigned/working/verifying only when the referenced task is genuinely active.
    if(!activeTaskOwnedBy(current)){patch.state='available';patch.currentTaskId=null;}
    updateAgent(current.id,patch);
  }
  return listAgents();
}
export { capability };
