import { id, now } from './core.js';
import { store } from './store.js';
import { selectAgents, updateAgent } from './agents.js';
import { estimateTaskDurationMs, enrichTaskTiming } from './time-tracking.js';

export const TASK_STATES = ['queued','assigned','working','verifying','completed','failed','blocked','cancelled'];

function dependenciesCompleted(task) {
  return (task?.dependsOn ?? []).every(depId => store.get('tasks', depId)?.state === 'completed');
}

export function createTask({ projectId=null,title,description='',requiredCapabilities=[],risk='normal',dependsOn=[],acceptance=[],maxAttempts=3,executor='internal.plan',assignedAgentId=null,agentId=null,toolNames=[],requiredTools=[],sequence=0,...extra }) {
  const assigned=assignedAgentId??agentId??null;
  const task=store.put('tasks',{id:id('task'),projectId,title,description,requiredCapabilities,risk,dependsOn,acceptance,state:'queued',attempts:0,maxAttempts,executor,assignedAgentId:assigned,agentId:assigned,toolNames:Array.isArray(toolNames)?toolNames:[],requiredTools:Array.isArray(requiredTools)?requiredTools:[],sequence,estimatedDurationMs:extra.estimatedDurationMs??estimateTaskDurationMs({title,requiredCapabilities,executor,...extra}),...extra});
  store.addEvent('task.created',task); return task;
}

export function assignTask(taskId,agentId=null) {
  const task=store.get('tasks',taskId); if(!task)return null;
  if(!dependenciesCompleted(task)) return store.put('tasks',{...task,state:'blocked',blockedReason:'Dependencies incomplete',id:task.id});
  const requiredTools=Array.isArray(task.requiredTools)&&task.requiredTools.length?task.requiredTools:(Array.isArray(task.toolNames)?task.toolNames:[]);
  let agent=agentId?store.get('agents',agentId):(task.assignedAgentId?store.get('agents',task.assignedAgentId):selectAgents(task.requiredCapabilities,null,{requiredTools,requireAllTools:true})[0]);
  if(!agent)agent=selectAgents(task.requiredCapabilities,null,{requiredTools,requireAllTools:true,allowCooldownFallback:true})[0];
  // Last resort: keep the task moving with the best partial match instead of parking it
  // forever. Tools stay mandatory; only the capability overlap may degrade. Without this a
  // gate demanding capabilities no single agent holds blocked the whole dependency chain.
  if(!agent)agent=selectAgents(task.requiredCapabilities,null,{requiredTools,requireAllTools:true,allowPartialCapabilities:true})[0];
  if(!agent)return store.put('tasks',{...task,state:'blocked',blockedReason:'No capable available agent',id:task.id});
  const assigned=store.put('tasks',{...task,state:'assigned',agentId:agent.id,assignedAgentId:agent.id,assignedAt:now(),blockedReason:null,id:task.id});
  updateAgent(agent.id,{state:'assigned',currentTaskId:task.id}); store.addEvent('task.assigned',assigned); return assigned;
}

export function startTask(taskId){const task=store.get('tasks',taskId);if(!task)return null;const started=store.put('tasks',{...task,state:'working',startedAt:task.startedAt??now(),attempts:(task.attempts??0)+1,id:task.id});if(started.agentId)updateAgent(started.agentId,{state:'working',currentTaskId:started.id});store.addEvent('task.started',started);return started;}
export function markVerifying(taskId,result={}){const task=store.get('tasks',taskId);if(!task)return null;
  // 'verifying' is a state the task only ever occupies between 'working' and the verdict.
  // Keeping it in memory is enough: an invocation killed during verification leaves the
  // durable row at 'working', which orphan recovery already reclaims exactly the same way
  // it reclaims a stranded 'verifying' row. Persisting it cost a row write per task for a
  // state nobody could observe after the fact.
  const next=store.putTransient('tasks',{...task,state:'verifying',result,id:task.id});if(task.agentId)updateAgent(task.agentId,{state:'verifying',currentTaskId:task.id});store.addEvent('task.verifying',next);return next;}
export async function completeTask(taskId,result={},extra={}){const task=store.get('tasks',taskId);if(!task)return null;// A completion write that loses the compare-and-set is dropped, and the task stays
  // 'assigned' in D1 while the in-memory copy says completed: the chain then re-claims it,
  // re-runs it, and can settle on nothing. Progress must be re-applied, not discarded.
  const completed=await store.putDurable('tasks',{...task,...enrichTaskTiming({...task,state:'completed',completedAt:now()}),state:'completed',result,...extra,id:task.id});if(task.agentId)updateAgent(task.agentId,{state:'available',currentTaskId:null});store.addEvent('task.completed',completed);
  for(const dependent of store.list('tasks')){if(dependent.state==='blocked'&&Array.isArray(dependent.dependsOn)&&dependent.dependsOn.includes(taskId)&&dependenciesCompleted(dependent))assignTask(dependent.id);}
  return completed;
}
export async function failTask(taskId,error='Execution failed',extra={}){const task=store.get('tasks',taskId);if(!task)return null;const failed=await store.putDurable('tasks',{...task,...enrichTaskTiming({...task,state:'failed',failedAt:now()}),state:'failed',error,...extra,id:task.id});if(task.agentId)updateAgent(task.agentId,{state:'available',currentTaskId:null});store.addEvent('task.failed',failed);return failed;}
export const listTasks=()=>store.list('tasks');
