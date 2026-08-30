import { id, now } from './core.js';
import { store } from './store.js';
import { executeTool } from './tools.js';
import { code } from './ai.js';
import { registerArtifact } from './artifacts.js';
import { startTask, markVerifying, completeTask, failTask, assignTask } from './tasks.js';
import { verifyResult, retryDecision } from './verification.js';
import { executeWithAdapter } from './execution-adapter.js';
import { remember } from './memory.js';
import { registerExecutor, listExecutors, getExecutor, grantExecutor, getExecutorScope } from './executor-registry.js';
import './functional-code-executor.js';

export { registerExecutor, listExecutors, grantExecutor } from './executor-registry.js';

function requiredToolNames(task){return [...new Set((task?.toolNames??task?.requiredTools??[]).map(String).filter(Boolean))];}
async function authorizeRequiredTools(task, context, callTool){const required=requiredToolNames(task);const results=[];for(const name of required){const tool=store.list('tools').find(t=>t.name===name&&t.enabled!==false);if(!tool)throw new Error(`Required tool is not registered: ${name}`);const toolContext={type:'authorization-check',taskId:task.id};const authorization=await callTool(name,toolContext);results.push({name,authorization});}return results;}
function persistExecution(record) { store.put('executions', { ...record, status: record.state, executionId: record.id }); return record; }
function publicExecution(record) { return { ...record, status: record.state, executionId: record.id }; }
function grantedApprovalForTask(task) { return store.list('approvals').find(approval => approval.state === 'approved' && (approval.taskId === task?.id || (!approval.taskId && approval.projectId === task?.projectId))) ?? null; }
function recordExecutionMemory(task, execution) { const base={scope:'task',scopeId:task?.id??null,source:'execution',tags:[task?.executor,...(task?.requiredCapabilities??[])].filter(Boolean)}; remember({type:'task_result',content:{taskId:task?.id??null,status:execution?.state??'unknown',result:execution?.result??null,executionId:execution?.executionId??execution?.id??null},importance:execution?.state==='completed'?'normal':'high',...base}); if(execution?.state==='completed'){remember({type:'solution',content:{taskId:task?.id??null,summary:'Task execution completed successfully.',executionId:execution?.executionId??execution?.id??null},importance:'normal',...base});} else if(execution?.error){remember({type:'error',content:{taskId:task?.id??null,error:execution.error},importance:'high',...base});} }

export async function executeTask(task, context = {}) {
  const executorName = task.executor ?? 'internal.plan';
  const executor = getExecutor(executorName);
  const existing = task.id ? store.list('runs').filter(r => r.taskId === task.id && r.state === 'running').sort((a,b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0] : null;
  if (existing && !context.forceRestart) { store.addEvent('execution.recovered', { runId: existing.id, taskId: task.id, executor: executorName }); return publicExecution(existing); }
  const run = { id:id('run'), taskId:task.id, executor:executorName, state:'running', startedAt:now(), attempt:context.attempt ?? 1, agentId:task.agentId ?? task.assignedAgentId ?? context.agentId ?? null, recoverable:true };
  store.put('runs', run); store.addEvent('execution.started', run);
  try {
    if (!executor) throw new Error(`No executor registered: ${executorName}`);
    const scope = getExecutorScope(executorName, executor.scope ?? 'internal');
    if (scope === 'external' && !context.allowExternal) throw new Error('External execution permission is not granted');
    if ((executor.risk === 'critical' || task.risk === 'critical') && !context.approved) throw new Error('Critical execution requires explicit approval');
    const callTool=(name,input={})=>executeTool(name,input,{...context,agentId:run.agentId,projectId:task.projectId,approved:context.approved,approvalId:context.approvalId});
    const requiredTools=await authorizeRequiredTools(task,context,callTool);
    const result = await executor.handler({ task, ...context, agentId:run.agentId, callTool, requiredTools });
    const completed = { ...run, state:'completed', result, requiredTools, completedAt:now(), recoverable:false };
    store.put('runs',completed); persistExecution(completed); recordExecutionMemory(task,completed); store.addEvent('execution.completed',completed); return publicExecution(completed);
  } catch(error) {
    const failed={...run,state:'failed',error:error.message,completedAt:now(),recoverable:false};
    store.put('runs',failed); persistExecution(failed); recordExecutionMemory(task,failed); store.addEvent('execution.failed',failed); return publicExecution(failed);
  }
}

export async function executeTaskLifecycle(task, context = {}) {
  if (!task?.id) return { status:'failed', error:'Task is required' };
  let currentTask=store.get('tasks',task.id)??task;
  const grantedApproval=grantedApprovalForTask(currentTask);
  const lifecycleContext={...context,approved:context.approved||Boolean(grantedApproval),approvalId:context.approvalId??grantedApproval?.id};
  if (currentTask.agentId==null&&currentTask.assignedAgentId!=null) currentTask=store.put('tasks',{...currentTask,agentId:currentTask.assignedAgentId,id:currentTask.id});
  if(currentTask.state==='blocked'){
    const dependenciesComplete=(currentTask.dependsOn??[]).every(depId=>store.get('tasks',depId)?.state==='completed');
    if(!dependenciesComplete&&!lifecycleContext.dependenciesComplete)return{status:'blocked',task:currentTask,reason:currentTask.blockedReason??'Dependencies incomplete'};
    const ready=store.put('tasks',{...currentTask,state:'queued',blockedReason:null,id:currentTask.id});
    currentTask=ready;
  }
  if(currentTask.state==='completed')return{status:'completed',task:currentTask};
  if(currentTask.state==='verifying')return{status:'verifying',task:currentTask};
  if(currentTask.state!=='running')startTask(currentTask.id);
  const execution=await executeTask({...currentTask,state:'running'},lifecycleContext);
  if(execution.state==='completed'){markVerifying(currentTask.id);const verification=await verifyResult(currentTask,execution,{...lifecycleContext,attempt:execution.attempt});if(verification?.verified){completeTask(currentTask.id,verification.result??execution.result);return{status:'completed',task:store.get('tasks',currentTask.id),execution,verification};}const retry=retryDecision(currentTask,execution,verification);if(retry?.retry){return executeTaskLifecycle(store.get('tasks',currentTask.id)??currentTask,{...lifecycleContext,attempt:(execution.attempt??1)+1});}failTask(currentTask.id,verification?.error??'Verification failed');return{status:'failed',task:store.get('tasks',currentTask.id),execution,verification};}
  failTask(currentTask.id,execution.error??'Execution failed');
  return {status:'failed',task:store.get('tasks',currentTask.id),execution};
}

export function recoverRunningExecutions(){
  return store.list('runs').filter(run=>run.state==='running').map(run=>{
    store.addEvent('execution.recovery_candidate',{runId:run.id,taskId:run.taskId,executor:run.executor});
    return run;
  });
}

export function getExecutorHandler(name){ return getExecutor(name)?.handler ?? null; }