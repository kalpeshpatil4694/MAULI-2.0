import { ok, fail, json, now } from './core.js';
import { store } from './store.js';
import { seedAgents, listAgents } from './agents.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { listApprovals, decideApproval } from './governance.js';
import { planCommand, resumeApprovedCommand } from './orchestrator.js';
import { listTools } from './tools.js';
import { ensureSchema, hasD1, d1List, d1Events } from './db.js';
import { recoverRunningExecutions } from './execution.js';
import { requireFounder, checkRateLimit } from './auth.js';

const dashboard = () => {
  const html = [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>MAULI 2.0 Command Center</title>',
    '<style>',
    'body{margin:0;font-family:system-ui;background:#080d18;color:#eef2ff}',
    'header{padding:20px 28px;background:#101a32;border-bottom:1px solid #273253;position:sticky;top:0}',
    'main{padding:24px;max-width:1280px;margin:auto}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}',
    '.card{background:#111a30;border:1px solid #29355c;border-radius:14px;padding:18px}',
    'button{padding:11px 16px;border:0;border-radius:9px;cursor:pointer}',
    'textarea{width:100%;min-height:100px;background:#080d18;color:#fff;border:1px solid #33406a;border-radius:9px;padding:10px;box-sizing:border-box}',
    '.pill{display:inline-block;padding:5px 9px;border-radius:20px;background:#202b4d;margin:3px;font-size:12px}',
    '.ok{font-size:12px;opacity:.75}',
    '</style></head><body>',
    '<header><strong>MAULI 2.0</strong> — Autonomous AI Company <span class="ok" id="health"></span></header>',
    '<main>',
    '<section class="card"><h2>Founder Command</h2>',
    '<textarea id="cmd" placeholder="उदा. मला एक e-commerce platform तयार करून द्या"></textarea><br><br>',
    '<button onclick="send()">Send to MAULI</button><pre id="out"></pre></section>',
    '<h2>Virtual Company</h2><div id="app" class="grid"></div>',
    '</main>',
    '<script>',
    'async function send(){',
    'const command=document.getElementById("cmd").value;',
    'if(!command.trim())return;',
    'const key=prompt("Founder API key");',
    'if(!key)return;',
    'const r=await fetch("/api/command",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+key},body:JSON.stringify({command})});',
    'document.getElementById("out").textContent=JSON.stringify(await r.json(),null,2);load()',
    '}',
    'async function load(){',
    'const r=await fetch("/api/state");const x=await r.json();',
    'const departments=[...new Set(x.agents.map(a=>a.department))];',
    'document.getElementById("app").innerHTML=',
    '`<div class="card"><h3>Agents</h3><b>${x.agents.length}</b></div>`+',
    '`<div class="card"><h3>Departments</h3>${departments.map(d=>`<span class="pill">${d}</span>`).join("")}</div>`+',
    '`<div class="card"><h3>Projects</h3><b>${x.projects.length}</b></div>`+',
    '`<div class="card"><h3>Tasks</h3><b>${x.tasks.length}</b></div>`+',
    '`<div class="card"><h3>Approvals</h3><b>${x.approvals.filter(a=>a.state==="pending").length}</b> pending</div>`+',
    '`<div class="card"><h3>Tools</h3><b>${x.tools.length}</b></div>`+',
    '`<div class="card"><h3>Recent activity</h3>${x.events.slice(0,8).map(e=>`<div>${e.type}</div>`).join("")}</div>`;',
    '}',
    'async function health(){const r=await fetch("/api/health");const x=await r.json();document.getElementById("health").textContent=" • "+x.status+" • "+(x.persistence?"D1":"memory")}',
    'health();load();',
    '</script></body></html>'
  ].join('');
  return html;
};

export default {
  async fetch(request, env) {
    try {
      await ensureSchema(env);
      store.configure(env);
      if (!store.hydrated) await store.hydrate();
      seedAgents();
      const recoveredRuns = recoverRunningExecutions();
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/') return new Response(dashboard(), { headers:{'content-type':'text/html;charset=UTF-8'} });
      if (request.method === 'GET' && url.pathname === '/api/health') return ok({ service:'mauli2.0', status:'healthy', persistence:hasD1(env), hydrated:store.hydrated, ai:Boolean(env?.AI), recoveredRuns:recoveredRuns.length, time:now() });
      if (request.method === 'GET' && url.pathname === '/api/state') { const [agents,projects,tasks,approvals,events] = hasD1(env) ? await Promise.all([d1List(env,'agents'),d1List(env,'projects'),d1List(env,'tasks'),d1List(env,'approvals'),d1Events(env)]) : [listAgents(),listProjects(),listTasks(),listApprovals(),store.recentEvents()]; return ok({ agents, projects, tasks, approvals, tools:listTools(), events, recoveredRuns }); }
      if (request.method === 'POST' && url.pathname === '/api/command') { const limit=checkRateLimit(request); if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter}); const auth=requireFounder(request,env); if(!auth.ok)return fail(auth.error,auth.status); const body=await json(request); if(!body.command)return fail('Founder command is required',400); store.addEvent('security.command_authorized',{ip:request.headers.get('cf-connecting-ip') ?? 'unknown',remaining:limit.remaining}); return ok({ result:await planCommand(body.command,env) },201); }
      if (request.method === 'POST' && url.pathname.startsWith('/api/approvals/')) { const limit=checkRateLimit(request); if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter}); const auth=requireFounder(request,env); if(!auth.ok)return fail(auth.error,auth.status); const approvalId=url.pathname.split('/').pop(); const body=await json(request); const result=decideApproval(approvalId,Boolean(body.approved),body.note ?? ''); if(!result)return fail('Approval not found',404); store.addEvent('security.approval_action',{approvalId,approved:Boolean(body.approved)}); if(result.state==='rejected')return ok({approval:result,status:'rejected'}); const resumed=await resumeApprovedCommand(approvalId,env); return ok({approval:result,result:resumed}); }
      return fail('Route not found',404);
    } catch(error) { return fail(error.message || 'Internal error',500); }
  }
};
