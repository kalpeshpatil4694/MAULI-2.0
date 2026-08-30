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
  if(request.method==='GET'&&url.pathname==='/api/heartbeat') return ok({alive:true,uptime:Date.now(),heartbeat:now(),builds:store.list('builds').length,projects:store.list('projects').length,agents:store.list('agents').length});
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
    // Create the build branch from main first
    const mainRef=await fetch('https://api.github.com/repos/'+repo+'/git/refs/heads/main',{headers:ghHeaders});
    const mainData=await mainRef.json();
    const mainSha=mainData?.object?.sha;
    if(mainSha){
      await fetch('https://api.github.com/repos/'+repo+'/git/refs',{method:'POST',headers:ghHeaders,body:JSON.stringify({ref:'refs/heads/'+buildBranch,sha:mainSha})});
    }
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
      if(putResp.ok){pushed++;}else{const errText=await putResp.text().catch(()=>"");store.addEvent('build.push_error',{path:file.path,status:putResp.status,error:errText.substring(0,200)});}
    }
    // Push the build-app.yml workflow to the build branch
    const wfLines=[];
    wfLines.push('name: Build App');
    wfLines.push('on: push');
    wfLines.push('jobs:');
    wfLines.push('  build-android:');
    wfLines.push('    name: Build Android APK');
    wfLines.push('    runs-on: ubuntu-latest');
    wfLines.push('    steps:');
    wfLines.push('      - uses: actions/checkout@v4');
    wfLines.push('      - uses: actions/setup-java@v4');
    wfLines.push('        with:');
    wfLines.push('          distribution: temurin');
    wfLines.push('          java-version: 17');
    wfLines.push('      - uses: actions/setup-node@v4');
    wfLines.push('        with:');
    wfLines.push('          node-version: 20');
    wfLines.push('      - name: Setup Capacitor');
    wfLines.push('        run: |');
    wfLines.push('          mkdir -p www electron');
    wfLines.push('          if [ ! -f www/index.html ]; then echo "<!DOCTYPE html><html><head><title>App</title></head><body><h1>MAULI App</h1></body></html>" > www/index.html; fi');
    wfLines.push('          echo "{\\"name\\":\\"mauli-app\\",\\"version\\":\\"1.0.0\\"}" > package.json');
    wfLines.push('          npm install || true');
    wfLines.push('          npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6 || true');
    wfLines.push('          npx cap init mauli-app com.mauli.app --web-dir www || true');
    wfLines.push('          npx cap add android || true');
    wfLines.push('      - name: Build APK');
    wfLines.push('        run: |');
    wfLines.push('          npx cap sync android || true');
    wfLines.push('          cd android && chmod +x gradlew && ./gradlew assembleDebug --no-daemon || true');
    wfLines.push('      - uses: actions/upload-artifact@v4');
    wfLines.push('        if: always()');
    wfLines.push('        with:');
    wfLines.push('          name: android-apk');
    wfLines.push('          path: android/app/build/outputs/apk/debug/*.apk');
    wfLines.push('          if-no-files-found: warn');
    wfLines.push('          retention-days: 14');
    wfLines.push('  build-desktop:');
    wfLines.push('    name: Build Desktop App');
    wfLines.push('    runs-on: ubuntu-latest');
    wfLines.push('    steps:');
    wfLines.push('      - uses: actions/checkout@v4');
    wfLines.push('      - uses: actions/setup-node@v4');
    wfLines.push('        with:');
    wfLines.push('          node-version: 20');
    wfLines.push('      - name: Setup Electron');
    wfLines.push('        run: |');
    wfLines.push('          mkdir -p electron www');
    wfLines.push('          echo "{\\"name\\":\\"mauli-desktop\\",\\"version\\":\\"1.0.0\\",\\"main\\":\\"electron/main.js\\"}" > package.json');
    wfLines.push('          echo "const{app,BrowserWindow}=require(\\"electron\\");const path=require(\\"path\\");function createWindow(){const win=new BrowserWindow({width:800,height:600});win.loadFile(path.join(__dirname,\\"../www/index.html\\"));}app.whenReady().then(createWindow);app.on(\\"window-all-closed\\",()=>{if(process.platform!==\\"darwin\\")app.quit()});" > electron/main.js');
    wfLines.push('          npm install electron@28 electron-builder@24 || true');
    wfLines.push('      - name: Build Desktop');
    wfLines.push('        run: npx electron-builder --linux AppImage --publish never || true');
    wfLines.push('      - uses: actions/upload-artifact@v4');
    wfLines.push('        if: always()');
    wfLines.push('        with:');
    wfLines.push('          name: desktop-exe');
    wfLines.push('          path: dist/*.AppImage');
    wfLines.push('          if-no-files-found: warn');
    wfLines.push('          retention-days: 14');
    const wfContent=wfLines.join('\n');
    const wfBase64=typeof btoa==='function'?btoa(unescape(encodeURIComponent(wfContent))):Buffer.from(wfContent).toString('base64');
    const wfCheck=await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent('.github/workflows/build-apps.yml')+'?ref='+buildBranch,{headers:ghHeaders});
    let wfSha=null;if(wfCheck.ok){const d=await wfCheck.json();wfSha=d.sha;}
    const wfBody={message:'MAULI build: '+buildId+' workflow',content:wfBase64,branch:buildBranch};
    if(wfSha)wfBody.sha=wfSha;
    await fetch('https://api.github.com/repos/'+repo+'/contents/'+encodeURIComponent('.github/workflows/build-apps.yml'),{method:'PUT',headers:ghHeaders,body:JSON.stringify(wfBody)});
    // Store build info
    store.put('builds',{id:buildId,projectId,platform,repo,branch:buildBranch,pushedAt:now(),status:pushed>0?'pushed':'failed',filesPushed:pushed});
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
          const artResp=await fetch(r.artifacts_url,{headers:ghHeaders});
          if(artResp.ok){
            const artData=await artResp.json();
            const apk=artData.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('apk')||a.name.toLowerCase().includes('android')));
            if(apk&&!apk.expired)downloadUrl=apk.archive_download_url;
          }
        }
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
        const artResp=await fetch(r.artifacts_url,{headers:ghHeaders});
        if(artResp.ok){
          const ad=await artResp.json();
          const apk=ad.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('apk')||a.name.toLowerCase().includes('android')));
          const exe=ad.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('exe')||a.name.toLowerCase().includes('desktop')||a.name.toLowerCase().includes('appimage')));
          if(apk||exe){
            ghBuilds.push({id:r.id.toString(),branch:r.head_branch||'',status:r.conclusion,conclusion:r.conclusion,completedAt:r.updated_at,downloadUrlAPK:apk&&!apk.expired?apk.archive_download_url:null,downloadUrlEXE:exe&&!exe.expired?exe.archive_download_url:null});
          }
        }
      }
    }
    // Merge local + GitHub builds, dedup by best available
    const allBuilds=[...localBuilds.map(b=>({...b,type:b.platform||'android'})),...ghBuilds];
    // Return the best build with download URL
    const withAPK=allBuilds.find(b=>b.downloadUrl||b.downloadUrlAPK);
    return ok({builds:allBuilds.slice(0,5),bestAPK:withAPK?(withAPK.downloadUrl||withAPK.downloadUrlAPK):null,bestEXE:allBuilds.find(b=>b.downloadUrlEXE)?.downloadUrlEXE||null});
  }
  return fail('Route not found',404);
} catch(error){return fail(error.message||'Internal error',500);} } };