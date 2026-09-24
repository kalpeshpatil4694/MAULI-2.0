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
import { ensureProjectPipeline } from './pipeline-gates.js';
import { withProjectExecutionLock } from './execution-coordination.js';

const LEASE_MS=90_000,DEFAULT_MAX_ATTEMPTS=3;
const RUNNABLE=new Set(['queued','assigned']);
const TERMINAL=new Set(['completed','cancelled']);
const STUCK_STATES=new Set(['working','assigned','verifying']);
// Platform cancellations (waitUntil 30s window, CPU limit) must not burn a task's real
// attempt budget, but they still need an upper bound so a poison task cannot churn forever.
const MAX_INFRA_RECOVERIES=8;
const ORPHAN_GRACE_MS=15_000;
const PROJECTS_PER_TICK=40;
// Cron (no drain target) advances up to 6 runnable tasks per project per tick so the
// */5 schedule still delivers a full chain in a couple of ticks.
const CRON_TASKS_PER_PROJECT=6;
function dependenciesReady(task){return(task?.dependsOn??[]).every(id=>store.get('tasks',id)?.state==='completed');}
function activeRun(taskId){return store.list('runs').find(r=>r.taskId===taskId&&r.state==='running')??null;}
function stale(run){const stamp=Date.parse(run?.heartbeatAt??run?.startedAt??'');return !Number.isFinite(stamp)||Date.now()-stamp>LEASE_MS;}
function releaseAgent(task){if(!task?.agentId&&!task?.assignedAgentId)return;const agent=store.get('agents',task.agentId??task.assignedAgentId);if(agent)updateAgent(agent.id,{state:'available',currentTaskId:null,heartbeatAt:now()});}
function chooseAgent(task){const tools=task.requiredTools??task.toolNames??[];return selectAgents(task.requiredCapabilities??[],null,{requiredTools:tools,requireAllTools:true})[0]??selectAgents(task.requiredCapabilities??[],null,{requireAllTools:false})[0]??null;}
export function claimNextTask(taskId){const task=store.get('tasks',taskId);if(!task||!RUNNABLE.has(task.state)||!dependenciesReady(task))return null;const project=task.projectId?store.get('projects',task.projectId):null;if(project?.state==='awaiting_approval')return null;const existing=activeRun(task.id);if(existing&&!stale(existing))return null;// The pre-assigned agent may be a stale duplicate that is busy/offline/cooldown
  // (agent table had ~60 copies per name from old cold-start registration). Fall back
  // to the best available agent instead of leaving the task stuck in 'assigned' forever.
  let agent=task.assignedAgentId?store.get('agents',task.assignedAgentId):null;
  if(!agent||!['available','registered'].includes(agent.state))agent=chooseAgent(task);
  if(!agent||!['available','registered'].includes(agent.state))return null;
  if(task.assignedAgentId&&task.assignedAgentId!==agent.id){const old=store.get('agents',task.assignedAgentId);if(old&&old.currentTaskId===task.id)updateAgent(old.id,{state:'available',currentTaskId:null,heartbeatAt:now()});}
  const claimedAt=now();const claimed=store.put('tasks',{...task,state:'assigned',agentId:agent.id,assignedAgentId:agent.id,claimedAt,leaseUntil:new Date(Date.now()+LEASE_MS).toISOString(),updatedAt:claimedAt,id:task.id});updateAgent(agent.id,{state:'assigned',currentTaskId:task.id,heartbeatAt:claimedAt});store.addEvent('scheduler.task_claimed',{taskId:task.id,agentId:agent.id,at:claimedAt});return claimed;}
function requeueAfterInfraFailure(task,reason,stamp,extra={}){
  const infra=Number(task.infraRecoveries??0)+1;
  if(infra>MAX_INFRA_RECOVERIES){
    store.put('tasks',{...task,state:'failed',error:reason,updatedAt:stamp,id:task.id});
    releaseAgent(task);
    store.addEvent('scheduler.task_failed',{taskId:task.id,reason,infraRecoveries:infra,at:stamp});
    return 'failed';
  }
  releaseAgent(task);
  store.put('tasks',{...task,state:'queued',agentId:null,assignedAgentId:null,leaseUntil:null,infraRecoveries:infra,blockedReason:null,error:null,updatedAt:stamp,id:task.id});
  store.addEvent('scheduler.task_recovered',{taskId:task.id,reason,infraRecoveries:infra,nextState:'queued',at:stamp,...extra});
  return 'queued';
}
export function recoverStaleTasks(){
  const recovered=[],stamp=now();
  for(const run of store.list('runs').filter(r=>r.state==='running'&&stale(r))){
    store.put('runs',{...run,state:'failed',error:'Execution lease expired',recoveredAt:stamp,completedAt:stamp,id:run.id});
    const task=store.get('tasks',run.taskId);
    if(!task||TERMINAL.has(task.state))continue;
    requeueAfterInfraFailure(task,'Execution lease expired',stamp,{runId:run.id});
    recovered.push(task.id);
  }
  // Orphan recovery: RUNNABLE only contains queued/assigned, so a task left in
  // working/assigned/verifying without a live run could never be picked up again —
  // that kept projects "active" forever with no final command result.
  const liveRuns=new Set(store.list('runs').filter(r=>r.state==='running'&&!stale(r)).map(r=>r.taskId));
  for(const task of store.list('tasks')){
    if(!STUCK_STATES.has(task.state))continue;
    if(liveRuns.has(task.id))continue;
    const updated=Date.parse(task.updatedAt??task.claimedAt??0);
    if(Number.isFinite(updated)&&Date.now()-updated<ORPHAN_GRACE_MS)continue;
    if(task.state==='assigned'){const lease=Date.parse(task.leaseUntil??'');if(Number.isFinite(lease)&&lease>Date.now())continue;}
    requeueAfterInfraFailure(task,`Orphaned ${task.state} task with no live execution`,now());
    recovered.push(task.id);
  }
  return recovered;
}
export async function runTask(taskId,env={},context={}){const claimed=claimNextTask(taskId);if(!claimed)return{status:'not-runnable',taskId};const task=store.get('tasks',taskId),run=await executeTask(task,{...context,env,agentId:task.agentId}),check=verifyResult(task,run);if(run.state==='completed'&&check?.passed){markVerifying(task.id,check);completeTask(task.id,run.result??check.result??null);return{status:'completed',task:store.get('tasks',task.id),run,verification:check};}const attempt=Number(task.attempts??1),decision=retryDecision(task,check,attempt);if(decision?.action==='retry'&&attempt<Number(task.maxAttempts??DEFAULT_MAX_ATTEMPTS)){releaseAgent(task);const retryTask=store.put('tasks',{...task,state:'queued',assignedAgentId:null,agentId:null,updatedAt:now(),id:task.id});store.addEvent('scheduler.task_retry',{taskId:task.id,attempt,reason:run.error??check?.error??'verification failed'});return{status:'retry-queued',task:retryTask,run,verification:check};}failTask(task.id,run.error??check?.error??'Task execution/verification failed');releaseAgent(task);store.addEvent('scheduler.task_failed',{taskId:task.id,at:now()});return{status:'failed',task:store.get('tasks',task.id),run,verification:check};}
async function finalizeCommand(projectId,env={},indexedTasks=null){const project=store.get('projects',projectId),runId=project?.commandRunId||project?.id;if(!project||project.state==='awaiting_approval')return null;const tasks=(Array.isArray(indexedTasks)?indexedTasks:store.list('tasks').filter(t=>t.projectId===projectId));if(!tasks.length)return null;const hasRunning=tasks.some(t=>['working','assigned'].includes(t.state)),hasQueued=tasks.some(t=>RUNNABLE.has(t.state)&&dependenciesReady(t)),hasFailed=tasks.some(t=>t.state==='failed'),qaTasks=tasks.filter(t=>t.finalProjectVerification),integrity=tasks.find(t=>t.pipelineGate&&t.gateType==='integrity'),qaPassed=qaTasks.length>0&&qaTasks.every(t=>t.state==='completed'&&t.verificationId),integrityPassed=Boolean(integrity&&integrity.state==='completed'&&integrity.verificationId),allCompleted=tasks.every(t=>t.state==='completed');if(hasRunning||hasQueued)return null;if(allCompleted&&qaPassed&&integrityPassed){const finalDelivery=project.finalDeliveryId?store.get('artifacts',project.finalDeliveryId):buildFinalDelivery(project,{enforceGates:true}),finalProject=store.put('projects',{...project,state:'completed',finalDeliveryId:finalDelivery?.id??project.finalDeliveryId??null,completedAt:project.completedAt??now(),id:project.id}),result={status:'completed',runId,command:project.founderCommand,project:finalProject,tasks,finalDelivery};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.completed',{runId,projectId,status:'completed',at:now()});return result;}if(hasFailed&&!hasQueued&&!hasRunning){const failedProject=store.put('projects',{...project,state:'failed',failedAt:project.failedAt??now(),id:project.id}),result={status:'failed',runId,command:project.founderCommand,project:failedProject,tasks,error:'One or more tasks failed after recovery/retry limits.'};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.failed',{runId,projectId,status:'failed',at:now()});return result;}return null;}
function indexTasksByProject(){const byProject=new Map();for(const task of store.list('tasks')){const key=task.projectId??'';let list=byProject.get(key);if(!list)byProject.set(key,list=[]);list.push(task);}return byProject;}
export async function schedulerTick(env={},context={}){
  const recovered=recoverStaleTasks();
  const startedAt=Date.now(),budgetMs=Number(context?.budgetMs??0);
  const byProject=indexTasksByProject();
  const ordered=[...byProject.keys()].filter(Boolean);
  const results=[];
  const drainProject=context?.projectId??null;
  if(drainProject){const i=ordered.indexOf(drainProject);if(i>0)ordered.splice(i,1),ordered.unshift(drainProject);}
  const overBudget=()=>budgetMs>0&&Date.now()-startedAt>=budgetMs;
  for(const projectId of ordered.slice(0,PROJECTS_PER_TICK)){
    if(overBudget())break;
    const project=store.get('projects',projectId);
    if(project?.state==='awaiting_approval'||['completed','cancelled','failed'].includes(project?.state))continue;
    const result=await withProjectExecutionLock(env,projectId,async()=>{
      const projectTasks=byProject.get(projectId)??[];
      const ensured=ensureProjectPipeline(projectId,projectTasks);
      if(ensured?.created?.length){for(const createdTask of ensured.created){if(!projectTasks.some(t=>t.id===createdTask.id))projectTasks.push(createdTask);}byProject.set(projectId,projectTasks);}
      const tasks=projectTasks.filter(t=>RUNNABLE.has(t.state)&&dependenciesReady(t)).sort((a,b)=>Number(a.sequence??0)-Number(b.sequence??0));
      const fullChain=drainProject===projectId;
      const taskLimit=fullChain?8:CRON_TASKS_PER_PROJECT;
      let ran=0;
      for(const task of tasks){
        if(overBudget())break;
        results.push(await runTask(task.id,env,context));ran++;
        if(ran>=taskLimit)break;
      }
      const final=await finalizeCommand(projectId,env,projectTasks).catch(()=>null);
      if(final)results.push({status:final.status,runId:final.runId,projectId});
      return{status:'processed',projectId,ran};
    },{leaseMs:120000});
    if(result?.status==='coordinator-busy')results.push(result);
  }
  return{recovered,results,at:now()};
}
