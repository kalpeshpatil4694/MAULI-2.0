import { ok, fail, json, now } from './core.js';
import { store } from './store.js';
import { seedAgents, listAgents } from './agents.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { listApprovals, decideApproval } from './governance.js';
import { planCommand, resumeApprovedCommand } from './orchestrator.js';
import { listTools, ensureBuiltinTools } from './tools.js';
import { getArtifact, listProjectArtifacts, listTaskArtifacts } from './artifacts.js';
import { collectProjectFiles, createZip } from './zip.js';
import { ensureSchema, hasD1, d1List, d1Events } from './db.js';
import { recoverRunningExecutions } from './execution.js';
import { requireFounder, checkRateLimit } from './auth.js';
import { runL1SelfTest } from './self-test.js';
import { diagnoseResultPersistence, saveCommandResult } from './result-recorder.js';
import { dashboardHTML } from './dashboard.js';

function artifactJson(artifact) { return artifact ? ok({ artifact }) : fail('Artifact not found',404); }
function isIsolatedTestEnv(env) { return env?.SKIP_RESULT_PERSISTENCE === true || env?.SKIP_RESULT_PERSISTENCE === 'true' || env?.MAULI_TEST_MODE === true || env?.MAULI_TEST_MODE === 'true'; }

export default { async fetch(request, env) { try {
  await ensureSchema(env); store.configure(env); if(!store.hydrated) await store.hydrate(); ensureBuiltinTools(); seedAgents(); const recoveredRuns=recoverRunningExecutions(); const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/') return new Response(dashboardHTML(),{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store'}});
  if(request.method==='GET'&&url.pathname==='/api/health') return ok({service:'mauli2.0',status:'healthy',persistence:hasD1(env),hydrated:store.hydrated,ai:Boolean(env?.AI),recoveredRuns:recoveredRuns.length,time:now()});
  if(request.method==='GET'&&url.pathname==='/api/state'){const [agents,projects,tasks,approvals,events]=hasD1(env)?await Promise.all([d1List(env,'agents'),d1List(env,'projects'),d1List(env,'tasks'),d1List(env,'approvals'),d1Events(env)]):[listAgents(),listProjects(),listTasks(),listApprovals(),store.recentEvents()];return ok({agents,projects,tasks,approvals,tools:listTools(),artifacts:store.list('artifacts'),events,recoveredRuns});}
  if(request.method==='GET'&&url.pathname==='/api/self-test'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const result=runL1SelfTest();store.addEvent('self_test.completed',{score:result.score,status:result.status});return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/result-diagnostic'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const result=await diagnoseResultPersistence(env);store.addEvent('result_persistence.diagnostic',{ok:result.ok,tokenConfigured:result.tokenConfigured,reason:result.reason||null});return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/artifacts'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');const taskId=url.searchParams.get('taskId');const artifacts=projectId?listProjectArtifacts(projectId):taskId?listTaskArtifacts(taskId):store.list('artifacts');return ok({artifacts});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')&&url.pathname.endsWith('/download')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const artifactId=parts[parts.length-2];const artifact=getArtifact(artifactId);if(!artifact)return fail('Artifact not found',404);const files=collectProjectFiles(artifact.projectId,artifact,store);if(!files.length)return fail('No downloadable project files found',404);const zip=createZip(files);const safeName=String(artifact.projectId).replace(/[^a-zA-Z0-9_-]/g,'_');return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="mauli-${safeName}.zip"`,'cache-control':'no-store'}});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return artifactJson(getArtifact(url.pathname.split('/').pop()));}
  if(request.method==='POST'&&url.pathname==='/api/command'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const body=await json(request);if(!body.command)return fail('Founder command is required',400);const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const isolatedTest=isIsolatedTestEnv(env);const result=await planCommand(body.command,env);const persistedPayload={command:body.command,generatedAt:now(),result};const saved=isolatedTest ? {saved:true,skipped:true,testMode:true,reason:'Result persistence disabled for isolated test'} : await saveCommandResult(persistedPayload,env);if(!saved.saved)return fail('Command executed but Result file persistence failed',502,{resultFile:saved,result});return ok({result,resultFile:saved},201);}
  if(request.method==='POST'&&url.pathname.startsWith('/api/approvals/')){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const approvalId=url.pathname.split('/').pop();const body=await json(request);const result=decideApproval(approvalId,Boolean(body.approved),body.note??'');if(!result)return fail('Approval not found',404);if(result.state==='rejected')return ok({approval:result,status:'rejected'});return ok({approval:result,result:await resumeApprovedCommand(approvalId,env)});}
  return fail('Route not found',404);
} catch(error){return fail(error.message||'Internal error',500);} } };