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
      '</div>');
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
  window.setTimeout(poll,500);
  window.setInterval(poll,3000);
})();
</script>`;
