// MAULI 2.0 — Authoritative persistent execution scheduler.
// Scheduler owns claim/recovery/retry/dependency-release decisions.
// It never fabricates completion and is safe to invoke repeatedly.

import { now } from './core.js';
import { store } from './store.js';
import { selectAgents, updateAgent } from './agents.js';
import { executeTask } from './execution.js';
import { verifyResult, retryDecision } from './verification.js';
import { completeTask, failTask, markVerifying } from './tasks.js';
import { buildFinalDelivery } from './delivery.js';
import { saveCommandResult } from './result-recorder.js';

const LEASE_MS = 90_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RUNNABLE = new Set(['queued', 'assigned']);
const TERMINAL = new Set(['completed', 'cancelled']);

function dependenciesReady(task) {
  return (task?.dependsOn ?? []).every(id => store.get('tasks', id)?.state === 'completed');
}
function activeRun(taskId) {
  return store.list('runs').find(r => r.taskId === taskId && r.state === 'running') ?? null;
}
function stale(run) {
  const stamp = Date.parse(run?.heartbeatAt ?? run?.startedAt ?? '');
  return !Number.isFinite(stamp) || Date.now() - stamp > LEASE_MS;
}
function releaseAgent(task) {
  if (!task?.agentId && !task?.assignedAgentId) return;
  const agentId = task.agentId ?? task.assignedAgentId;
  const agent = store.get('agents', agentId);
  if (agent) updateAgent(agent.id, { state: 'available', currentTaskId: null, heartbeatAt: now() });
}
function chooseAgent(task) {
  const tools = task.requiredTools ?? task.toolNames ?? [];
  return selectAgents(task.requiredCapabilities ?? [], null, { requiredTools: tools, requireAllTools: true })[0]
    ?? selectAgents(task.requiredCapabilities ?? [], null, { requireAllTools: false })[0]
    ?? null;
}

export function claimNextTask(taskId) {
  const task = store.get('tasks', taskId);
  if (!task || !RUNNABLE.has(task.state) || !dependenciesReady(task)) return null;
  const project = task.projectId ? store.get('projects', task.projectId) : null;
  if (project?.state === 'awaiting_approval') return null;
  const existing = activeRun(task.id);
  if (existing && !stale(existing)) return null;
  const agent = task.assignedAgentId ? store.get('agents', task.assignedAgentId) : chooseAgent(task);
  if (!agent || !['available', 'registered'].includes(agent.state)) return null;
  const claimedAt = now();
  const claimed = store.put('tasks', {...task,state:'assigned',agentId:agent.id,assignedAgentId:agent.id,claimedAt,leaseUntil:new Date(Date.now()+LEASE_MS).toISOString(),updatedAt:claimedAt,id:task.id});
  updateAgent(agent.id,{state:'assigned',currentTaskId:task.id,heartbeatAt:claimedAt});
  store.addEvent('scheduler.task_claimed',{taskId:task.id,agentId:agent.id,at:claimedAt});
  return claimed;
}

export function recoverStaleTasks() {
  const recovered=[];
  for(const run of store.list('runs').filter(r=>r.state==='running'&&stale(r))){
    const task=store.get('tasks',run.taskId);const stamp=now();
    store.put('runs',{...run,state:'failed',error:'Execution lease expired',recoveredAt:stamp,completedAt:stamp,id:run.id});
    if(!task||TERMINAL.has(task.state))continue;
    const attempts=Number(task.attempts??0);const maxAttempts=Number(task.maxAttempts??DEFAULT_MAX_ATTEMPTS);const next=attempts<maxAttempts?'queued':'failed';
    store.put('tasks',{...task,state:next,attempts:attempts+1,error:'Execution lease expired',updatedAt:stamp,id:task.id});
    releaseAgent(task);store.addEvent('scheduler.task_recovered',{taskId:task.id,runId:run.id,nextState:next,at:stamp});recovered.push(task.id);
  }
  return recovered;
}

export async function runTask(taskId,env={},context={}) {
  const claimed=claimNextTask(taskId);if(!claimed)return{status:'not-runnable',taskId};
  const task=store.get('tasks',taskId);const run=await executeTask(task,{...context,env,agentId:task.agentId});const check=verifyResult(task,run);
  if(run.state==='completed'&&check?.passed){markVerifying(task.id,check);completeTask(task.id,run.result??check.result??null);return{status:'completed',task:store.get('tasks',task.id),run,verification:check};}
  const attempt=Number(task.attempts??1);const decision=retryDecision(task,check,attempt);
  if(decision?.action==='retry'&&attempt<Number(task.maxAttempts??DEFAULT_MAX_ATTEMPTS)){releaseAgent(task);const retryTask=store.put('tasks',{...task,state:'queued',assignedAgentId:null,agentId:null,updatedAt:now(),id:task.id});store.addEvent('scheduler.task_retry',{taskId:task.id,attempt,reason:run.error??check?.error??'verification failed'});return{status:'retry-queued',task:retryTask,run,verification:check};}
  failTask(task.id,run.error??check?.error??'Task execution/verification failed');releaseAgent(task);store.addEvent('scheduler.task_failed',{taskId:task.id,at:now()});return{status:'failed',task:store.get('tasks',task.id),run,verification:check};
}

async function finalizeCommand(projectId,env={}) {
  const project=store.get('projects',projectId);const runId=project?.commandRunId;if(!project||!runId||project.state==='awaiting_approval')return null;
  const tasks=store.list('tasks').filter(t=>t.projectId===projectId);if(!tasks.length)return null;
  const hasRunning=tasks.some(t=>['working','assigned'].includes(t.state));const hasQueued=tasks.some(t=>RUNNABLE.has(t.state)&&dependenciesReady(t));const hasFailed=tasks.some(t=>t.state==='failed');
  const qaTasks=tasks.filter(t=>t.finalProjectVerification);const qaPassed=qaTasks.length>0&&qaTasks.every(t=>t.state==='completed'&&t.verificationId);const allCompleted=tasks.every(t=>t.state==='completed');if(hasRunning||hasQueued)return null;
  if(allCompleted&&qaPassed){const finalDelivery=project.finalDeliveryId?store.get('artifacts',project.finalDeliveryId):buildFinalDelivery(project);const finalProject=store.put('projects',{...project,state:'completed',finalDeliveryId:finalDelivery?.id??project.finalDeliveryId??null,completedAt:project.completedAt??now(),id:project.id});const result={status:'completed',runId,command:project.founderCommand,project:finalProject,tasks,finalDelivery};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.completed',{runId,projectId,status:'completed',at:now()});return result;}
  if(hasFailed&&!hasQueued&&!hasRunning){const failedProject=store.put('projects',{...project,state:'failed',failedAt:project.failedAt??now(),id:project.id});const result={status:'failed',runId,command:project.founderCommand,project:failedProject,tasks,error:'One or more tasks failed after recovery/retry limits.'};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.failed',{runId,projectId,status:'failed',at:now()});return result;}
  return null;
}

export async function schedulerTick(env={},context={}) {
  recoverStaleTasks();const projects=new Set(store.list('tasks').map(t=>t.projectId).filter(Boolean));const results=[];
  for(const projectId of projects){
    const project=store.get('projects',projectId);
    if(project?.state==='awaiting_approval')continue;
    const tasks=store.list('tasks').filter(t=>t.projectId===projectId&&RUNNABLE.has(t.state)&&dependenciesReady(t)).sort((a,b)=>Number(a.sequence??0)-Number(b.sequence??0));
    for(const task of tasks){const result=await runTask(task.id,env,context);results.push(result);break;}
    const final=await finalizeCommand(projectId,env).catch(()=>null);if(final)results.push({status:final.status,runId:final.runId,projectId});
  }
  return{recovered:[],results,at:now()};
}
