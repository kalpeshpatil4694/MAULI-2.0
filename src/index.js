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
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')&&url.pathname.endsWith('/download')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const artifactId=parts[parts.length-2];const artifact=getArtifact(artifactId);if(!artifact)return fail('Artifact not found',404);let files=collectProjectFiles(artifact.projectId,artifact,store);if(!files.length){const tasks=store.list('tasks').filter(t=>t.projectId===artifact.projectId);const summary=[];summary.push({path:'README.md',content:`# MAULI 2.0 — Project Delivery\n\n## Project\n- **ID:** ${artifact.projectId}\n- **Type:** ${artifact.type}\n- **Delivered:** ${new Date().toISOString()}\n\n## Tasks (${tasks.length})\n${tasks.map(t=>`- [${t.state}] ${t.title}${t.assignedAgentId?' (Agent: '+t.assignedAgentId+')':''}`).join('\n')}\n`});summary.push({path:'project-data.json',content:JSON.stringify({projectId:artifact.projectId,type:artifact.type,content:artifact.content,metadata:artifact.metadata},null,2)});files=summary;}const zip=createZip(files);const safeName=String(artifact.projectId).replace(/[^a-zA-Z0-9_-]/g,'_');return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="mauli-${safeName}.zip"`,'cache-control':'no-store'}});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return artifactJson(getArtifact(url.pathname.split('/').pop()));}
  if(request.method==='POST'&&url.pathname==='/api/command'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const body=await json(request);if(!body.command)return fail('Founder command is required',400);const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const isolatedTest=isIsolatedTestEnv(env);const result=await planCommand(body.command,env);const persistedPayload={command:body.command,generatedAt:now(),result};const saved=isolatedTest ? {saved:true,skipped:true,testMode:true,reason:'Result persistence disabled for isolated test'} : await saveCommandResult(persistedPayload,env);if(!saved.saved)return fail('Command executed but Result file persistence failed',502,{resultFile:saved,result});return ok({result,resultFile:saved},201);}
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
    const buildBranch='build/'+buildId;
    if(!token)return fail('GitHub token not configured. Add GITHUB_TOKEN env var.',500);
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder','Content-Type':'application/json'};
    const buildFolder='';
    // Push each file to GitHub
    let pushed=0;
    for(const file of files){
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
      if(putResp.ok)pushed++;
    }
    // Also push the build-apps.yml workflow to the build folder
    const wfContent=['name: Build App','on: push','jobs:','  build:','    runs-on: ubuntu-latest','    steps:','      - uses: actions/checkout@v4','      - uses: actions/setup-java@v4','        with:','          distribution: temurin','          java-version: 17','      - uses: actions/setup-node@v4','        with:','          node-version: 20','      - run: npm install','      - run: npm install @capacitor/core @capacitor/cli @capacitor/android','      - run: npx cap sync || true','      - run: cd android && ./gradlew assembleDebug || true','      - uses: actions/upload-artifact@v4','        with:','          name: android-apk','          path: android/app/build/outputs/apk/debug/*.apk'].join('\n');
    const wfBase64=typeof btoa==='function'?btoa(unescape(encodeURIComponent(wfContent))):Buffer.from(wfContent).toString('base64');
    const wfCheck=await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent('.github/workflows/build-app.yml')+'?ref='+buildBranch,{headers:ghHeaders});
    let wfSha=null;if(wfCheck.ok){const d=await wfCheck.json();wfSha=d.sha;}
    const wfBody={message:'MAULI build: '+buildId+' workflow',content:wfBase64,branch:buildBranch};
    if(wfSha)wfBody.sha=wfSha;
    await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent(buildFolder+'/.github/workflows/build.yml'),{method:'PUT',headers:ghHeaders,body:JSON.stringify(wfBody)});
    // Store build info
    store.put('builds',{id:buildId,projectId,platform,buildFolder,repo,branch:buildBranch,pushedAt:now(),status:'pushed',filesPushed:pushed});
    store.addEvent('build.started',{buildId,projectId,platform,pushed});
    return ok({buildId,platform,pushed,repo,branch:buildBranch,status:'pushed',message:pushed+' files pushed to GitHub. Build will start shortly.'});
  }
  // ── BUILD STATUS: Poll GitHub Actions status ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/build-status/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const buildId=url.pathname.split('/').pop();
    const build=store.list('builds').find(b=>b.id===buildId);
    if(!build)return fail('Build not found',404);
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=build.repo||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return ok({...build,status:'pushed',message:'GitHub token not configured'});
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder'};
    // Check latest workflow run for this branch/path
    const runsResp=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?branch='+build.branch+'&per_page=5',{headers:ghHeaders});
    let status='building';let downloadUrl=null;let conclusion=null;
    if(runsResp.ok){
      const runsData=await runsResp.json();
      const run=runsData.workflow_runs?.find(r=>r.head_sha?.includes(build.branch)||r.run_attempt===1);
      if(run){
        conclusion=run.conclusion;status=run.status;
        if(conclusion==='success'){
          // Get artifacts
          const artResp=await fetch(run.artifacts_url,{headers:ghHeaders});
          if(artResp.ok){
            const artData=await artResp.json();
            const apk=artData.artifacts?.find(a=>a.name==='android-apk'||a.name?.includes('apk'));
            if(apk)downloadUrl=apk.archive_download_url;
          }
        }
      }
    }
    // Update build status
    store.put('builds',{...build,status:conclusion||status,downloadUrl,checkedAt:now(),id:buildId});
    return ok({buildId,status:conclusion||status,downloadUrl,pushedAt:build.pushedAt,platform:build.platform,filesPushed:build.filesPushed});
  }
  return fail('Route not found',404);
} catch(error){return fail(error.message||'Internal error',500);} } };