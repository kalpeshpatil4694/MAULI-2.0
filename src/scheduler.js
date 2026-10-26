// MAULI 2.0 — Authoritative persistent execution scheduler.
// Scheduler owns claim/recovery/retry/dependency-release decisions.
// It never fabricates completion and is safe to invoke repeatedly.

import { now, withDeadline } from './core.js';
import { hasD1 } from './db.js';
import { store } from './store.js';
import { selectAgents, updateAgent } from './agents.js';
import { executeTask, runOverLifetime } from './execution.js';
import { verifyResult, retryDecision } from './verification.js';
import { completeTask, failTask, markVerifying, assignTask, startTask } from './tasks.js';
import { buildFinalDeliveryDurable } from './delivery.js';
import { saveCommandResult } from './result-recorder.js';
import { ensureProjectPipeline } from './pipeline-gates.js';
import { withProjectExecutionLock } from './execution-coordination.js';
import { approveProject } from './governance.js';

const LEASE_MS=90_000,DEFAULT_MAX_ATTEMPTS=3;
// The per-project execution lock is renewed while the body runs, so a body that never
// returns held the project for the whole lease — every later tick answered
// 'coordinator-busy' and the project sat in 'active' with nothing running. The body is
// therefore bounded as well as the individual task. That bound must be LARGER than one
// task's own budget: a measured app generation takes 76-156s while the old 75s bound cut
// every generation off mid-call on every single tick (the run finished in the background
// with its lock already released, and the next tick could start a second competing
// generation of the same project). 190s covers one full task budget with a small margin.
const DEFAULT_PROJECT_BUDGET_MS=190_000;
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
// Executors that make model calls (and take tens of seconds to minutes). They must not be
// STARTED from a hand-off tick that runs inside ctx.waitUntil: Cloudflare ends that
// invocation 30s after the response, so the generation is killed mid-call, recovered as a
// stale run, charged against the task's infra-recovery budget, and repeated from scratch by
// the next cron tick. Generation belongs to the cron tick, which has a real budget.
const LONG_EXECUTORS=new Set(['internal.code','internal.native','internal.pdf']);
// A task that is runnable with its dependencies complete, was offered to the scheduler in a
// real tick, and STILL could not be claimed (no capable agent, a lost write) is not pending
// work. Nothing recovered it: it has no run to be stale, it is not 'blocked', so
// finalizeCommand counted it as pending and the project read 'active' forever — measured
// live as 0/14 tasks after 15 hours. Past this window it is an honest failure with a reason.
const STALLED_RUNNABLE_MS=15*60*1000;
// ── Idle cron gate ───────────────────────────────────────────────────────────
// Cloudflare bills rows_read/rows_written for the whole account per day, and the free tier
// is enforced against the ACCOUNT, not per invocation. The one-minute cron is what keeps
// MAULI responsive, but a tick with nothing to do used to pay for a full scheduler bootstrap
// (projects + live tasks + agents + approvals + runs + verifications + artifacts), an
// incremental sync of seven tables and two prune probes. Measured live: 743k rows read in a
// day of an idle account, on an alarm clock alone.
//
// One tiny ledger row now records whether work is pending. It is set the moment a command,
// approval or chat releases work, cleared by a tick that left nothing runnable, and ignored
// on the periodic safety sweep — so a missed update can delay a tick by minutes, never wedge
// the scheduler. A quiet minute costs one row read plus one indexed existence probe.
const WAKE_TYPE='stats';
const WAKE_ID='scheduler_wake';
const IDLE_DIRTY_WINDOW_MS=5*60_000;
// Even when the marker says idle, a full tick runs this often. Time-only transitions (an
// expired lease, a retry backoff) produce no row write, so they need a sweep to be seen.
const IDLE_SAFETY_EVERY_MINUTES=15;
const LIVE_TASK_STATES=new Set(['queued','assigned','working','verifying','blocked']);
// awaiting_approval is deliberately absent: that state waits on a human, and the approval
// route marks work itself. Counting it would keep the fast path shut for every parked project.
const LIVE_PROJECT_STATES=new Set(['active','queued','planning','executing','escalated']);

export async function readSchedulerWake(env){
  if(!hasD1(env))return{pending:true,at:null,known:false,reason:'no-d1'};
  try{
    const row=await env.DB.prepare('SELECT data FROM entities WHERE type=? AND id=?').bind(WAKE_TYPE,WAKE_ID).first();
    if(!row?.data)return{pending:true,at:null,known:false,reason:'no-marker'};
    const data=JSON.parse(row.data);
    return{pending:data?.pending!==false,at:data?.at??null,known:true,reason:data?.reason??null};
  }catch(error){
    // An unreadable marker must never silence the scheduler: treat it as "work may exist".
    return{pending:true,at:null,known:false,reason:`marker-unreadable: ${error?.message??error}`};
  }
}
// `previous` is what the caller already read, so a value that is already correct costs no
// write. Being wrong here is not dangerous — it only costs one extra tick.
export async function writeSchedulerWake(env,{pending,reason=null,previous}={}){
  if(!hasD1(env))return{written:false,reason:'no-d1'};
  const next=pending!==false;
  if(previous!==undefined&&Boolean(previous)===next)return{written:false,reason:'unchanged',pending:next};
  try{
    const stamp=now();
    const data=JSON.stringify({pending:next,reason,at:stamp});
    await env.DB.prepare('INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
      .bind(WAKE_TYPE,WAKE_ID,data,stamp,stamp).run();
    return{written:true,pending:next,at:stamp};
  }catch(error){
    return{written:false,pending:next,error:error?.message??String(error)};
  }
}
export async function markSchedulerWork(env,reason='work-queued',{previous}={}){
  return writeSchedulerWake(env,{pending:true,reason,previous});
}
// Did anything the scheduler cares about change recently? Four index-range probes (one per
// live table, each LIMIT 1) instead of hydrating seven tables to find out. Rows read stays in
// single digits on a quiet account, which is the whole point.
export async function rowsChangedSince(env,sinceMs){
  if(!hasD1(env))return true;
  const types=['projects','tasks','approvals','runs'];
  const since=new Date(Number(sinceMs)||0).toISOString();
  const sql=types.map(()=>'SELECT 1 AS hit FROM entities WHERE type=? AND updated_at>? LIMIT 1').join(' UNION ALL ');
  try{
    const result=await env.DB.prepare(sql).bind(...types.flatMap(type=>[type,since])).all();
    return (result?.results??[]).length>0;
  }catch(_){
    // A failed probe must not be read as "nothing changed".
    return true;
  }
}
// The cron decides here whether this minute is worth a full tick at all.
export async function schedulerIdleGate(env,{scheduledTime=Date.now(),nowMs=Date.now(),force=false}={}){
  if(force)return{run:true,reason:'forced',wake:null};
  const minute=new Date(Number(scheduledTime)||nowMs).getUTCMinutes();
  if(minute%IDLE_SAFETY_EVERY_MINUTES===0)return{run:true,reason:'safety-sweep',wake:null};
  const wake=await readSchedulerWake(env);
  if(wake.pending)return{run:true,reason:wake.reason??'work-pending',wake};
  if(await rowsChangedSince(env,nowMs-IDLE_DIRTY_WINDOW_MS))return{run:true,reason:'rows-changed',wake};
  return{run:false,reason:'idle',wake};
}
// Work that cannot progress is not work. A chain whose rows have not moved for the retirement
// window and has no live execution is exactly what the retirement pass removes — and while the
// account write budget refuses those writes, the rows stay in D1 and would otherwise hold the
// fast path open forever: measured in production, one zombie project from 2026-10-21 kept
// `pending: true`, so every minute hydrated seven tables again even though nothing could move.
// Stale rows still get a full tick on the safety sweep; they just stop costing a hydration a
// minute. A row with no timestamp is treated as recent, so unknown state is never called dead.
const DEAD_WORK_MS=6*60*60*1000;
function touchedWithin(row,cutoff){
  const stamp=Date.parse(row?.updatedAt??row?.claimedAt??row?.queuedAt??row?.createdAt??'');
  return !Number.isFinite(stamp)||stamp>=cutoff;
}
// What the tick found, in terms a founder reads: is anything still expecting work? Read from
// the in-memory scheduler view, so it costs no D1 query.
export function schedulerHasLiveWork(env=store.env,{nowMs=Date.now(),maxAgeMs}={}){
  const configured=Number(maxAgeMs??env?.MAULI_STALE_WORK_MS);
  const cutoff=nowMs-(Number.isFinite(configured)&&configured>0?configured:DEAD_WORK_MS);
  // "running" in D1 is not the same as executing: a run whose lease expired keeps that state
  // until its own failure write lands, and while the write budget refuses it, the row is
  // permanently "running". Treating that as progress is what kept a 5-day-old chain, and the
  // whole scheduler, awake.
  const runningTaskIds=new Set(store.list('runs').filter(run=>run?.state==='running'&&!stale(run,nowMs)).map(run=>run.taskId).filter(Boolean));
  if(store.list('tasks').some(task=>LIVE_TASK_STATES.has(task?.state)&&(runningTaskIds.has(task.id)||touchedWithin(task,cutoff))))return true;
  if(store.list('approvals').some(approval=>approval?.state==='pending'))return true;
  return store.list('projects').some(project=>LIVE_PROJECT_STATES.has(project?.state)&&touchedWithin(project,cutoff));
}
// Cron (no drain target) advances up to 6 runnable tasks per project per tick so the
// */5 schedule still delivers a full chain in a couple of ticks.
const CRON_TASKS_PER_PROJECT=6;
// Multi-agent parallelism. The task loop claimed and executed ONE task at a time, so a
// project with six independent tasks advanced no faster than a single lane however many free
// agents it had. The runnable set is already dependency-filtered, and each task is dominated
// by I/O (an AI generation call, a subrequest), so overlapping a small, bounded number of
// them uses roughly the same free-tier CPU while cutting wall-clock time. The bound is
// deliberately modest and OVERRIDABLE: Workers free-tier CPU (10ms) and the ~40-subrequest
// budget are per-invocation, so unbounded fan-out would exhaust them and fail every task at
// once — the opposite of a speedup.
const DEFAULT_AGENT_CONCURRENCY=3,MAX_AGENT_CONCURRENCY=8;
function agentConcurrency(env={},context={}){
  const candidates=[context.concurrency,env?.MAULI_AGENT_CONCURRENCY,env?.MAULI_EXECUTION_CONCURRENCY,DEFAULT_AGENT_CONCURRENCY];
  for(const candidate of candidates){const n=Number(candidate);if(Number.isFinite(n)&&n>=1)return Math.min(MAX_AGENT_CONCURRENCY,Math.floor(n));}
  return DEFAULT_AGENT_CONCURRENCY;
}
async function mapWithConcurrency(items,limit,worker){
  const list=Array.isArray(items)?items:[];
  if(!list.length)return;
  const width=Math.max(1,Math.min(Number(limit)||1,list.length));
  let next=0;
  const runners=Array.from({length:width},async()=>{
    for(;;){const index=next++;if(index>=list.length)return;try{await worker(list[index],index)}catch(_){}}
  });
  await Promise.all(runners);
}

function dependenciesReady(task){return(task?.dependsOn??[]).every(id=>store.get('tasks',id)?.state==='completed');}
function activeRun(taskId){return store.list('runs').find(r=>r.taskId===taskId&&r.state==='running')??null;}
// A future-dated stamp (clock skew, or a recovered estimate written into a timestamp
// field) made `Date.now()-stamp` negative, so the run never looked stale and the task
// could never be recovered: it sat "verifying"/"working" for hours while cron skipped it
// as if a live execution were running. An implausibly future stamp is stale too.
export function stale(run,at=Date.now()){const stamp=Date.parse(run?.heartbeatAt??run?.startedAt??'');if(!Number.isFinite(stamp))return true;const age=at-stamp;
  // A run past its absolute lifetime is stale even when its heartbeat is fresh. Without this
  // the heartbeat alone decided reclaimability, and a run whose terminal write never landed
  // could be kept alive forever — which blocked claimNextTask, the orphan sweep and
  // recoverStuckProjects at the same time, leaving the project permanently 'active' with no
  // runnable work and nothing left to recover.
  if(runOverLifetime(run,at))return true;return age>LEASE_MS||age<-LEASE_MS;}
function releaseAgent(task){if(!task?.agentId&&!task?.assignedAgentId)return;const agent=store.get('agents',task.agentId??task.assignedAgentId);if(agent)updateAgent(agent.id,{state:'available',currentTaskId:null,heartbeatAt:now()});}
function chooseAgent(task){const tools=task.requiredTools??task.toolNames??[];return selectAgents(task.requiredCapabilities??[],null,{requiredTools:tools,requireAllTools:true})[0]??selectAgents(task.requiredCapabilities??[],null,{requireAllTools:false})[0]??selectAgents(task.requiredCapabilities??[],null,{requiredTools:tools,requireAllTools:true,allowPartialCapabilities:true})[0]??null;}
// An agent is claimable when it is free — OR when it is busy with THIS task. assignTask()
// marks the agent 'assigned' to the task it assigns, and gates/generation tasks are
// created pre-assigned, so by the time the scheduler reaches a task the only agent able to
// run it is recorded as busy with that very task. Treating that as a conflict made
// claimNextTask return null forever: the blocked-retry loop re-assigned the task every tick
// (re-creating the same busy agent) and the pipeline never left its first gate — a project
// read "active" with two tasks stuck in [assigned] and every dependent stuck in [blocked].
function claimableBy(agent,task){
  if(!agent)return false;
  if(['available','registered'].includes(agent.state))return true;
  return agent.currentTaskId===task.id;
}
// An agent selected while still pointing at a different task would be double-booked. That
// happens whenever the previous owner's run died without releasing it, so release the stale
// claim before re-using the agent instead of leaving two tasks pointing at one agent.
// Returns the refreshed row: the caller must re-check the agent it was handed, not the
// pre-release snapshot.
function releaseStaleOwnership(agent,task){
  if(!agent?.currentTaskId||agent.currentTaskId===task.id)return agent;
  const owner=store.get('tasks',agent.currentTaskId);
  if(owner&&(!STUCK_STATES.has(owner.state)||activeRun(owner.id)))return agent;
  return updateAgent(agent.id,{state:'available',currentTaskId:null,heartbeatAt:now()})??agent;
}
export function claimNextTask(taskId){const task=store.get('tasks',taskId);if(!task||!RUNNABLE.has(task.state)||!dependenciesReady(task))return null;const project=task.projectId?store.get('projects',task.projectId):null;if(project?.state==='awaiting_approval')return null;const existing=activeRun(task.id);if(existing&&!stale(existing))return null;// The pre-assigned agent may be a stale duplicate that is busy/offline/cooldown
  // (agent table had ~60 copies per name from old cold-start registration). Fall back
  // to the best available agent instead of leaving the task stuck in 'assigned' forever.
  let agent=task.assignedAgentId?store.get('agents',task.assignedAgentId):null;
  if(!claimableBy(agent,task))agent=chooseAgent(task);
  // Free a recoverable agent from a previous owner that never released it BEFORE the
  // availability guard runs — selection deliberately returns agents that are busy but
  // recoverable, so releasing afterwards could never make one claimable.
  if(agent)agent=releaseStaleOwnership(agent,task);
  if(!claimableBy(agent,task))return null;
  if(task.assignedAgentId&&task.assignedAgentId!==agent.id){const old=store.get('agents',task.assignedAgentId);if(old&&old.currentTaskId===task.id)updateAgent(old.id,{state:'available',currentTaskId:null,heartbeatAt:now()});}
  const claimedAt=now();const claimed=store.put('tasks',{...task,state:'assigned',agentId:agent.id,assignedAgentId:agent.id,claimedAt,leaseUntil:new Date(Date.now()+LEASE_MS).toISOString(),updatedAt:claimedAt,id:task.id});updateAgent(agent.id,{state:'assigned',currentTaskId:task.id,heartbeatAt:claimedAt});store.addEvent('scheduler.task_claimed',{projectId:task.projectId,taskId:task.id,agentId:agent.id,at:claimedAt});return claimed;}
async function requeueAfterInfraFailure(task,reason,stamp,extra={}){
  const infra=Number(task.infraRecoveries??0)+1;
  if(infra>MAX_INFRA_RECOVERIES){
    await store.putDurable('tasks',{...task,state:'failed',error:reason,updatedAt:stamp,id:task.id});
    releaseAgent(task);
    store.addEvent('scheduler.task_failed',{projectId:task.projectId,taskId:task.id,reason,infraRecoveries:infra,at:stamp});
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
  // projectId belongs on every scheduler event: the project detail view is the founder's
  // audit trail, and a recovery recorded without it was invisible there — a project could be
  // silently requeued and re-claimed with no trace of why its task states kept changing.
  store.addEvent('scheduler.task_recovered',{projectId:task.projectId,taskId:task.id,reason,infraRecoveries:infra,nextState:'queued',at:stamp,...extra});
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
export async function runTask(taskId,env={},context={}){const claimed=claimNextTask(taskId);if(!claimed)return{status:'not-runnable',taskId};const started=startTask(taskId);if(!started)return{status:'not-runnable',taskId,reason:'task_start_failed'};const task=store.get('tasks',taskId),run=await executeTask(task,{...context,env,agentId:task.agentId}),check=verifyResult(task,run);if(run.state==='completed'&&check?.passed){markVerifying(task.id,check);const withCheck=await completeTask(task.id,run.result??check.result??null,{verificationId:check.id});return{status:'completed',task:withCheck,run,verification:check};}const attempt=Number(task.attempts??1),decision=retryDecision(task,check,attempt);if(decision?.action==='retry'&&attempt<Number(task.maxAttempts??DEFAULT_MAX_ATTEMPTS)){releaseAgent(task);const retryTask=store.put('tasks',{...task,state:'queued',assignedAgentId:null,agentId:null,updatedAt:now(),id:task.id});store.addEvent('scheduler.task_retry',{projectId:task.projectId,taskId:task.id,attempt,reason:run.error??check?.error??'verification failed'});return{status:'retry-queued',task:retryTask,run,verification:check};}const failedTask=await failTask(task.id,run.error??check?.error??'Task execution/verification failed',check?.id?{verificationId:check.id}:{});releaseAgent(task);store.addEvent('scheduler.task_failed',{projectId:task.projectId,taskId:task.id,at:now()});return{status:'failed',task:store.get('tasks',task.id),run,verification:check};}
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
  if(repairMissingVerificationIds(tasks))tasks=store.list('tasks').filter(t=>t.projectId===projectId);const hasRunning=tasks.some(t=>['working','assigned','verifying','running'].includes(t.state)),hasQueued=tasks.some(t=>RUNNABLE.has(t.state)&&dependenciesReady(t)),hasPending=tasks.some(t=>['queued','assigned','working','verifying','running'].includes(t.state)),hasFailed=tasks.some(t=>t.state==='failed'),hasBlocked=tasks.some(t=>t.state==='blocked'),qaTasks=tasks.filter(t=>t.finalProjectVerification),integrity=tasks.find(t=>t.pipelineGate&&t.gateType==='integrity'),qaPassed=qaTasks.length>0&&qaTasks.every(t=>t.state==='completed'&&t.verificationId),integrityPassed=Boolean(integrity&&integrity.state==='completed'&&integrity.verificationId),allCompleted=tasks.every(t=>t.state==='completed'||t.state==='cancelled');
  // A blocked pipeline with no pending/running work is terminal. Leaving it as active made
  // the dashboard claim that MAULI was still working when nothing could advance it.
  if(!hasPending&&hasBlocked&&!hasFailed&&!allCompleted){const blockedProject=await store.putDurable('projects',{...store.get('projects',projectId),state:'blocked',blockedAt:now(),blockedReason:'One or more tasks are blocked and no executable work remains.',id:projectId});store.addEvent('command.blocked',{projectId,runId,reason:blockedProject.blockedReason,at:now()});return{status:'blocked',runId,command:project.founderCommand,project:blockedProject,tasks,blockedReason:blockedProject.blockedReason};}
  if(hasRunning||hasQueued)return null;if(allCompleted&&qaPassed&&integrityPassed){
  // A delivery that refuses to build must never be swallowed into a silent success: the
  // project would read as 'completed' with nothing to download — the exact 'looks done,
  // delivers nothing' failure this gate exists to prevent. Record why and stay unfinished.
  let finalDelivery=project.finalDeliveryId?store.get('artifacts',project.finalDeliveryId):null;
  if(!finalDelivery){
    try{finalDelivery=await buildFinalDeliveryDurable(project,{enforceGates:true,env});}
    catch(error){
      const reason=String(error?.message??error);
      store.addEvent('delivery.blocked',{projectId,reason,at:now()});
      // Every task is terminal here, so there is nothing left for a later tick to advance:
      // leaving the project 'active' made it read as "still building" on the dashboard
      // forever, with a frozen percentage and no way to tell the run was over. Record the
      // refusal and take the project to a terminal state — honest, not a silent success.
      const blocked=await store.putDurable('projects',{...store.get('projects',projectId),state:'failed',failedAt:now(),blockedReason:`Delivery blocked: ${reason}`,id:projectId});
      const blockedResult={status:'failed',runId,command:project.founderCommand,project:blocked,tasks,error:`Delivery blocked: ${reason}`,blockedReason:`Delivery blocked: ${reason}`};
      await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result:blockedResult},env).catch(()=>null);
      store.addEvent('command.failed',{runId,projectId,status:'failed',reason:`Delivery blocked: ${reason}`,at:now()});
      return blockedResult;
    }
  }
  const finalDeliveryId=finalDelivery?.id??project.finalDeliveryId??null;finalProject=await store.putDurable('projects',{...project,state:'completed',finalDeliveryId,completedAt:project.completedAt??now(),id:project.id}),result={status:'completed',runId,command:project.founderCommand,project:finalProject,tasks,finalDelivery};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.completed',{runId,projectId,status:'completed',at:now()});return result;}if(hasFailed&&!hasQueued&&!hasRunning){const failedProject=await store.putDurable('projects',{...project,state:'failed',failedAt:project.failedAt??now(),id:project.id}),result={status:'failed',runId,command:project.founderCommand,project:failedProject,tasks,error:'One or more tasks failed after recovery/retry limits.'};await saveCommandResult({runId,command:project.founderCommand,generatedAt:now(),result},env).catch(()=>null);store.addEvent('command.failed',{runId,projectId,status:'failed',at:now()});return result;}return null;}
function indexTasksByProject(){const byProject=new Map();for(const task of store.list('tasks')){const key=task.projectId??'';let list=byProject.get(key);if(!list)byProject.set(key,list=[]);list.push(task);}return byProject;}
export async function schedulerTick(env={},context={}){
  // Every cron invocation may run in a different Worker isolate. Reconcile the scheduler's
  // in-memory view with only D1 rows newer than its per-type watermark before making any
  // claim/recovery decision. Without this, a newly-created or completed task in another
  // isolate could remain invisible and the project would sit assigned/active indefinitely.
  await store.syncFromD1(['projects','tasks','approvals','runs','verifications','executions','artifacts']).catch(error => {
    store.addEvent('scheduler.sync_error',{error:error?.message ?? String(error),at:now()});
  });
  // Internal application generation is autonomous. Older projects created before the
  // governance split may still be parked on an internal-code approval row; release only
  // those founder-command gates. Production/deployment/destructive/external/cost actions
  // remain approval-gated.
  for(const approval of store.list('approvals').filter(a=>a?.state==='pending'&&a?.projectId&&String(a.action??'').startsWith('Execute founder command:'))){
    const project=store.get('projects',approval.projectId);
    const command=String(project?.founderCommand??approval.action??'');
    const dangerous=/\\b(production|prod|deploy|deployment|publish|release|external api|third-party api|external service|pay|payment|paid|purchase|billing|charge|delete|destroy|drop|wipe|remove all|purge)\\b/i.test(command);
    if(project?.state==='awaiting_approval'&&approval.risk==='high'&&!dangerous){
      approveProject(approval,project,'Auto-approved internal autonomous build; execution-level governance remains active.');
    }
  }
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
    if(projectTasks.some(t=>['queued','assigned','working','verifying'].includes(t.state)) && !projectTasks.some(t=>t.state==='blocked'))continue;
    const final=await finalizeCommand(project.id,env,projectTasks).catch(()=>null);
    if(final)recovered.push(project.id);
  }
  const results=[];
  const drainProject=context?.projectId??null;
  // A founder-command/chat hand-off runs inside ctx.waitUntil (30s after the response).
  const handoff=context?.skipLongExecutors===true;
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
      // See LONG_EXECUTORS: a 30s hand-off window cannot finish a generation, so it must not
      // begin one. Planning and review tasks still run here, so the project visibly starts.
      const runnable=handoff?tasks.filter(t=>!LONG_EXECUTORS.has(t.executor)):tasks;
      let ran=0;
      // A bounded batch instead of a single lane: independent tasks whose agents differ now
      // run together. `overBudget()` is still checked per task, so the project budget caps the
      // whole batch exactly as it capped the serial loop.
      const batch=runnable.slice(0,taskLimit);
      const skipped=[];
      // Only a task the scheduler actually OFFERED and could not claim counts as stalled.
      // A task skipped merely because this tick ran out of budget is still ordinary queued
      // work and must never be failed by the stall pass.
      const unclaimable=[];
      await mapWithConcurrency(batch,agentConcurrency(env,context),async(task)=>{
        if(overBudget()){skipped.push(task);return;}
        const outcome=await runTask(task.id,env,context);
        results.push(outcome);ran++;
        if(outcome?.status==='not-runnable'){skipped.push(task);unclaimable.push(task);}
      });
      // A task skipped only because a sibling in the same batch held its agent for a moment is
      // not a failure — retry it sequentially now that the batch has released its agents, so
      // parallelism can never cost a task its turn.
      for(const task of skipped){
        if(overBudget())break;
        const outcome=await runTask(task.id,env,context);
        results.push(outcome);
        if(outcome?.status!=='not-runnable')ran++;
      }
      // Offered in this tick and still unclaimed after the stall window: no execution can
      // ever start it, so it must fail rather than keep the project looking alive.
      for(const task of unclaimable){
        const current=store.get('tasks',task.id);
        if(!current||!RUNNABLE.has(current.state))continue;
        const touched=Date.parse(current.updatedAt??current.claimedAt??current.createdAt??0);
        if(!Number.isFinite(touched)||Date.now()-touched<STALLED_RUNNABLE_MS)continue;
        const failure=await failTask(current.id,`Task could not be claimed for ${Math.round(STALLED_RUNNABLE_MS/60000)} minutes with its dependencies complete; no execution was ever started.`);
        if(failure){results.push({status:'failed',taskId:current.id,reason:'unclaimable'});store.addEvent('scheduler.task_stalled',{projectId,taskId:current.id,at:now()});}
      }
      // The delivery gate chain is sequential: a gate only becomes runnable when the previous
      // one completes. Advancing one gate per minute-long cron tick made the tail of every
      // project take most of ten minutes AFTER the code already existed. Planning, review and
      // gate tasks are cheap evaluations, so they are chained inside this tick — bounded by
      // the same budget, and never starting a model-calling executor here (it was offered
      // above, with its own budget).
      for(let round=0;round<3&&!overBudget();round++){
        const ready=(byProject.get(projectId)??[])
          .map(t=>store.get('tasks',t.id)??t)
          .filter(t=>RUNNABLE.has(t.state)&&dependenciesReady(t)&&!LONG_EXECUTORS.has(t.executor))
          .sort((a,b)=>Number(a.sequence??0)-Number(b.sequence??0));
        if(!ready.length)break;
        let progressed=0;
        for(const task of ready){
          if(overBudget())break;
          const outcome=await runTask(task.id,env,context);
          results.push(outcome);
          if(outcome?.status!=='not-runnable')progressed++;
        }
        if(!progressed)break;
      }
      // Re-read rather than reuse the pre-tick snapshot: the tasks above just changed state,
      // and a finalize verdict computed from the old rows either missed the completion or
      // counted finished work as pending for another tick.
      const freshTasks=store.list('tasks').filter(t=>t.projectId===projectId);
      const final=await finalizeCommand(projectId,env,freshTasks).catch(()=>null);
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
