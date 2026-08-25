import { ok, fail, json, now } from './core.js';
import { store } from './store.js';
import { seedAgents, listAgents } from './agents.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { listApprovals, decideApproval } from './governance.js';
import { resumeApprovedCommand } from './orchestrator.js';
import { listTools, ensureBuiltinTools } from './tools.js';
import { getArtifact, listProjectArtifacts, listTaskArtifacts } from './artifacts.js';
import { collectProjectFiles, createZip } from './zip.js';
import { ensureSchema, hasD1, d1List, d1Events } from './db.js';
import { recoverRunningExecutions } from './execution.js';
import { requireFounder, checkRateLimit } from './auth.js';
import { runL1SelfTest } from './self-test.js';
import { diagnoseResultPersistence } from './result-recorder.js';
import { listObserverEvents, getTaskTimeline, getProjectTimeline, getAgentTimeline, getExecutionTimeline, getVerificationTimeline, observerSummary } from './observer.js';
import { observerDashboard } from './observer-dashboard.js';
import { founderCommandCenter } from './founder-command-center.js';
import { productionSnapshot, isProductionHealthy } from './production.js';
import { modelRegistry } from './model-registry.js';
import { learningSnapshot } from './learning.js';
import { providerSnapshot } from './provider-independence.js';
import { createCommand, getCommand, listRecentCommands, startCommand } from './command-runtime.js';

function artifactJson(a){return a?ok({artifact:a}):fail('Artifact not found',404)}
function completionSafe(project,tasks){if(!project||project.state!=='completed')return true;return tasks.filter(t=>t.projectId===project.id).every(t=>t.state==='completed'||t.state==='failed')&&tasks.filter(t=>t.projectId===project.id).every(t=>t.state!=='queued'&&t.state!=='working')}

export default {async fetch(request,env,ctx){try{
  await ensureSchema(env);store.configure(env);if(!store.hydrated)await store.hydrate();ensureBuiltinTools();seedAgents();const recoveredRuns=recoverRunningExecutions();const url=new URL(request.url);
  if(request.method==='GET'&&(url.pathname==='/'||url.pathname==='/command-center'))return new Response(founderCommandCenter(),{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store'}});
  if(request.method==='GET'&&url.pathname==='/observer')return new Response(observerDashboard(),{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store'}});
  if(request.method==='GET'&&url.pathname==='/api/health'){const snapshot=productionSnapshot({env,recoveredRuns,store});return ok({service:'mauli2.0',status:isProductionHealthy(snapshot)?'healthy':'degraded',...snapshot,hydrated:store.hydrated,recoveredRuns:recoveredRuns.length,time:now()})}
  if(request.method==='GET'&&url.pathname==='/api/state'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const [agents,projects,tasks,approvals,events]=hasD1(env)?await Promise.all([d1List(env,'agents'),d1List(env,'projects'),d1List(env,'tasks'),d1List(env,'approvals'),d1Events(env)]):[listAgents(),listProjects(),listTasks(),listApprovals(),store.recentEvents()];
    const safeProjects=projects.map(p=>{const pt=tasks.filter(t=>t.projectId===p.id);return p.state==='completed'&&!completionSafe(p,pt)?{...p,state:'active',completionGuard:'blocked-until-all-tasks-finish'}:p});
    return ok({agents,projects:safeProjects,tasks,approvals,tools:listTools(),artifacts:store.list('artifacts'),events,recoveredRuns});
  }
  if(request.method==='GET'&&url.pathname==='/api/command-center'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    return ok({models:modelRegistry.list({enabledOnly:true}),providers:providerSnapshot().providers,learning:learningSnapshot(),memoryCount:store.list('memory').length,production:productionSnapshot({env,recoveredRuns,store})});
  }
  if(request.method==='GET'&&url.pathname==='/api/commands'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    return ok({commands:await listRecentCommands(env,Number(url.searchParams.get('limit')||20))});
  }
  if(request.method==='GET'&&url.pathname.startsWith('/api/commands/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const command=await getCommand(env,url.pathname.split('/').pop());
    return command?ok({command}):fail('Command not found',404);
  }
  if(request.method==='GET'&&url.pathname==='/api/observer'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const params={limit:url.searchParams.get('limit')??100,domain:url.searchParams.get('domain')??undefined,taskId:url.searchParams.get('taskId')??undefined,projectId:url.searchParams.get('projectId')??undefined,agentId:url.searchParams.get('agentId')??undefined,executionId:url.searchParams.get('executionId')??undefined,verificationId:url.searchParams.get('verificationId')??undefined,since:url.searchParams.get('since')??undefined};
    const events=listObserverEvents(params);return ok({events,summary:observerSummary(params)});
  }
  if(request.method==='GET'&&url.pathname==='/api/observer/timeline'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const limit=url.searchParams.get('limit')??200;const taskId=url.searchParams.get('taskId'),projectId=url.searchParams.get('projectId'),agentId=url.searchParams.get('agentId'),executionId=url.searchParams.get('executionId'),verificationId=url.searchParams.get('verificationId');
    if(taskId)return ok({timeline:getTaskTimeline(taskId,{limit})});if(projectId)return ok({timeline:getProjectTimeline(projectId,{limit})});if(agentId)return ok({timeline:getAgentTimeline(agentId,{limit})});if(executionId)return ok({timeline:getExecutionTimeline(executionId,{limit})});if(verificationId)return ok({timeline:getVerificationTimeline(verificationId,{limit})});return ok({timeline:listObserverEvents({limit})});
  }
  if(request.method==='GET'&&url.pathname==='/api/self-test'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const result=runL1SelfTest();store.addEvent('self_test.completed',{score:result.score,status:result.status});return ok({result})}
  if(request.method==='GET'&&url.pathname==='/api/result-diagnostic'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const result=await diagnoseResultPersistence(env);store.addEvent('result_persistence.diagnostic',{ok:result.ok,tokenConfigured:result.tokenConfigured,reason:result.reason||null});return ok({result})}
  if(request.method==='GET'&&url.pathname==='/api/artifacts'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId'),taskId=url.searchParams.get('taskId');return ok({artifacts:projectId?listProjectArtifacts(projectId):taskId?listTaskArtifacts(taskId):store.list('artifacts')})}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')&&url.pathname.endsWith('/download')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/'),artifactId=parts[parts.length-2],artifact=getArtifact(artifactId);if(!artifact)return fail('Artifact not found',404);const files=collectProjectFiles(artifact.projectId,artifact,store);if(!files.length)return fail('No downloadable project files found',404);const zip=createZip(files),safeName=String(artifact.projectId).replace(/[^a-zA-Z0-9_-]/g,'_');return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="mauli-${safeName}.zip"`,'cache-control':'no-store'}})}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return artifactJson(getArtifact(url.pathname.split('/').pop()))}
  if(request.method==='POST'&&url.pathname==='/api/command'){
    const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const body=await json(request);if(!body.command)return fail('Founder command is required',400);const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const command=await createCommand(env,String(body.command).trim());
    startCommand(env,command,ctx?.waitUntil?.bind(ctx));
    return ok({commandId:command.id,state:command.state,command:command.command},202);
  }
  if(request.method==='POST'&&url.pathname.startsWith('/api/approvals/')){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const approvalId=url.pathname.split('/').pop(),body=await json(request),result=decideApproval(approvalId,Boolean(body.approved),body.note??'');if(!result)return fail('Approval not found',404);if(result.state==='rejected')return ok({approval:result,status:'rejected'});return ok({approval:result,result:await resumeApprovedCommand(approvalId,env)})}
  return fail('Route not found',404)
}catch(error){return fail(error.message||'Internal error',500)}}};
