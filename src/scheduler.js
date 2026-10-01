// MAULI 2.0 — Authoritative persistent execution scheduler.
// Scheduler owns claim/recovery/retry/dependency-release decisions.
// It never fabricates completion and is safe to invoke repeatedly.

import { now, withDeadline } from './core.js';
import { store } from './store.js';
import { selectAgents, updateAgent } from './agents.js';
import { executeTask } from './execution.js';
import { verifyResult, retryDecision } from './verification.js';
import { completeTask, failTask, markVerifying, assignTask } from './tasks.js';
import { buildFinalDeliveryDurable } from './delivery.js';
import { saveCommandResult } from './result-recorder.js';
import { ensureProjectPipeline } from './pipeline-gates.js';
import { withProjectExecutionLock } from './execution-coordination.js';

const LEASE_MS=90_000,DEFAULT_MAX_ATTEMPTS=3;
// The per-project execution lock is renewed while the body runs, so a body that never
// returns held the project for the whole lease — every later tick answered
// 'coordinator-busy' and the project sat in 'active' with nothing running. The body is
// therefore bounded as well as the individual task, and the bound is deliberately shorter
// than the 120s lease so the lock is released before it can expire on its own.
const DEFAULT_PROJECT_BUDGET_MS=75_000;
function projectBudgetMs(env={},context={}){
  const candidates=[context.projectBudgetMs,env?.MAULI_PROJECT_BUDGET_MS,DEFAULT_PROJECT_BUDGET_MS];
  for(const candidate of candidates){const n=Number(candidate);if(Number.isFinite(n)&&n>0)return n;}
  return DEFAULT_PROJECT_BUDGET_MS;
}
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
// A future-dated stamp (clock skew, or a recovered estimate written into a timestamp
// field) made `Date.now()-stamp` negative, so the run never looked stale and the task
// could never be recovered: it sat "verifying"/"working" for hours while cron skipped it
// as if a live execution were running. An implausibly future stamp is stale too.
function stale(run,at=Date.now()){const stamp=Date.parse(run?.heartbeatAt??run?.startedAt??'');if(!Number.isFinite(stamp))return true;const age=at-stamp;return age>LEASE_MS||age<-LEASE_MS;}
function releaseAgent(task){if(!task?.agentId&&!task?.assignedAgentId)return;const agent=store.get('agents',task.agentId??task.assignedAgentId);if(agent)updateAgent(agent.id,{state:'available',currentTaskId:null,heartbeatAt:now()});}
function chooseAgent(task){const tools=task.requiredTools??task.toolNames??[];return selectAgents(task.requiredCapabilities??[],null,{requiredTools:tools,requireAllTools:true})[0]??selectAgents(task.requiredCapabilities??[],null,{requireAllTools:false})[0]??selectAgents(task.requiredCapabilities??[],null,{requiredTools:tools,requireAllTools:true,allowPartialCapabilities:true})[0]??null;}
export function claimNextTask(taskId){const task=store.get('tasks',taskId);if(!task||!RUNNABLE.has(task.state)||!dependenciesReady(task))return null;const project=task.projectId?store.get('projects',task.projectId):null;if(project?.state==='awaiting_approval')return null;const existing=activeRun(task.id);if(existing&&!stale(existing))return null;// The pre-assigned agent may be a stale duplicate that is busy/offline/cooldown
  // (agent table had ~60 copies per name from old cold-start registration). Fall back
  // to the best available agent instead of leaving the task stuck in 'assigned' forever.
  let agent=task.assignedAgentId?store.get('agents',task.assignedAgentId):null;
  if(!agent||!['available','registered'].includes(agent.state))agent=chooseAgent(task);
  if(!agent||!['available','registered'].includes(agent.state))return null;
  if(task.assignedAgentId&&task.assignedAgentId!==agent.id){const old=store.get('agents',task.assignedAgentId);if(old&&old.currentTaskId===task.id)updateAgent(old.id,{state:'available',currentTaskId:null,heartbeatAt:now()});}
  const claimedAt=now();const claimed=store.put('tasks',{...task,state:'assigned',agentId:agent.id,assignedAgentId:agent.id,claimedAt,leaseUntil:new Date(Date.now()+LEASE_MS).toISOString(),updatedAt:claimedAt,id:task.id});updateAgent(agent.id,{state:'assigned',currentTaskId:task.id,heartbeatAt:claimedAt});store.addEvent('scheduler.task_claimed',{taskId:task.id,agentId:agent.id,at:claimedAt});return claimed;}
async function requeueAfterInfraFailure(task,reason,stamp,extra={}){
  const infra=Number(task.infraRecoveries??0)+1;
  if(infra>MAX_INFRA_RECOVERIES){
    await store.putDurable('tasks',{...task,state:'failed',error:reason,updatedAt:stamp,id:task.id});
    releaseAgent(task);
    store.addEvent('scheduler.task_failed',{taskId:task.id,reason,infraRecoveries:infra,at:stamp});
    return 'failed';
  }
  releaseAgent(task);
  // The agent must be released when the task is requeued, not only when it fails. Leaving the
  // agent in 'assigned' while its task went back to 'queued' means claimNextTask can never
  // find a capable agent again — with a single agent per capability (Security Agent) that
  // wedges the gate permanently and the project never reaches a terminal state.
  // The requeue MUST survive: a recovery write that loses the compare-and-set is dropped, and a
  // task stuck in 'assigned' with an expired lease is then never recovered again — the project
  // sits in 'active' forever. putDurable re-applies it against the version D1 holds.
  await store.putDurable('tasks',{...task,state:'queued',agentId:null,assignedAgentId:null,leaseUntil:null,infraRecoveries:infra,blockedReason:null,error:null,updatedAt:stamp,id:task.id});
  store.addEvent('scheduler.task_recovered',{taskId:task.id,reason,infraRecoveries:infra,nextState:'queued',at:stamp,...extra});
  return 'queued';
}
export async function recoverStaleTasks(){
  const recovered=[],stamp=now();
  for(const run of store.list('runs').filter(r=>r.state==='running'&&stale(r))){
    store.put('runs',{...run,state:'failed',error:'Execution lease expired',recoveredAt:stamp,completedAt:stamp,id:run.id});
    const task=store.get('tasks',run.taskId);
    if(!task||TERMINAL.has(task.state))continue;
    await requeueAfterInfraFailure(task,'Execution lease expired',stamp,{runId:run.id});
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
    const age=Date.now()-updated;
    // A future updatedAt must be recoverable, not read as "just touched" (negative age).
    if(Number.isFinite(updated)&&age>=0&&age<ORPHAN_GRACE_MS)continue;
    if(task.state==='assigned'){const lease=Date.parse(task.leaseUntil??'');if(Number.isFinite(lease)&&lease>Date.now()&&lease<=Date.now()+LEASE_MS)continue;}
    await requeueAfterInfraFailure(task,`Orphaned ${task.state} task with no live execution`,now());
    recovered.push(task.id);
  }
  // Blocked is not self-healing: it was only ever reconsidered when one of the task's own
  // dependencies completed. A task that blocked because no agent was capable at that
  // moment therefore blocked permanently, and so did everything chained below it — a
  // project sat 21h behind a single security gate. Re-attempt assignment every tick.
  // assignTask is a no-op (no D1 write) when nothing has actually changed.
  for(const task of store.list('tasks')){
    if(task.state!=='blocked')continue;
    if(!dependenciesReady(task))continue;
    const retry=assignTask(task.id);
    if(retry&&retry.state!=='blocked')recovered.push(task.id);
  }
  return recovered;
}
export async function runTask(taskId,env={},context={}){const claimed=claimNextTask(taskId);if(!claimed)return{status:'not-runnable',taskId};const task=store.get('tasks',taskId),run=await executeTask(task,{...context,env,agentId:task.agentId}),check=verifyResult(task,run);if(run.state==='completed'&&check?.passed){markVerifying(task.id,check);const withCheck=await completeTask(task.id,run.result??check.result??null,{verificationId:check.id});return{status:'completed',task:withCheck,run,verification:check};}const attempt=Number(task.attempts??1),decision=retryDecision(task,check,attempt);if(decision?.action==='retry'&&attempt<Number(task.maxAttempts??DEFAULT_MAX_ATTEMPTS)){releaseAgent(task);const retryTask=store.put('tasks',{...task,state:'queued',assignedAgentId:null,agentId:null,updatedAt:now(),id:task.id});store.addEvent('scheduler.task_retry',{taskId:task.id,attempt,reason:run.error??check?.error??'verification failed'});return{status:'retry-queued',task:retryTask,run,verification:check};}const failedTask=await failTask(task.id,run.error??check?.error??'Task execution/verification failed',check?.id?{verificationId:check.id}:{});releaseAgent(task);store.addEvent('scheduler.task_failed',{taskId:task.id,at:now()});return{status:'failed',task:store.get('tasks',task.id),run,verification:check};}
// Tasks completed before runTask persisted verificationId (every scheduler-completed task
// ever made) can never satisfy finalizeCommand's qaPassed/integrityPassed checks or
// buildFinalDelivery's security evidence check. The verification itself exists in the
// store — only the pointer on the task row is missing — so repair it at finalize time.
function repairMissingVerificationIds(tasks){
  const needing=tasks.filter(t=>t.state==='completed'&&!t.verificationId);
  if(!needing.length)return 0;
  const byTask=new Map();
  for(const v of store.list('verifications')){
    if(!v?.taskId||!v?.id)continue;
    const list=byTask.get(v.taskId)??[];list.push(v);byTask.set(v.taskId,list);
  }
  let repaired=0;
  for(const task of needing){
    const candidates=(byTask.get(task.id)??[]).slice().sort((a,b)=>String(b.verifiedAt??'').localeCompare(String(a.verifiedAt??'')));
    const best=candidates.find(v=>v.passed)||candidates[0];
    if(!best)continue;
    store.put('tasks',{...task,verificationId:best.id,id:task.id});repaired++;
  }
  return repaired;
}
async function finalizeCommand(projectId,env={},indexedTasks=null){const project=store.get('projects',projectId),runId=project?.commandRunId||project?.id;if(!project||project.state==='awaiting_approval')return null;let tasks=(Array.isArray(indexedTasks)?indexedTasks:store.list('tasks').filter(t=>t.projectId===projectId));if(!tasks.length)return null;
  // The repair writes the store, but the caller's array still holds the pre-repair row
  // objects — re-read so this same tick can already see the repaired verificationId.
  if(repairMissingVerificationIds(tasks))tasks=store.list('tasks').filter(t=>t.projectId===projectId);const hasRunning=tasks.some(t=>['working','assigned'].includes(t.state)),hasQueued=tasks.some(t=>RUNNABLE.has(t.state)&&dependenciesReady(t)),hasFailed=tasks.some(t=>t.state==='failed'),qaTasks=tasks.filter(t=>t.finalProjectVerification),integrity=tasks.find(t=>t.pipelineGate&&t.gateType==='integrity'),qaPassed=qaTasks.length>0&&qaTasks.every(t=>t.state==='completed'&&t.verificationId),integrityPassed=Boolean(integrity&&integrity.state==='completed'&&integrity.verificationId),allCompleted=tasks.every(t=>t.state==='completed'||t.state==='cancelled');if(hasRunning||hasQueued)return null;if(allCompleted&&qaPassed&&integrityPassed){
  // A delivery that refuses to build must never be swallowed into a silent success: the
  // project would read as 'completed' with nothing to download — the exact 'looks done,
  // delivers nothing' failure this gate exists to prevent. Record why and stay unfinished.
  let finalDelivery=project.finalDeliveryId?store.get('artifacts',project.finalDeliveryId):null;
  if(!finalDelivery){
    try{finalDelivery=await buildFinalDeliveryDurable(project,{enforceGates:true});}
    catch(error){
      const reason=String(error?.message??error);
      store.addEvent('delivery.blocked',{projectId,reason,at:now()});
      store.put('projects',{...store.get('projects',projectId),blockedReason:`Delivery blocked: ${reason}`,id:projectId});
      return null;
    }
  }
  const finalDeliveryId=finalDelivery?.id??project.finalDeliveryId??null;finalProject=await store.putDurable('projects',{...project,state:'completed',finalDeliveryId,completedAt:project.completedAt??now(),id:project.id}),result={status:'completed',runId,command:project.founderCommand,project:finalProject,tasks,finalDelivery};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.completed',{runId,projectId,status:'completed',at:now()});return result;}if(hasFailed&&!hasQueued&&!hasRunning){const failedProject=await store.putDurable('projects',{...project,state:'failed',failedAt:project.failedAt??now(),id:project.id}),result={status:'failed',runId,command:project.founderCommand,project:failedProject,tasks,error:'One or more tasks failed after recovery/retry limits.'};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.failed',{runId,projectId,status:'failed',at:now()});return result;}return null;}
function indexTasksByProject(){const byProject=new Map();for(const task of store.list('tasks')){const key=task.projectId??'';let list=byProject.get(key);if(!list)byProject.set(key,list=[]);list.push(task);}return byProject;}
export async function schedulerTick(env={},context={}){
  const recovered=await recoverStaleTasks();
  const startedAt=Date.now(),budgetMs=Number(context?.budgetMs??0);
  // One task index for the whole tick: the finalize sweep and the work loop both need it,
  // and re-scanning the full task table per project was a large slice of the free plan's
  // CPU budget.
  const byProject=indexTasksByProject();
  // Projects whose tasks are ALL finished but that never reached a delivery or a terminal
  // state get one finalize attempt here. This now includes projects left in 'active'
  // because their last scheduler tick was cancelled before finalizeCommand ran (the old
  // sweep only looked at projects already marked 'completed').
  for(const project of store.list('projects')){
    if(!project||project.state==='cancelled'||project.state==='failed'||project.state==='awaiting_approval')continue;
    if(project.state==='completed'&&project.finalDeliveryId)continue;
    const projectTasks=byProject.get(project.id)??[];
    if(!projectTasks.length)continue;
    if(projectTasks.some(t=>['queued','assigned','working','verifying','blocked'].includes(t.state)))continue;
    const final=await finalizeCommand(project.id,env,projectTasks).catch(()=>null);
    if(final)recovered.push(project.id);
  }
  const results=[];
  const drainProject=context?.projectId??null;
  const overBudget=()=>budgetMs>0&&Date.now()-startedAt>=budgetMs;
  // A blind slice(0, 40) of an insertion-ordered list silently starved every project past
  // the fortieth once the account held 80+ projects: a freshly queued command whose project
  // sorted late was never reached by cron, so it stayed "active" with nothing running even
  // though the scheduler was healthy. Build the work list from what actually needs a tick
  // (runnable, stuck, or a blocked task whose dependencies are now ready), stalest first, so
  // every project is reached over consecutive ticks and finished projects cost nothing.
  const lastTouch=pid=>{let min=0;for(const t of byProject.get(pid)??[]){const ts=Date.parse(t.updatedAt??t.claimedAt??t.createdAt??0);if(Number.isFinite(ts)&&(!min||ts<min))min=ts;}return min;};
  const needsTick=pid=>{const project=store.get('projects',pid);if(project?.state==='awaiting_approval'||['completed','cancelled','failed'].includes(project?.state))return false;for(const t of byProject.get(pid)??[]){if(t.state==='blocked'){if(dependenciesReady(t))return true;continue;}if(RUNNABLE.has(t.state)&&dependenciesReady(t))return true;if(STUCK_STATES.has(t.state))return true;}return false;};
  // Two tiers: a just-queued founder command must be worked on immediately (the founder is
  // watching it), while older unfinished projects still rotate by staleness so none is
  // starved. The old code kept pure insertion order and sliced 40, so the newest command —
  // the one the founder just typed — was always the first to be dropped.
  const FRESH_MS=10*60*1000;
  const freshProject=pid=>{const p=store.get('projects',pid);const ts=Date.parse(p?.queuedAt??p?.commandReceivedAt??p?.createdAt??0);return Number.isFinite(ts)&&(Date.now()-ts)<FRESH_MS;};
  const ordered=[...byProject.keys()].filter(Boolean).filter(needsTick).sort((a,b)=>{
    const fa=freshProject(a)?0:1, fb=freshProject(b)?0:1;
    if(fa!==fb)return fa-fb;
    return lastTouch(a)-lastTouch(b);
  });
  if(drainProject){const i=ordered.indexOf(drainProject);if(i>0)ordered.splice(i,1),ordered.unshift(drainProject);}
  for(const projectId of ordered.slice(0,PROJECTS_PER_TICK)){
    if(overBudget())break;
    const project=store.get('projects',projectId);
    if(project?.state==='awaiting_approval'||['completed','cancelled','failed'].includes(project?.state))continue;
    const result=await withProjectExecutionLock(env,projectId,async()=>withDeadline((async()=>{const t0=Date.now();
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
    })(),projectBudgetMs(env,context),`project ${projectId} execution`).catch(error=>{
      store.addEvent('scheduler.project_budget_exceeded',{projectId,error:error?.message??String(error),at:now()});
      return{status:'budget-exceeded',projectId,error:error?.message??String(error)};
    }),{leaseMs:120000});
    if(result?.status==='coordinator-busy'||result?.status==='budget-exceeded')results.push(result);
  }
  return{recovered,results,at:now()};
}
