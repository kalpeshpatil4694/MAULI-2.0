// MAULI 2.0 — live Founder Command lifecycle bridge.
// The dashboard is server-rendered, so this small client layer keeps the Command Center
// visibly synchronized with durable project/task state without duplicating the dashboard UI.
export const DASHBOARD_LIVE_SCRIPT = String.raw`<script>
(function(){
  const state={known:new Set(),activeProject:null,polling:false,retrySoon:false};
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  // The command stamp was printed raw ("2026-09-26T13:13:00.664Z") in a live card.
  // Format it locally so the card reads like a clock, not like an API payload.
  const stamp=v=>{if(!v)return '—';const d=new Date(v);if(!Number.isFinite(d.getTime()))return String(v);return d.toLocaleString();};
  const get=(id)=>document.getElementById(id);
  function message(html){const e=get('cmdRes');if(!e)return;e.style.display='block';e.innerHTML=html;}
  function badge(s){const v=String(s||'queued');return '<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(0,212,255,.1);color:var(--accent);font-size:10px;font-weight:600">'+esc(v)+'</span>';}
  // The watched project id survives a refresh, so the panel does not jump to a different
  // project (and a different stage/percentage) every time the page reloads.
  const ACTIVE_KEY='mauli_active_project';
  const rememberProject=pid=>{try{pid?sessionStorage.setItem(ACTIVE_KEY,pid):sessionStorage.removeItem(ACTIVE_KEY);}catch(_){}};
  const rememberedProject=()=>{try{return sessionStorage.getItem(ACTIVE_KEY)||null;}catch(_){return null;}};
  // Point 16: Production Runtime is a first-class status, not a footnote under "QA Passed".
  // The card always shows a verdict — PASS / FAILED / BLOCKED — with the exact reason, the
  // tested-at stamp and the per-stage statuses the founder asked for.
  function runtimeLine(pr){
    const rt=pr&&pr.productionRuntime;
    if(!rt)return '';
    const label=String(rt.label||'BLOCKED');
    const color=label==='PASS'?'var(--green)':label==='FAILED'?'var(--red)':'var(--yellow)';
    const bg=label==='PASS'?'rgba(0,200,120,.12)':label==='FAILED'?'rgba(255,80,80,.12)':'rgba(255,190,60,.12)';
    const j=v=>v===undefined||v===null?'—':esc(v);
    const meta=[
      'Deployment '+j(rt.deploymentStatus),
      rt.runtimeUrl?('URL '+esc(rt.runtimeUrl)):('tested '+(rt.testedAt?esc(stamp(rt.testedAt)):'not run yet')),
      'API '+j(rt.api), 'DB '+j(rt.database), 'Auth '+j(rt.authentication),
      'Journey '+j(rt.userJourney), 'Transport '+j(rt.transport),
      'critical '+(Number(rt.criticalPassed)||0)+' pass / '+(Number(rt.criticalFailed)||0)+' fail',
      'Final Delivery '+j(rt.finalDelivery)
    ].join(' · ');
    return '<div style="grid-column:1/-1;margin-top:6px;padding:7px 8px;border-radius:6px;background:'+bg+';color:'+color+';line-height:1.5">'+
      '<b>Production Runtime: '+esc(label)+'</b>'+
      '<div style="font-size:9.5px;opacity:.9;margin-top:2px">'+meta+'</div>'+
      (rt.deploymentError?'<div style="font-size:9.5px;margin-top:3px">Deployment '+esc(rt.deploymentError.category)+': '+esc(rt.deploymentError.message)+'</div>':'')+
      (rt.reason?'<div style="font-size:9.5px;margin-top:3px">'+esc(rt.reason)+'</div>':'')+
      '</div>';
  }
  function showProject(p,progress){
    if(!p)return;
    const pr=progress||{}; const timing=pr.timing||{};
    const pct=Number.isFinite(Number(pr.percentage))?Math.max(0,Math.min(100,Number(pr.percentage))):({completed:100,working:60,assigned:35,queued:20,awaiting_approval:10,failed:100}[p.state]??10);
    const stage=pr.stage||p.state||'queued';
    const next=pr.nextStage||'—';
    const ti=pr.tasks||{};
    const n=v=>Number.isFinite(Number(v))?Number(v):0;
    const cur=pr.currentTask;
    message('<div style="font-family:inherit;line-height:1.6">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>MAULI execution</b>'+badge(p.state)+'</div>'+
      '<div style="margin-top:7px;font-size:11px;color:var(--text2)">'+esc(p.name||p.objective||p.id)+'</div>'+
      '<div style="margin-top:9px;height:6px;background:var(--bg3);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .4s"></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px;font-size:10px">'+
      '<span>Stage: <b>'+esc(stage)+'</b></span><span>Progress: <b>'+pct+'%</b></span>'+
      '<span>Agent: <b>'+esc(pr.currentAgent?.name||pr.currentAgent?.id||'—')+'</b></span><span>Next: <b>'+esc(next)+'</b></span>'+ '<span>Command: <b>'+esc(stamp(pr.commandReceivedAt))+'</b></span><span>Elapsed: <b>'+esc(timing.elapsedFormatted||'0s')+'</b></span>'+ '<span>Estimated: <b>'+esc(timing.estimatedDurationFormatted||'—')+'</b></span><span>Remaining: <b>'+esc(timing.remainingFormatted||'—')+'</b></span>'+
      '<span>Tasks: <b>'+n(ti.completed)+'/'+(n(ti.total)||'—')+'</b></span><span>Running: <b>'+n(ti.running??ti.working)+'</b></span>'+
      '<span>Queued: <b>'+n(ti.queued)+'</b></span><span>Failed: <b>'+n(ti.failed)+'</b></span>'+
      runtimeLine(pr)+
      (cur?'<div style="grid-column:1/-1;margin-top:4px;color:var(--text2)">Current task: <b style="color:var(--text)">'+esc(cur.title)+'</b>'+(cur.agentName?' — '+esc(cur.agentName):'')+'</div>':'')+
      '</div>'+
      (p.state==='awaiting_approval'?'<div style="margin-top:8px;color:var(--yellow);font-weight:600">⏳ Founder approval प्रतीक्षेत — Approvals मध्ये "Approve" करा आणि मग हा command चालू होईल.</div>':'')+
      (p.state==='completed'?'<div style="margin-top:8px;color:var(--green);font-weight:600">✅ Final delivery completed</div>':'')+
      (p.state==='failed'?'<div style="margin-top:8px;color:var(--red);font-weight:600">❌ Execution failed — recovery required</div>':'')+
      '<button class="proj-detail-btn" style="margin-top:8px;background:var(--accent);color:#000;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600" onclick="window.__showProjDetail&&window.__showProjDetail(\''+esc(p.id)+'\')">📄 View Full Project Details</button>'+
      '</div>');
    window.__showProjDetail=showProjectDetail;
  }
  async function poll(){
    if(state.polling)return;state.polling=true;
    try{
      state.retrySoon=false;
      const r=await fetch('/api/state',{cache:'no-store',headers:(window.__mauliFounderHeaders?window.__mauliFounderHeaders({}):{})});if(!r.ok)return;
      const j=await r.json();const d=j.data||j;const projects=Array.isArray(d.projects)?d.projects:[];
      const candidates=projects.filter(p=>p&&p.founderCommand&&p.queuedAt);
      candidates.sort((a,b)=>Date.parse(b.queuedAt||b.createdAt||0)-Date.parse(a.queuedAt||a.createdAt||0));
      const latest=candidates[0];
      // Stay on the project the founder is already watching. Re-picking "latest" on every
      // poll is what made the whole panel change on refresh; switch only when a genuinely
      // newer command appears (or the watched project disappears).
      const watchedId=state.activeProject?state.activeProject.id:rememberedProject();
      const watched=watchedId?(projects.find(p=>p.id===watchedId)||null):null;
      const newerArrived=latest&&watched&&latest.id!==watched.id&&Date.parse(latest.queuedAt||latest.createdAt||0)>Date.parse(watched.queuedAt||watched.createdAt||0);
      if(latest&&(!watched||newerArrived)){
        state.activeProject=latest;rememberProject(latest.id);showProject(latest,null);
      } else if(watched){
        state.activeProject=watched;
      }
      if(state.activeProject){
        const fresh=projects.find(p=>p.id===state.activeProject.id)||state.activeProject;
        state.activeProject=fresh;
        let progress=null;
        try{const q=await fetch('/api/project-progress/'+encodeURIComponent(fresh.id),{cache:'no-store',headers:(window.__mauliFounderHeaders?window.__mauliFounderHeaders({}):{})});if(q.ok){const x=await q.json();progress=(x.data||x).progress||null;}}catch(_){ }
        showProject(fresh,progress);
      }
      // Keep the visible counters synchronized even if the legacy dashboard render is unchanged.
      const set=(id,v)=>{const e=get(id);if(e)e.textContent=String(v);};
      // True store-wide totals now come from the same cached D1 COUNT on every isolate, so
      // they are valid even when the row LISTS are degraded — writing them keeps the numbers
      // moving instead of freezing them, which is the "task digit doesn't change" report.
      const totals=(d.summary&&typeof d.summary==='object'&&d.summary.totals)||{};
      const hasTotals=Number.isFinite(Number(totals.tasks))||Number.isFinite(Number(totals.projects));
      if(!d.degraded||hasTotals){
        set('sProj',Number.isFinite(Number(totals.projects))?Number(totals.projects):projects.length);set('navP',projects.length);
        if(Array.isArray(d.tasks)){set('sTask',Number.isFinite(Number(totals.tasks))?Number(totals.tasks):d.tasks.length);set('navT',d.tasks.filter(t=>t.state==='working').length||d.tasks.length);}
        if(Array.isArray(d.agents)){set('sAg',d.agents.length);set('navA',d.agents.length);}
        if(Array.isArray(d.artifacts))set('sArt',Number.isFinite(Number(totals.artifacts))?Number(totals.artifacts):d.artifacts.length);
      }
      // A degraded payload means the lists themselves are incomplete; keep the rows already
      // rendered rather than blanking the screen, and retry sooner.
      if(d.degraded){state.retrySoon=true;return;}
      // Refresh every data-backed panel from this response without a second poll.
      document.dispatchEvent(new CustomEvent('mauli:state',{detail:d}));
    }catch(_){ }
    finally{state.polling=false;}
  }
  // Project detail view
  async function showProjectDetail(pid){
    if(!pid)return;
    try{
      const r=await fetch('/api/projects/'+encodeURIComponent(pid)+'/detail',{headers:(window.__mauliFounderHeaders?window.__mauliFounderHeaders({}):{})});
      const d=await r.json();
      if(!r.ok||!d.ok){let err=d.error||d.message||'API error';if(typeof err!=='string')err=JSON.stringify(err);alert('Error: '+err);return;}
      const det=d.detail||d.data?.detail;
      if(!det)return alert('Project not found');
      const p=det.project;const s=det.summary;
      let txt='PROJECT DETAILS — '+(p.name||p.objective||p.id)+'\n\n';
      txt+='ID: '+p.id+'\n';
      txt+='Name: '+(p.name||'N/A')+'\n';
      txt+='Objective: '+(p.objective||'N/A')+'\n';
      txt+='State: '+p.state+'\n';
      txt+='Created: '+(p.createdAt||'N/A')+'\n';
      if(p.completedAt)txt+='Completed: '+p.completedAt+'\n';
      if(p.failedAt)txt+='Failed: '+p.failedAt+'\n';
      txt+='Duration: '+(s.totalTimeFormatted||'In progress')+'\n\n';
      // The runtime verdict sits ABOVE the progress numbers: a founder reading this screen
      // must see whether the product was actually run before they read that QA passed.
      const rt=det.productionRuntime;
      txt+='PRODUCTION RUNTIME: '+(rt?rt.label:'BLOCKED')+'\n';
      if(rt){
        txt+='  Tested at: '+(rt.testedAt||'not run yet')+'\n';
        txt+='  Environment: '+(rt.environment||'—')+'\n';
        txt+='  Deployment: '+(rt.deploymentStatus||'NOT_DEPLOYED')+'\n';
        txt+='  Runtime URL: '+(rt.runtimeUrl||'—')+'\n';
        txt+='  Transport: '+(rt.transport||'—')+'\n';
        if(rt.deploymentError)txt+='  Deployment error: '+rt.deploymentError.category+' — '+rt.deploymentError.message+'\n';
        txt+='  API: '+(rt.api||'—')+' | Database: '+(rt.database||'—')+'\n';
        txt+='  Authentication: '+(rt.authentication||'—')+' | User journey: '+(rt.userJourney||'—')+'\n';
        txt+='  Critical requirements passed: '+(Number(rt.criticalPassed)||0)+' | failed: '+(Number(rt.criticalFailed)||0)+'\n';
        txt+='  FINAL DELIVERY: '+(rt.finalDelivery||'BLOCKED')+'\n';
        if(rt.missingTests&&rt.missingTests.length)txt+='  Missing runtime tests: '+rt.missingTests.join(', ')+'\n';
        if(rt.failedTests&&rt.failedTests.length)txt+='  Failed runtime tests: '+rt.failedTests.join(', ')+'\n';
        if(rt.blockingReason)txt+='  Blocking reason: '+rt.blockingReason+'\n';
        else if(rt.reason)txt+='  '+rt.reason+'\n';
      }
      if(p.blockedReason)txt+='DELIVERY STATUS: BLOCKED — '+p.blockedReason+'\n';
      txt+='\n';
      txt+='PROGRESS: '+s.completedTasks+'/'+s.totalTasks+' tasks ('+s.progressPct+'%)\n';
      txt+='Completed: '+s.completedTasks+' | Running: '+s.runningTasks+' | Failed: '+s.failedTasks+' | Pending: '+s.pendingTasks+'\n\n';
      if(s.errors&&s.errors.length>0){txt+='ERRORS:\n';for(const e of s.errors)txt+='  - '+e.task+': '+e.error+'\n';txt+='\n';}
      if(s.fixes&&s.fixes.length>0){txt+='RETRIES:\n';for(const f of s.fixes)txt+='  - '+f.task+': '+f.attempts+' attempts\n';txt+='\n';}
      txt+='TASKS:\n';
      for(const t of det.tasks){const icon=t.state==='completed'?'[OK]':t.state==='working'?'[..]':t.state==='assigned'?'[>>]':t.state==='failed'?'[!!]':'[--]';txt+='  '+icon+' '+esc(t.title||t.id)+' ['+t.state+']';if(t.agentName)txt+=' — agent: '+t.agentName;if(t.estimatedDurationFormatted)txt+=' | est: '+t.estimatedDurationFormatted;if(t.actualDurationFormatted)txt+=' | actual: '+t.actualDurationFormatted;if(t.remainingFormatted&&t.state!=='completed')txt+=' | remaining: '+t.remainingFormatted;if(t.startedAt)txt+=' | started: '+t.startedAt;if(t.completedAt)txt+=' | completed: '+t.completedAt;if(t.error)txt+=' ERROR: '+t.error;txt+='\n';}
      // Show as modal overlay
      const overlay=document.createElement('div');overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
      const modal=document.createElement('div');modal.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:12px;max-width:700px;width:100%;max-height:80vh;overflow:auto;padding:20px;font-family:monospace;font-size:12px;color:var(--text);white-space:pre-wrap';
      modal.textContent=txt;
      const closeBtn=document.createElement('button');closeBtn.textContent='Close';closeBtn.style.cssText='position:sticky;top:0;float:right;background:var(--accent);color:#000;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-weight:600';
      closeBtn.onclick=()=>overlay.remove();
      // The details view was the only place a user landed after a project finished,
      // and it had no way to get the files out. det.artifacts is this project's real
      // artifact list — unlike /api/state, which only ships the newest 100 of 429,
      // so it correctly decides whether /api/app-files will have anything.
      const dlBtn=document.createElement('button');
      const hasFiles=Array.isArray(det.artifacts)&&det.artifacts.some(a=>a&&a.type==='code-workspace');
      dlBtn.textContent=hasFiles?'📥 Download deliverable':'No code files';
      dlBtn.style.cssText='position:sticky;top:0;float:right;background:var(--accent2);color:#fff;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-weight:600;margin-right:8px'+(hasFiles?'':';opacity:.6;cursor:default');
      dlBtn.onclick=()=>{if(!hasFiles)return;const dl=window.__mauliDownloadProject||window.downloadZip;if(dl)dl(p.id);else alert('Download is unavailable in this dashboard build.');};
      overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove()};
      modal.prepend(dlBtn);modal.prepend(closeBtn);
      overlay.appendChild(modal);document.body.appendChild(overlay);
    }catch(e){alert('Error loading project: '+e.message)}
  }
  // Add view details button to live progress
  function addDetailButton(pid){
    const e=get('cmdRes');if(!e)return;
    let btn=e.querySelector('.proj-detail-btn');
    if(!btn){btn=document.createElement('button');btn.className='proj-detail-btn';btn.style.cssText='margin-top:8px;background:var(--accent);color:#000;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600';btn.textContent='📄 View Full Project Details';e.appendChild(btn);}
    btn.onclick=()=>showProjectDetail(pid);
  }
  document.addEventListener('mauli:state',e=>{const d=e.detail||{};if(typeof window.__applyDashboardState==='function')window.__applyDashboardState(d);else{S.projects=Array.isArray(d.projects)?d.projects:[];S.tasks=Array.isArray(d.tasks)?d.tasks:[];S.agents=Array.isArray(d.agents)?d.agents:[];S.artifacts=Array.isArray(d.artifacts)?d.artifacts:[];S.events=Array.isArray(d.events)?d.events:[];S.approvals=Array.isArray(d.approvals)?d.approvals.filter(a=>a.state==='pending'):[];S.tools=Array.isArray(d.tools)?d.tools:[];}updateStats();renderPage(curPage)});
  // Keep active-project timing live at 5s, but reduce idle traffic to 20s.
  // /api/state and /api/project-progress are read-only; polling does not add D1 rows_written.
  // NOTE: this scheduler must stay on real newlines. It used to be written with literal
  // "\n" sequences inside the String.raw template, which collapsed this whole block and
  // the closing "})();" into one physical line beginning with "//". It then parsed as a
  // comment, poll() never ran, and every dashboard counter stayed at its rendered 0.
  let pollTimer=null;
  function schedulePoll(delay){
    if(pollTimer)clearTimeout(pollTimer);
    pollTimer=setTimeout(async()=>{
      await poll();
      const active=Boolean(state.activeProject&&state.activeProject.state==='active');
      schedulePoll(state.retrySoon?2000:(active?5000:20000));
    },delay);
  }
  // ── Download fixes (2026-09-28) ──────────────────────────────────────────
  // loadDl() only rendered a Download button when the project's code-workspace
  // artifact happened to be in /api/state, which returns just the newest 100 of
  // 429 artifacts — so finished projects showed "No code" and produced no way to
  // download. downloadZip() then collapsed every failure into a bare "No files",
  // which hid both "401 founder key missing" and "404 this project has no code".
  // Both are function declarations, so renderPage() and the delegated click
  // handler resolve them at call time and these replacements take effect.
  async function fetchProjectFiles(pid,retried){
    const r=await fetch('/api/app-files?projectId='+encodeURIComponent(pid),{headers:window.__mauliFounderHeaders?window.__mauliFounderHeaders({}):{}});
    if(r.status===401||r.status===503){
      if(!retried&&window.__mauliRequestFounderKey&&window.__mauliRequestFounderKey())return fetchProjectFiles(pid,true);
      throw new Error('Founder key needed — paste it to download');
    }
    if(!r.ok){
      let body={};try{body=await r.json();}catch(_){ }
      const m=String(body.error||body.message||'');
      if(/No code artifacts/i.test(m))throw new Error('This project has no code files to download');
      if(/No files found/i.test(m))throw new Error('This project has no downloadable files');
      throw new Error(m||('Download failed ('+r.status+')'));
    }
    const d=await r.json();
    return Array.isArray(d.files)?d.files:[];
  }
  // Every protected download has to be fetched with the founder key header, then
  // saved from a blob. window.open(url) sends no header, so the APK/EXE download
  // returned 401 in a new tab and looked like a dead button.
  async function fetchAsBlob(url,retried){
    const r=await fetch(url,{headers:window.__mauliFounderHeaders?window.__mauliFounderHeaders({}):{}});
    if(r.status===401||r.status===503){
      if(!retried&&window.__mauliRequestFounderKey&&window.__mauliRequestFounderKey())return fetchAsBlob(url,true);
      throw new Error('Founder key needed — paste it to download');
    }
    if(!r.ok){
      let body={};try{body=await r.json();}catch(_){ }
      const m=String((body.error&&body.error.message)||body.message||'');
      if(/No code artifacts/i.test(m))throw new Error('This project has no code files to download');
      if(/No files found/i.test(m))throw new Error('This project has no downloadable files');
      if(/Artifact not available/i.test(m))throw new Error('APK GitHub वरून मिळाला नाही — तो 14 दिवसांनी expire होतो. पुन्हा Build दाबा.');
      throw new Error(m||('Download failed ('+r.status+')'));
    }
    const cd=r.headers.get('content-disposition')||'';
    const named=/filename="?([^";]+)"?/.exec(cd);
    return {blob:await r.blob(),name:named?named[1]:null};
  }
  function saveBlob(blob,name){
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=String(name||'mauli-download');a.rel='noopener';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  window.loadDl=function(){
    let h='';
    for(const p of S.projects){
      // State class is inlined because this layer's own badge() helper returns a
      // full <span> (the dashboard's badge() only returns the g/b/a/r/y suffix) and
      // is shadowed inside this closure — using it here produced a nested span.
      const cls=p.state==='completed'?'g':p.state==='active'?'b':p.state==='planning'?'a':p.state==='escalated'?'r':'y';
      h+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;align-items:center;justify-content:space-between"><div style="flex:1"><b style="font-size:13px">'+esc(p.name||p.objective||p.id)+'</b><div style="font-size:10px;color:var(--text2);margin-top:2px"><span class="badge badge-'+cls+'">'+esc(p.state)+'</span>'+(p.taskCount?' '+p.taskCount+' tasks':'')+'</div></div><button class="btn btn-g btn-s dl-btn" data-pid="'+esc(p.id)+'">📥 Download</button></div>';
    }
    const list=$('dlList');
    if(list)list.innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>';
  };
  // One zip per project. The old version called saveProjectFiles() once per entry
  // from /api/app-files — 20+ <a download> clicks in a row — and Chrome allows only
  // the first automatic download, so the founder saw nothing arrive. /api/app-files
  // also listed the same file once per code artifact.
  window.downloadZip=async function(pid){
    toast('Loading...','info');
    try{
      const {blob,name}=await fetchAsBlob('/api/project-download?projectId='+encodeURIComponent(pid),false);
      if(!blob||!blob.size){toast('This project has no downloadable files','err');return;}
      saveBlob(blob,name||('mauli-'+pid+'.zip'));
      toast('✅ Download पूर्ण — Files / Downloads मध्ये बघा','ok');
    }catch(e){toast((e&&e.message)||'Download failed','err');}
  };
  window.__mauliDownloadProject=window.downloadZip;
  // The Builds page had the same capped-artifact gate as the Downloads page: it printed
  // "No code" for projects whose code-workspace artifact was outside /api/state's newest
  // 100, so the APK/EXE buttons disappeared for most finished projects. Prefer the
  // server's hasCode flag, which is derived from every artifact it holds.
  window.loadBuilds=function(){
    let h='';
    for(const p of S.projects){
      const hasCode=('hasCode' in p)?!!p.hasCode:S.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
      // canBuild=false means the project shipped code but has no www/index.html, so
      // an APK is impossible. Say so on the row instead of handing over a button that
      // can only come back with an error.
      const canBuild=('canBuild' in p)?!!p.canBuild:hasCode;
      h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:12px">'+esc(p.name||p.objective||p.id)+'</b><div style="font-size:10px;color:var(--text2)">'+esc(p.state)+'</div></div><div style="display:flex;gap:4px">';
      if(hasCode&&canBuild)h+='<button class="btn btn-g btn-s bld-btn" data-pid="'+p.id+'" data-plat="android">📱 APK</button><button class="btn btn-a btn-s bld-btn" data-pid="'+p.id+'" data-plat="desktop">🖥️ EXE</button>';
      else if(hasCode)h+='<span class="badge badge-y" title="या project मध्ये www/index.html नाही, त्यामुळे APK बनत नाही" style="cursor:help">⚠️ APK नाही — web app नाही</span>';
      else h+='<span class="badge badge-y">No code</span>';
      h+='</div></div>';
    }
    const el=$('buildOut');
    if(el)el.innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>';
  };
  // Tapping 📱 used to dump the raw API envelope into the toast:
  //   {"ok":false,"error":{"message":"...","details":{"files":["server.js",...]}}}
  // which covered the page and told the founder nothing they could act on. The API
  // answer is right — a project with no www/index.html genuinely cannot become an
  // APK — so the fix is to say it in a sentence and name the fix, not to hide it.
  function buildErrorText(err){
    const raw=String((err&&err.message)||err||'').trim();
    let body=null;
    try{body=JSON.parse(raw);}catch(_){}
    const inner=body&&body.error?body.error:null;
    const message=(inner&&inner.message)||(body&&body.message)||raw;
    const files=inner&&inner.details&&Array.isArray(inner.details.files)?inner.details.files:null;
    if(/www\/index\.html/i.test(message)){
      return 'या project मध्ये www/index.html नाही, आणि त्याशिवाय APK बनत नाही.'+
        (files&&files.length?(' या project मध्ये फक्त आहेत: '+files.join(', ')+'. '):' ')+
        'नवीन command द्या किंवा "Build an Android app for <idea>" असा command द्या.';
    }
    if(/no package\.json/i.test(message)){
      return 'या project मध्ये package.json नाही, त्यामुळे Android build configure होत नाही. नवीन command द्या.';
    }
    if(/No code artifact/i.test(message)){
      return 'या project ने अजून code generate केलेला नाही. आधी command पूर्ण होऊ द्या, मग 📱 APK दाबा.';
    }
    if(/Founder key/i.test(message))return 'Founder key लागत आहे. डॅशबोर्डवर key भरा आणि पुन्हा प्रयत्न करा.';
    if(/does not have push permissions|GitHub token/i.test(message)){
      return 'GitHub token ला push permission नाही. GITHUB_TOKEN तपासा (Settings → Environment).';
    }
    return message.length>220?message.slice(0,220)+'…':(message||'Build सुरू करता आला नाही.');
  }
  window.startBuild=async function(pid,plat,btn){
    const label=plat==='android'?'📱 APK':'🖥️ EXE';
    if(btn){btn.disabled=true;btn.textContent='Starting…';}
    try{
      const r=await api('/api/build-app',{method:'POST',body:JSON.stringify({projectId:pid,platform:plat})});
      const buildId=r&&r.buildId;
      if(btn)btn.textContent='Building…';
      toast(plat==='android'?'📱 APK build सुरू — सुमारे 2 मिनिटं':'🖥️ Desktop build सुरू', 'ok');
      if(!buildId)return;
      let att=0;
      // The build record is written on the last line of /api/build-app, and its D1 write
      // used to be lost when the response returned first. /api/build-status then answered
      // "Build not found" for a build that was already running on GitHub, and the poll
      // retried that dead id for ten minutes before giving up with no download at all.
      // A missing row never reappears, so switch to the project's GitHub runs instead.
      let viaProjectBuilds=false;
      const attachDownload=url=>{
        if(!btn)return;
        btn.textContent='⬇ Download';btn.disabled=false;
        btn.onclick=async()=>{
          btn.disabled=true;btn.textContent='Downloading…';
          try{
            const {blob,name}=await fetchAsBlob(url,false);
            saveBlob(blob,name||(plat==='android'?'mauli-android.apk':'mauli-desktop.AppImage'));
            toast('✅ Download पूर्ण','ok');
          }catch(e){toast((e&&e.message)||'Download failed','err');}
          btn.disabled=false;btn.textContent='⬇ Download';
        };
      };
      const poll=async()=>{
        att++;
        try{
          if(viaProjectBuilds){
            const r=await api('/api/project-builds/'+encodeURIComponent(pid));
            const url=plat==='android'?(r&&r.bestAPK):(r&&r.bestEXE);
            if(url){attachDownload(url);toast('✅ Build पूर्ण — Download दाबा','ok');return;}
            if(att<60)setTimeout(poll,10000);
            else if(btn){btn.textContent='Check GitHub';btn.disabled=false;}
            return;
          }
          const s=await api('/api/build-status/'+encodeURIComponent(buildId));
          if(s&&s.downloadUrl){
            // window.open here was the real reason the APK never downloaded: the route
            // needs the founder key, and a new tab cannot send the header, so the
            // founder got a 401 JSON page while the toast said the build had finished.
            attachDownload(s.downloadUrl);
            toast('✅ Build पूर्ण — Download दाबा','ok');
            return;
          }
          // /api/build-status only reports downloadUrl for a real artifact. A finished run
          // with an expired (14 days) or unauthorised artifact reports viewUrl instead, and
          // the run page needs no founder key, so window.open is the right tool for it.
          // Treating it as a download saved a GitHub HTML page as mauli-android.apk.
          if(s&&!s.downloadUrl&&s.viewUrl&&s.status==='success'){
            if(btn){btn.textContent='GitHub बघा';btn.disabled=false;btn.onclick=()=>window.open(s.viewUrl,'_blank','noopener');}
            toast('⚠️ Build झाला पण APK सापडला नाही — artifact 14 दिवसांत expire होतो. पुन्हा 📱 दाबा.','err');
            return;
          }
          if(s&&(s.status==='failure'||s.status==='error'||s.status==='failed')){
            if(btn){btn.textContent='Failed';btn.disabled=false;}
            toast('❌ Build fail — GitHub Actions मध्ये log बघा','err');
            return;
          }
          if(s&&s.status==='superseded'){
            if(btn){btn.textContent=label;btn.disabled=false;}
            return;
          }
          if(att<60)setTimeout(poll,10000);
          else if(btn){btn.textContent='Check GitHub';btn.disabled=false;}
        }catch(e){
          if(/Build not found/i.test(String((e&&e.message)||e||'')))viaProjectBuilds=true;
          if(att<60)setTimeout(poll,viaProjectBuilds?6000:10000);
        }
      };
      setTimeout(poll,6000);
    }catch(e){
      if(btn){btn.textContent=label;btn.disabled=false;}
      toast(buildErrorText(e),'err');
    }
  };
  // dashboard.js registers its own bubble-phase click handler that calls its LOCAL
  // downloadZip()/startBuild() — not the overrides this layer puts on window. So the
  // fixes above never ran for the Projects table or the Builds page: 📥 started 20+
  // <a download> clicks that Chrome blocks after the first, and 📱 finished in
  // window.open(s.downloadUrl), which cannot send the founder key and answered 401.
  // A capture-phase listener runs first and stops the event from reaching the old one.
  document.addEventListener('click',e=>{
    const t=(e.target&&e.target.closest)?e.target.closest('.dl-btn,.bld-btn,.pv-btn'):null;
    if(!t)return;
    e.preventDefault();e.stopPropagation();
    if(t.classList.contains('dl-btn')){window.downloadZip(t.dataset.pid);return;}
    if(t.classList.contains('bld-btn')){window.startBuild(t.dataset.pid,t.dataset.plat,t);return;}
    window.__mauliOpenPreview(t.dataset.pid);
  },true);
  // /api/preview-app is founder-protected too, so the html has to be fetched with the
  // key and opened from a blob. Relative app.js/styles.css do not resolve inside a
  // blob: URL, so files the project ships under www/ are inlined before opening.
  window.__mauliOpenPreview=async function(pid){
    toast('Loading...','info');
    try{
      const {blob}=await fetchAsBlob('/api/preview-app?projectId='+encodeURIComponent(pid),false);
      let html=await blob.text();
      let css='';let js='';
      try{
        const files=await fetchProjectFiles(pid,false);
        for(const f of files){
          const p=String(f.path||'');const base=p.split('/').pop();
          if(!p.startsWith('www/'))continue;
          if(/\.css$/i.test(base))css+='<style>'+f.content+'</style>';
          else if(/\.js$/i.test(base))js+='<scr'+'ipt>'+f.content+'</scr'+'ipt>';
        }
      }catch(_){ }
      if(css)html=/<\/head>/i.test(html)?html.replace(/<\/head>/i,m=>css+m):css+html;
      if(js)html=/<\/body>/i.test(html)?html.replace(/<\/body>/i,m=>js+m):html+js;
      const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));
      const w=window.open(url,'_blank');
      if(!w){URL.revokeObjectURL(url);toast('Preview blocked — pop-up allow करा','err');return;}
      setTimeout(()=>URL.revokeObjectURL(url),120000);
      toast('✅ Preview नवीन tab मध्ये उघडला','ok');
    }catch(e){toast((e&&e.message)||'Preview failed','err');}
  };
  schedulePoll(500);
})();
</script>`;
