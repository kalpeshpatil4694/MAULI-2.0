// MAULI 2.0 — live Founder Command lifecycle bridge.
// The dashboard is server-rendered, so this small client layer keeps the Command Center
// visibly synchronized with durable project/task state without duplicating the dashboard UI.
export const DASHBOARD_LIVE_SCRIPT = String.raw`<script>
(function(){
  const state={known:new Set(),activeProject:null,polling:false};
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const get=(id)=>document.getElementById(id);
  function message(html){const e=get('cmdRes');if(!e)return;e.style.display='block';e.innerHTML=html;}
  function badge(s){const v=String(s||'queued');return '<span style="display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(0,212,255,.1);color:var(--accent);font-size:10px;font-weight:600">'+esc(v)+'</span>';}
  function showProject(p,progress){
    if(!p)return;
    const pr=progress||{};
    const pct=Number.isFinite(Number(pr.percentage))?Math.max(0,Math.min(100,Number(pr.percentage))):({completed:100,working:60,assigned:35,queued:20,awaiting_approval:10,failed:100}[p.state]??10);
    const stage=pr.stage||p.state||'queued';
    const next=pr.nextStage||'—';
    message('<div style="font-family:inherit;line-height:1.6">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>MAULI execution</b>'+badge(p.state)+'</div>'+
      '<div style="margin-top:7px;font-size:11px;color:var(--text2)">'+esc(p.name||p.objective||p.id)+'</div>'+
      '<div style="margin-top:9px;height:6px;background:var(--bg3);border-radius:4px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .4s"></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px;font-size:10px">'+
      '<span>Stage: <b>'+esc(stage)+'</b></span><span>Progress: <b>'+pct+'%</b></span>'+
      '<span>Agent: <b>'+esc(pr.currentAgent?.name||pr.currentAgent?.id||'—')+'</b></span><span>Next: <b>'+esc(next)+'</b></span>'+
      '</div>'+
      (p.state==='completed'?'<div style="margin-top:8px;color:var(--green);font-weight:600">✅ Final delivery completed</div>':'')+
      (p.state==='failed'?'<div style="margin-top:8px;color:var(--red);font-weight:600">❌ Execution failed — recovery required</div>':'')+
      '<button class="proj-detail-btn" style="margin-top:8px;background:var(--accent);color:#000;border:none;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600" onclick="window.__showProjDetail&&window.__showProjDetail(\''+esc(p.id)+'\')">📄 View Full Project Details</button>'+
      '</div>');
    window.__showProjDetail=showProjectDetail;
  }
  async function poll(){
    if(state.polling)return;state.polling=true;
    try{
      const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)return;
      const j=await r.json();const d=j.data||j;const projects=Array.isArray(d.projects)?d.projects:[];
      const candidates=projects.filter(p=>p&&p.founderCommand&&p.queuedAt);
      candidates.sort((a,b)=>Date.parse(b.queuedAt||b.createdAt||0)-Date.parse(a.queuedAt||a.createdAt||0));
      const latest=candidates[0];
      if(latest&&(!state.activeProject||latest.id!==state.activeProject.id)){
        state.activeProject=latest;
        showProject(latest,null);
      }
      if(state.activeProject){
        const fresh=projects.find(p=>p.id===state.activeProject.id)||state.activeProject;
        state.activeProject=fresh;
        let progress=null;
        try{const q=await fetch('/api/project-progress/'+encodeURIComponent(fresh.id),{cache:'no-store'});if(q.ok){const x=await q.json();progress=(x.data||x).progress||null;}}catch(_){ }
        showProject(fresh,progress);
      }
      // Keep the visible counters synchronized even if the legacy dashboard render is unchanged.
      const set=(id,v)=>{const e=get(id);if(e)e.textContent=String(v);};
      set('sProj',projects.length);set('navP',projects.length);
      if(Array.isArray(d.tasks)){set('sTask',d.tasks.length);set('navT',d.tasks.filter(t=>t.state==='working').length||d.tasks.length);}
    }catch(_){ }
    finally{state.polling=false;}
  }
  // Project detail view
  async function showProjectDetail(pid){
    if(!pid)return;
    try{
      const r=await fetch('/api/projects/'+encodeURIComponent(pid)+'/detail');
      const d=await r.json();
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
      txt+='PROGRESS: '+s.completedTasks+'/'+s.totalTasks+' tasks ('+s.progressPct+'%)\n';
      txt+='Completed: '+s.completedTasks+' | Running: '+s.runningTasks+' | Failed: '+s.failedTasks+' | Pending: '+s.pendingTasks+'\n\n';
      if(s.errors&&s.errors.length>0){txt+='ERRORS:\n';for(const e of s.errors)txt+='  - '+e.task+': '+e.error+'\n';txt+='\n';}
      if(s.fixes&&s.fixes.length>0){txt+='RETRIES:\n';for(const f of s.fixes)txt+='  - '+f.task+': '+f.attempts+' attempts\n';txt+='\n';}
      txt+='TASKS:\n';
      for(const t of det.tasks){const icon=t.state==='completed'?'[OK]':t.state==='working'?'[..]':t.state==='assigned'?'[>>]':t.state==='failed'?'[!!]':'[--]';txt+='  '+icon+' '+esc(t.title||t.id)+' ['+t.state+']';if(t.agentName)txt+=' — agent: '+t.agentName;if(t.error)txt+=' ERROR: '+t.error;txt+='\n';}
      // Show as modal overlay
      const overlay=document.createElement('div');overlay.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
      const modal=document.createElement('div');modal.style.cssText='background:var(--bg2);border:1px solid var(--border);border-radius:12px;max-width:700px;width:100%;max-height:80vh;overflow:auto;padding:20px;font-family:monospace;font-size:12px;color:var(--text);white-space:pre-wrap';
      modal.textContent=txt;
      const closeBtn=document.createElement('button');closeBtn.textContent='Close';closeBtn.style.cssText='position:sticky;top:0;float:right;background:var(--accent);color:#000;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-weight:600';
      closeBtn.onclick=()=>overlay.remove();
      overlay.onclick=(e)=>{if(e.target===overlay)overlay.remove()};
      modal.prepend(closeBtn);
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
  window.setTimeout(poll,500);
  window.setInterval(poll,3000);
})();
</script>`;
