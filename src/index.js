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
import { ensureSchema, hasD1, d1List, d1Events, claimBuildVersion, getBuildVersion } from './db.js';
import { recoverRunningExecutions } from './execution.js';
import { requireFounder, checkRateLimit } from './auth.js';
import { runL1SelfTest } from './self-test.js';
import { diagnoseResultPersistence, saveCommandResult, listCommandResults, getCommandResult } from './result-recorder.js';
import { dashboardHTML } from './dashboard.js';
import { sendMessage, getMessages, acknowledgeMessage, respondToMessage, requestReview, handoffTask, broadcastAlert, getCollaborationStats } from './agent-communication.js';
import { getAgentSkillTree, getAgentCollaborationStats, getSystemLearningStats, getBestAgentForTask } from './agent-learning.js';
import { processChatMessage, getChatHistory, getActiveConversations, cloneProject } from './chat-engine.js';
import { editFile, getEditHistory, getRecentEdits, undoEdit, getFileChangeSummary, parseEditCommand } from './file-editor.js';
import { recordActivity, getActivityFeed, getProjectProgress, getLiveStatus, createSubAgent, getSubAgents, requestHelp, getAgentConversation } from './live-monitor.js';
import { generateProjectDocs } from './docs-generator.js';
import { searchAPIs, recommendAPIs, getAPICatalog, getAPICategories } from './public-apis.js';
import { getMCPForAgent, getMCPByCapability, getAllMCPServers, getMCPCategories, suggestMCPForProject } from './mcp-integration.js';
import { checkOllama, ollamaGenerate, ollamaChat, ollamaCode, getRecommendedModels, getModelForTask } from './ollama-ai.js';
import { scrapePage, researchTopic } from './scraper.js';
import { getFreeServices, getServicesByCategory, getServiceCategories, estimateFreeTierCost } from './free-services.js';
import { generateDesignCSS, getThemes, createDesignSystem } from './design-system.js';
import { getAgentPatterns, getPatternForProject, getPatternCategories } from './agent-patterns.js';

function artifactJson(artifact) { return artifact ? ok({ artifact }) : fail('Artifact not found',404); }
function isIsolatedTestEnv(env) { return env?.SKIP_RESULT_PERSISTENCE === true || env?.SKIP_RESULT_PERSISTENCE === 'true' || env?.MAULI_TEST_MODE === true || env?.MAULI_TEST_MODE === 'true'; }

export default { async fetch(request, env) { try {
  await ensureSchema(env); store.configure(env); if(!store.hydrated) await store.hydrate(); ensureBuiltinTools(); seedAgents(); const recoveredRuns=recoverRunningExecutions(); const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/') return new Response(dashboardHTML(),{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store'}});
  if(request.method==='GET'&&url.pathname==='/api/health') return ok({service:'mauli2.0',status:'healthy',persistence:hasD1(env),hydrated:store.hydrated,ai:Boolean(env?.AI),recoveredRuns:recoveredRuns.length,time:now()});
  if(request.method==='GET'&&url.pathname==='/api/heartbeat') return ok({alive:true,uptime:Date.now(),heartbeat:now(),builds:store.list('builds').length,projects:store.list('projects').length,agents:store.list('agents').length});
  if(request.method==='POST'&&url.pathname==='/api/reset'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request).catch(()=>({}));const keepAgents=body.keepAgents!==false;const before={projects:store.list('projects').length,tasks:store.list('tasks').length,artifacts:store.list('artifacts').length};store.put('projects',[]);store.put('tasks',[]);store.put('artifacts',[]);store.put('builds',[]);store.put('events',[]);store.put('approvals',[]);if(!keepAgents){const agents=store.list('agents');const fresh=agents.filter(a=>a._builtin);store.put('agents',fresh);}await store.flush();store.addEvent('system.reset',{before,keepAgents,time:now()});return ok({reset:true,before,keepAgents});}
  if(request.method==='GET'&&url.pathname==='/api/state'){const [agents,projects,tasks,approvals,events]=hasD1(env)?await Promise.all([d1List(env,'agents'),d1List(env,'projects'),d1List(env,'tasks'),d1List(env,'approvals'),d1Events(env)]):[listAgents(),listProjects(),listTasks(),listApprovals(),store.recentEvents()];return ok({agents,projects,tasks,approvals,tools:listTools(),artifacts:store.list('artifacts'),events,recoveredRuns});}
  if(request.method==='GET'&&url.pathname==='/api/self-test'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const result=runL1SelfTest();store.addEvent('self_test.completed',{score:result.score,status:result.status});return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/result-diagnostic'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});try{const result=await Promise.race([diagnoseResultPersistence(env),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))]);store.addEvent('result_persistence.diagnostic',{ok:result.ok,tokenConfigured:result.tokenConfigured,reason:result.reason||null});return ok({result});}catch(e){return ok({result:{ok:false,tokenConfigured:false,reason:e.message||'Diagnostic failed'}})}}
  // List all command results
  if(request.method==='GET'&&url.pathname==='/api/results'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const results=listCommandResults();return ok({results,count:results.length});}
  // Get specific command result
  if(request.method==='GET'&&url.pathname.startsWith('/api/results/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const rid=url.pathname.split('/api/results/')[1];const r=getCommandResult(rid);if(!r)return fail('Result not found',404);return ok({result:r});}
  // Agent Messages API
  if(request.method==='GET'&&url.pathname==='/api/messages'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const agentId=url.searchParams.get('agentId');if(!agentId)return fail('agentId required',400);const msgs=getMessages(agentId,{unread:url.searchParams.get('unread')==='true'});return ok({messages:msgs});}
  if(request.method==='POST'&&url.pathname==='/api/messages/send'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const msg=sendMessage(body);return ok({message:msg});}
  if(request.method==='POST'&&url.pathname.startsWith('/api/messages/')&&url.pathname.endsWith('/acknowledge')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const msgId=parts[parts.length-2];const body=await request.json();const msg=acknowledgeMessage(msgId,body.agentId);return ok({message:msg});}
  if(request.method==='POST'&&url.pathname.startsWith('/api/messages/')&&url.pathname.endsWith('/respond')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const msgId=parts[parts.length-2];const body=await request.json();const msg=respondToMessage(msgId,body.agentId,body.response);return ok({message:msg});}
  if(request.method==='POST'&&url.pathname==='/api/messages/broadcast'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const msgs=broadcastAlert(body);return ok({messages:msgs});}
  // Learning & Skills API
  if(request.method==='GET'&&url.pathname==='/api/learning/stats'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({stats:getSystemLearningStats()});}
  if(request.method==='GET'&&url.pathname==='/api/learning/skill-tree'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const agentId=url.searchParams.get('agentId');if(!agentId)return fail('agentId required',400);return ok({skillTree:getAgentSkillTree(agentId),collaboration:getAgentCollaborationStats(agentId)});}
  if(request.method==='GET'&&url.pathname==='/api/collaboration/stats'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({stats:getCollaborationStats()});}
  if(request.method==='GET'&&url.pathname==='/api/agents/best'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const caps=(url.searchParams.get('capabilities')||'').split(',').filter(Boolean);const best=getBestAgentForTask(caps);return ok({agent:best});}
  // Chat API
  if(request.method==='POST'&&url.pathname==='/api/chat'){try{const body=await request.json();const result=await processChatMessage({message:body.message,userId:'founder',env});return ok({result});}catch(e){return ok({result:{reply:'I had trouble processing that. Try again!',error:e.message}})}}
  if(request.method==='GET'&&url.pathname==='/api/chat/history'){const limit=parseInt(url.searchParams.get('limit')||'50');return ok({messages:getChatHistory({limit})});}
  if(request.method==='GET'&&url.pathname==='/api/chat/active'){return ok({conversations:getActiveConversations()});}
  // File Edit API
  if(request.method==='POST'&&url.pathname==='/api/edits'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const edit=editFile(body);return ok({edit});}
  if(request.method==='GET'&&url.pathname==='/api/edits/recent'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({edits:getRecentEdits()});}
  if(request.method==='GET'&&url.pathname==='/api/edits/history'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');if(!projectId)return fail('projectId required',400);return ok({edits:getEditHistory(projectId)});}
  if(request.method==='POST'&&url.pathname.startsWith('/api/edits/')&&url.pathname.endsWith('/undo')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const editId=parts[parts.length-2];const result=undoEdit(editId);return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/edits/summary'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');if(!projectId)return fail('projectId required',400);return ok({summary:getFileChangeSummary(projectId)});}
  if(request.method==='POST'&&url.pathname==='/api/edits/parse'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const parsed=parseEditCommand(body.text);return ok({parsed});}
  // Live Monitor API
  if(request.method==='GET'&&url.pathname==='/api/live-status'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({status:getLiveStatus()});}
  if(request.method==='GET'&&url.pathname==='/api/activity'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');const agentId=url.searchParams.get('agentId');const limit=parseInt(url.searchParams.get('limit')||'50');return ok({activities:getActivityFeed({limit,projectId,agentId})});}
  if(request.method==='POST'&&url.pathname==='/api/activity'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const activity=recordActivity(body);return ok({activity});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/project-progress/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const pid=parts[parts.length-1];return ok({progress:getProjectProgress(pid)});}
  // Sub-Agent API
  if(request.method==='POST'&&url.pathname==='/api/sub-agents'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const sub=createSubAgent(body);return ok({subAgent:sub});}
  if(request.method==='GET'&&url.pathname==='/api/sub-agents'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parentId=url.searchParams.get('parentId');if(!parentId)return fail('parentId required',400);return ok({subAgents:getSubAgents(parentId)});}
  if(request.method==='POST'&&url.pathname==='/api/agent-help'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const msg=requestHelp(body);return ok({message:msg});}
  if(request.method==='GET'&&url.pathname==='/api/agent-conversation'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const a1=url.searchParams.get('agent1');const a2=url.searchParams.get('agent2');if(!a1||!a2)return fail('agent1 and agent2 required',400);return ok({messages:getAgentConversation(a1,a2)});}
  // Clone API
  if(request.method==='POST'&&url.pathname==='/api/clone'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=cloneProject(body.projectId,body.newObjective);return ok({result});}
  // Documentation API
  if(request.method==='GET'&&url.pathname.startsWith('/api/docs/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const pid=parts[parts.length-1];const docs=generateProjectDocs(pid);return ok({docs});}
  // Public APIs Integration
  if(request.method==='GET'&&url.pathname==='/api/apis/search'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const q=url.searchParams.get('q')||'';return ok({apis:searchAPIs(q)});}
  if(request.method==='GET'&&url.pathname==='/api/apis/recommend'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const obj=url.searchParams.get('objective')||'';return ok({recommendations:recommendAPIs(obj)});}
  if(request.method==='GET'&&url.pathname==='/api/apis/catalog'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({catalog:getAPICatalog(),categories:getAPICategories()});}
  // MCP Integration
  if(request.method==='GET'&&url.pathname==='/api/mcp/servers'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({servers:getAllMCPServers(),categories:getMCPCategories()});}
  if(request.method==='GET'&&url.pathname==='/api/mcp/for-agent'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const agent=url.searchParams.get('agent');return ok({servers:getMCPForAgent(agent)});}
  if(request.method==='GET'&&url.pathname==='/api/mcp/suggest'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const obj=url.searchParams.get('objective')||'';return ok({servers:suggestMCPForProject(obj)});}
  // Ollama Integration
  if(request.method==='GET'&&url.pathname==='/api/ollama/status'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const status=await checkOllama();return ok({status,models:getRecommendedModels()});}
  if(request.method==='POST'&&url.pathname==='/api/ollama/generate'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=await ollamaGenerate(body.prompt,body.options);return ok({result});}
  if(request.method==='POST'&&url.pathname==='/api/ollama/chat'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=await ollamaChat(body.messages,body.options);return ok({result});}
  if(request.method==='POST'&&url.pathname==='/api/ollama/code'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=await ollamaCode(body.prompt,body.options);return ok({result});}
  // Scraper
  if(request.method==='GET'&&url.pathname==='/api/scrape'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const target=url.searchParams.get('url');if(!target)return fail('url required',400);const result=await scrapePage(target);return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/research'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const q=url.searchParams.get('q')||'';const result=await researchTopic(q);return ok({result});}
  // Free Services
  if(request.method==='GET'&&url.pathname==='/api/free-services'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const type=url.searchParams.get('type')||'web';return ok({services:getFreeServices(type),categories:getServiceCategories(),estimate:estimateFreeTierCost(type)});}
  // Design System
  if(request.method==='GET'&&url.pathname==='/api/design/themes'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({themes:getThemes()});}
  if(request.method==='GET'&&url.pathname==='/api/design/css'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const theme=url.searchParams.get('theme')||'dark';return ok({css:generateDesignCSS(theme)});}
  // Agent Patterns
  if(request.method==='GET'&&url.pathname==='/api/patterns'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({patterns:getPatternCategories()});}
  if(request.method==='GET'&&url.pathname==='/api/patterns/recommend'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const obj=url.searchParams.get('objective')||'';const pattern=getPatternForProject(obj);return ok({pattern});}
  if(request.method==='GET'&&url.pathname==='/api/artifacts'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');const taskId=url.searchParams.get('taskId');const artifacts=projectId?listProjectArtifacts(projectId):taskId?listTaskArtifacts(taskId):store.list('artifacts');return ok({artifacts});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')&&url.pathname.endsWith('/download')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const artifactId=parts[parts.length-2];const artifact=getArtifact(artifactId);if(!artifact)return fail('Artifact not found',404);let files=collectProjectFiles(artifact.projectId,artifact,store);if(!files.length){const tasks=store.list('tasks').filter(t=>t.projectId===artifact.projectId);const summary=[];summary.push({path:'README.md',content:`# MAULI 2.0 — Project Delivery\n\n## Project\n- **ID:** ${artifact.projectId}\n- **Type:** ${artifact.type}\n- **Delivered:** ${new Date().toISOString()}\n\n## Tasks (${tasks.length})\n${tasks.map(t=>`- [${t.state}] ${t.title}${t.assignedAgentId?' (Agent: '+t.assignedAgentId+')':''}`).join('\n')}\n`});summary.push({path:'project-data.json',content:JSON.stringify({projectId:artifact.projectId,type:artifact.type,content:artifact.content,metadata:artifact.metadata},null,2)});files=summary;}const zip=createZip(files);const safeName=String(artifact.projectId).replace(/[^a-zA-Z0-9_-]/g,'_');return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="mauli-${safeName}.zip"`,'cache-control':'no-store'}});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return artifactJson(getArtifact(url.pathname.split('/').pop()));}
  if(request.method==='POST'&&url.pathname==='/api/command'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const body=await json(request);if(!body.command)return fail('Founder command is required',400);const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const isolatedTest=isIsolatedTestEnv(env);let result;try{result=await Promise.race([planCommand(body.command,env),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),60000))]);}catch(e){return ok({result:{status:'error',error:e.message,command:body.command}});}const persistedPayload={command:body.command,generatedAt:now(),result};const saved=isolatedTest?{saved:true,skipped:true,testMode:true}:await saveCommandResult(persistedPayload,env).catch(()=>({saved:false}));return ok({result,resultFile:saved},201);}
  if(request.method==='POST'&&url.pathname.startsWith('/api/approvals/')){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const approvalId=url.pathname.split('/').pop();const body=await json(request);const result=decideApproval(approvalId,Boolean(body.approved),body.note??'');if(!result)return fail('Approval not found',404);if(result.state==='rejected')return ok({approval:result,status:'rejected'});return ok({approval:result,result:await resumeApprovedCommand(approvalId,env)});}
  // ── BUILD APP: Auto-push to GitHub + trigger .apk/.exe build ──
  if(request.method==='POST'&&url.pathname==='/api/build-app'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const body=await json(request);
    const projectId=body.projectId;const platform=body.platform||'android';
    if(!projectId)return fail('projectId required',400);
    const codeArtifacts=store.list('artifacts').filter(a=>a.projectId===projectId&&a.type==='code-workspace');
    const latest=codeArtifacts.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    if(!latest)return fail('No code artifact found for this project. Run the command first.',404);
    const files=collectProjectFiles(projectId,latest,store);
    if(!files.length)return fail('No buildable files in artifact',404);
    // Push files to GitHub
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=env?.GITHUB_RESULT_REPO||'kalpeshpatil4694/MAULI-2.0';
    const buildId='build_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const safeProjectId=String(projectId).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'unknown';
    const buildBranch='build/project-'+safeProjectId;
    const startedAt=now();
    const previousBuilds=store.list('builds').filter(b=>b.projectId===projectId&&!['success','failed','cancelled','superseded'].includes(b.status));
    for(const previous of previousBuilds) store.put('builds',{...previous,status:'superseded',supersededBy:buildId,supersededAt:startedAt});
    if(hasD1(env)) await claimBuildVersion(env,projectId,buildId,buildBranch,startedAt); else store.put('build_locks',{id:'project:'+projectId,projectId,buildId,branch:buildBranch,startedAt,status:'active'});
    if(!token)return fail('GitHub token not configured. Add GITHUB_TOKEN env var.',500);
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder','Content-Type':'application/json'};
    // Create the build branch from main first
    const mainRef=await fetch('https://api.github.com/repos/'+repo+'/git/refs/heads/main',{headers:ghHeaders});
    const mainData=await mainRef.json();
    const mainSha=mainData?.object?.sha;
    if(!mainSha)return fail('Unable to resolve main branch',502,{buildId,repo});
    const branchRuns=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?branch='+encodeURIComponent(buildBranch)+'&per_page=20',{headers:ghHeaders}).then(r=>r.ok?r.json():({workflow_runs:[]})).catch(()=>({workflow_runs:[]}));
    for(const run of branchRuns.workflow_runs||[]) if(['queued','in_progress'].includes(run.status)){await fetch('https://api.github.com/repos/'+repo+'/actions/runs/'+run.id+'/cancel',{method:'POST',headers:ghHeaders}).catch(()=>{});}
    await fetch('https://api.github.com/repos/'+repo+'/git/refs/heads/'+encodeURIComponent(buildBranch),{method:'DELETE',headers:ghHeaders}).catch(()=>{});
    const createBranch=await fetch('https://api.github.com/repos/'+repo+'/git/refs',{method:'POST',headers:ghHeaders,body:JSON.stringify({ref:'refs/heads/'+buildBranch,sha:mainSha})});
    if(!createBranch.ok){const text=await createBranch.text().catch(()=>"");return fail('Unable to create clean build branch',502,{buildId,repo,branch:buildBranch,error:text.substring(0,200)});}
    // Push each file to GitHub
    let pushed=0;
    for(const file of files){
      const current=hasD1(env)?await getBuildVersion(env,projectId):store.get('build_locks','project:'+projectId);
      if(current?.buildId!==buildId)return ok({buildId,status:'superseded',supersededBy:current?.buildId||null,pushed});
      const path=file.path;
      const content=typeof btoa==='function'?btoa(unescape(encodeURIComponent(file.content))):Buffer.from(file.content).toString('base64');
      // Check if file exists
      const checkUrl='https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent(path)+'?ref='+buildBranch;
      const checkResp=await fetch(checkUrl,{headers:ghHeaders});
      let sha=null;
      if(checkResp.ok){const d=await checkResp.json();sha=d.sha;}
      const putBody={message:'MAULI build: '+buildId+' add '+file.path,content,branch:buildBranch};
      if(sha)putBody.sha=sha;
      const putResp=await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent(path),{method:'PUT',headers:ghHeaders,body:JSON.stringify(putBody)});
      if(putResp.ok){pushed++;}else{const errText=await putResp.text().catch(()=>"");store.addEvent('build.push_error',{path:file.path,status:putResp.status,error:errText.substring(0,200)});}
    }
    // Push the build-app.yml workflow to the build branch
    const wfLines=[];
    wfLines.push('name: Build App');
    wfLines.push('on:');
    wfLines.push('  push:');
    wfLines.push('    paths:');
    wfLines.push("      - '.github/workflows/build-apps.yml'");
    wfLines.push('concurrency:');
    wfLines.push('  group: mauli-build-$'+'{{ github.ref }}');
    wfLines.push('  cancel-in-progress: true');
    wfLines.push('jobs:');
    wfLines.push('  build-android:');
    wfLines.push('    name: Build Android APK');
    wfLines.push('    runs-on: ubuntu-latest');
    wfLines.push('    timeout-minutes: 30');
    wfLines.push('    steps:');
    wfLines.push('      - uses: actions/checkout@v4');
    wfLines.push('      - uses: actions/setup-java@v4');
    wfLines.push('        with:');
    wfLines.push('          distribution: temurin');
    wfLines.push('          java-version: 17');
    wfLines.push('      - uses: actions/setup-node@v4');
    wfLines.push('        with:');
    wfLines.push('          node-version: 20');
    wfLines.push('      - name: Validate source files');
    wfLines.push('        run: |');
    wfLines.push('          set -e');
    wfLines.push('          test -s www/index.html');
    wfLines.push('          test -s www/app.js');
    wfLines.push('          test -s www/styles.css');
    wfLines.push('          test -s package.json');
    wfLines.push('          echo \"Source files validated\"');
    wfLines.push('      - name: Setup Capacitor Android');
    wfLines.push('        run: |');
    wfLines.push('          npm install --no-audit --no-fund');
    wfLines.push('          npm install --no-audit --no-fund @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6');
    wfLines.push('          npx cap add android');
    wfLines.push('          npx cap sync android');
    wfLines.push('      - name: Build release APK');
    wfLines.push('        run: |');
    wfLines.push('          cd android');
    wfLines.push('          chmod +x gradlew');
    wfLines.push('          ./gradlew assembleRelease --no-daemon');
    wfLines.push('      - name: Verify APK');
    wfLines.push('        run: |');
    wfLines.push('          test -s android/app/build/outputs/apk/release/*.apk');
    wfLines.push('          echo \"APK built successfully\"');
    wfLines.push('      - uses: actions/upload-artifact@v4');
    wfLines.push('        with:');
    wfLines.push('          name: android-apk');
    wfLines.push('          path: android/app/build/outputs/apk/release/*.apk');
    wfLines.push('          if-no-files-found: error');
    wfLines.push('          retention-days: 14');
    wfLines.push('  build-desktop:');
    wfLines.push('    name: Build Desktop App');
    wfLines.push('    runs-on: ubuntu-latest');
    wfLines.push('    timeout-minutes: 20');
    wfLines.push('    steps:');
    wfLines.push('      - uses: actions/checkout@v4');
    wfLines.push('      - uses: actions/setup-node@v4');
    wfLines.push('        with:');
    wfLines.push('          node-version: 20');
    wfLines.push('      - name: Validate source files');
    wfLines.push('        run: |');
    wfLines.push('          set -e');
    wfLines.push('          test -s www/index.html');
    wfLines.push('          test -s www/app.js');
    wfLines.push('          test -s www/styles.css');
    wfLines.push('          echo \"Source files validated\"');
    wfLines.push('      - name: Setup Electron');
    wfLines.push('        run: |');
    wfLines.push('          mkdir -p electron');
    wfLines.push('          test -s electron/main.js || printf \'%s\\n\' \'const{app,BrowserWindow}=require(\\"electron\\");const path=require(\\"path\\");function createWindow(){const win=new BrowserWindow({width:1200,height:800,webPreferences:{nodeIntegration:true,contextIsolation:false}});win.loadFile(path.join(__dirname,\\"../www/index.html\\\"));}app.whenReady().then(createWindow);app.on(\\"window-all-closed\\",()=>{if(process.platform!==\\"darwin\\")app.quit()});\' > electron/main.js');
    wfLines.push('          npm install --no-audit --no-fund --save-dev electron@28 electron-builder@24');
    wfLines.push('      - name: Build Desktop AppImage');
    wfLines.push('        run: npx electron-builder --linux AppImage --publish never');
    wfLines.push('      - name: Verify Desktop');
    wfLines.push('        run: test -s dist/*.AppImage');
    wfLines.push('      - uses: actions/upload-artifact@v4');
    wfLines.push('        with:');
    wfLines.push('          name: desktop-exe');
    wfLines.push('          path: dist/*.AppImage');
    wfLines.push('          if-no-files-found: error');
    wfLines.push('          retention-days: 14');
    const latestBeforeWorkflow=hasD1(env)?await getBuildVersion(env,projectId):store.get('build_locks','project:'+projectId);
    if(latestBeforeWorkflow?.buildId!==buildId)return ok({buildId,status:'superseded',supersededBy:latestBeforeWorkflow?.buildId||null,pushed});
    const wfContent=wfLines.join('\n');
    const wfBase64=typeof btoa==='function'?btoa(unescape(encodeURIComponent(wfContent))):Buffer.from(wfContent).toString('base64');
    const wfCheck=await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent('.github/workflows/build-apps.yml')+'?ref='+buildBranch,{headers:ghHeaders});
    let wfSha=null;if(wfCheck.ok){const d=await wfCheck.json();wfSha=d.sha;}
    const wfBody={message:'MAULI build: '+buildId+' workflow',content:wfBase64,branch:buildBranch};
    if(wfSha)wfBody.sha=wfSha;
    await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent('.github/workflows/build-apps.yml'),{method:'PUT',headers:ghHeaders,body:JSON.stringify(wfBody)});
    // Store build info
    store.put('builds',{id:buildId,projectId,platform,repo,branch:buildBranch,pushedAt:now(),startedAt,status:pushed>0?'pushed':'failed',filesPushed:pushed,supersededBy:null});
    store.addEvent('build.started',{buildId,projectId,platform,pushed});
    if(pushed===0){return fail('GitHub token does not have push permissions. The token may be expired or missing repo scope. Please check the GITHUB_TOKEN in Settings > Environment.',500,{buildId,pushed,repo,branch:buildBranch});}
    return ok({buildId,platform,pushed,repo,branch:buildBranch,status:'pushed',message:pushed+' files pushed to GitHub. Build will start shortly.'});
  }
  // ── BUILD STATUS: Poll GitHub Actions status ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/build-status/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const buildId=url.pathname.split('/').pop();
    const build=store.list('builds').find(b=>b.id===buildId);
    if(!build)return fail('Build not found',404);
    if(build.status==='superseded')return ok({buildId,status:'superseded',supersededBy:build.supersededBy||null,downloadUrl:null,pushedAt:build.pushedAt,platform:build.platform,filesPushed:build.filesPushed});
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=build.repo||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return ok({...build,status:'pushed',message:'GitHub token not configured'});
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder'};
    // Check latest workflow run for this branch/path
    const runsResp=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?branch='+encodeURIComponent(build.branch)+'&per_page=10',{headers:ghHeaders});
    let status='building';let downloadUrl=null;let conclusion=null;
    if(runsResp.ok){
      const runsData=await runsResp.json();
      // Find the best run: prefer completed, then in-progress, then queued
      const runs=runsData.workflow_runs||[];
      const completed=runs.filter(r=>r.conclusion);
      const successful=completed.filter(r=>r.conclusion==='success');
      const inProgress=runs.filter(r=>r.status==='in_progress'||r.status==='queued');
      // Prefer a successful run, then in-progress, then any completed
      const bestRun=successful[0]||inProgress[0]||completed[0]||runs[0]||null;
      if(bestRun){
        conclusion=bestRun.conclusion||bestRun.status;status=bestRun.status;
        // Check ALL successful runs for artifacts (not just bestRun)
        for(const r of successful){
          if(downloadUrl)break;
          try{
            const artResp=await fetch(r.artifacts_url,{headers:ghHeaders});
            if(artResp.ok){
              const artData=await artResp.json();
              const apk=artData.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('apk')||a.name.toLowerCase().includes('android')));
              if(apk&&!apk.expired)downloadUrl='/api/download-artifact/'+apk.id+'?name='+encodeURIComponent('mauli-android.apk');
            }else{
              // Artifacts API may require actions scope - fall back to run page URL
              downloadUrl=r.html_url;
            }
          }catch(e){ downloadUrl=r.html_url; }
        }
        // If still no download URL, use the best run's HTML page
        if(!downloadUrl&&bestRun.html_url)downloadUrl=bestRun.html_url;
      }
    }
    // Update build status
    store.put('builds',{...build,status:conclusion||status,downloadUrl,checkedAt:now(),id:buildId});
    return ok({buildId,status:conclusion||status,downloadUrl,pushedAt:build.pushedAt,platform:build.platform,filesPushed:build.filesPushed});
  }
  // ── PROJECT BUILDS: List all builds for a project with download URLs ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/project-builds/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.pathname.split('/').pop();
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=env?.GITHUB_RESULT_REPO||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return ok({builds:[]});
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder'};
    // Find builds for this project from our store
    const localBuilds=store.list('builds').filter(b=>b.projectId===projectId);
    // Also check GitHub for build/* branches that may match
    const buildsResp=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?per_page=20',{headers:ghHeaders});
    const ghBuilds=[];
    if(buildsResp.ok){
      const rd=await buildsResp.json();
      const runs=rd.workflow_runs||[];
      // Check each successful build run for artifacts
      for(const r of runs.filter(run=>run.conclusion==='success')){
        let downloadAPK=null,downloadEXE=null,viewUrl=r.html_url||null;
        try{
          const artResp=await fetch(r.artifacts_url,{headers:ghHeaders});
          if(artResp.ok){
            const ad=await artResp.json();
            const apk=ad.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('apk')||a.name.toLowerCase().includes('android')));
            const exe=ad.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('exe')||a.name.toLowerCase().includes('desktop')||a.name.toLowerCase().includes('appimage')));
            if(apk&&!apk.expired)downloadAPK='/api/download-artifact/'+apk.id+'?name='+encodeURIComponent('mauli-android.apk');
            if(exe&&!exe.expired)downloadEXE='/api/download-artifact/'+exe.id+'?name='+encodeURIComponent('mauli-desktop.AppImage');
          }
        }catch(e){}
        // If artifacts API failed (403), use run page as view URL
        if(!downloadAPK&&!downloadEXE){viewUrl=r.html_url||null;downloadAPK=viewUrl;downloadEXE=viewUrl;}
        if(downloadAPK||downloadEXE||viewUrl){
          ghBuilds.push({id:r.id.toString(),branch:r.head_branch||'',status:r.conclusion,conclusion:r.conclusion,completedAt:r.updated_at,downloadUrlAPK:downloadAPK,downloadUrlEXE:downloadEXE,viewUrl:viewUrl});
        }
      }
    }
    // Merge local + GitHub builds, dedup by best available
    const allBuilds=[...localBuilds.map(b=>({...b,type:b.platform||'android'})),...ghBuilds];
    // Return the best build with download URL
    const withAPK=allBuilds.find(b=>b.downloadUrl||b.downloadUrlAPK||b.viewUrl);
    const bestAPK=withAPK?(withAPK.downloadUrl||withAPK.downloadUrlAPK||withAPK.viewUrl||null):null;
    const bestEXE=allBuilds.find(b=>b.downloadUrlEXE)?.downloadUrlEXE||null;
    return ok({builds:allBuilds.slice(0,5),bestAPK,bestEXE});
  }
  // ── DOWNLOAD ARTIFACT: Proxy GitHub artifact download ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/download-artifact/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const parts=url.pathname.split('/');const artifactId=parts[parts.length-1];
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=env?.GITHUB_RESULT_REPO||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return fail('GitHub token not configured',500);
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-downloader'};
    // Fetch the artifact zip from GitHub
    const artResp=await fetch('https://api.github.com/repos/'+repo+'/actions/artifacts/'+artifactId+'/zip',{headers:ghHeaders,redirect:'follow'});
    if(!artResp.ok)return fail('Artifact not available ('+artResp.status+')',artResp.status);
    const fileName=url.searchParams.get('name')||'mauli-build.zip';
    return new Response(artResp.body,{status:200,headers:{'content-type':'application/zip','content-disposition':'attachment; filename="'+fileName+'"','cache-control':'no-store'}});
  }
  if(request.method==='GET'&&url.pathname==='/api/app-files'){
    const projectId=url.searchParams.get('projectId');
    if(!projectId)return fail('projectId required',400);
    const artifacts=store.list('artifacts').filter(a=>a.projectId===projectId&&a.type==='code-workspace');
    if(artifacts.length===0)return fail('No code artifacts',404);
    const files=[];
    for(const artifact of artifacts){
      const ac=artifact.content||{};
      if(Array.isArray(ac.files)){
        for(const f of ac.files){files.push({path:f.path,content:f.content})}
      }
    }
    if(files.length===0)return fail('No files found',404);
    return ok({files,projectId,count:files.length});
  }
  if(request.method==='GET'&&url.pathname==='/api/preview-app'){
    const projectId=url.searchParams.get('projectId');
    if(!projectId)return fail('projectId required',400);
    const artifacts=store.list('artifacts').filter(a=>a.projectId===projectId&&a.type==='code-workspace');
    if(artifacts.length===0)return fail('No code artifacts',404);
    for(const artifact of artifacts){
      const ac=artifact.content||{};
      if(Array.isArray(ac.files)){
        for(const f of ac.files){if(f.path.endsWith('.html'))return new Response(f.content,{headers:{'content-type':'text/html;charset=utf-8'}})}
      }
    }
    return fail('No HTML files',404);
  }
  
    return fail('Route not found',404);
} catch(error){return fail(error.message||'Internal error',500);} } };