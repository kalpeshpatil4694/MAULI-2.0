import { ok, fail, json, now } from './core.js';
import { store } from './store.js';
import { seedAgents, listAgents } from './agents.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { listApprovals, decideApproval } from './governance.js';
import { planCommand } from './orchestrator.js';
import { listTools } from './tools.js';

seedAgents();

const dashboard = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAULI 2.0</title><style>body{margin:0;font-family:system-ui;background:#0b1020;color:#eef2ff}header{padding:22px 28px;background:#111936;border-bottom:1px solid #273253}main{padding:24px;max-width:1200px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.card{background:#121a32;border:1px solid #29355c;border-radius:14px;padding:18px}button{padding:11px 16px;border:0;border-radius:9px;cursor:pointer}textarea{width:100%;min-height:90px;background:#0b1020;color:#fff;border:1px solid #33406a;border-radius:9px;padding:10px;box-sizing:border-box}.pill{display:inline-block;padding:5px 9px;border-radius:20px;background:#202b4d;margin:3px;font-size:12px}</style></head><body><header><strong>MAULI 2.0</strong> — Autonomous AI Company</header><main><section class="card"><h2>Founder Command</h2><textarea id="cmd" placeholder="उदा. मला एक e-commerce platform तयार करून द्या"></textarea><br><br><button onclick="send()">Send to MAULI</button><pre id="out"></pre></section><h2>Virtual Company</h2><div id="app" class="grid"></div></main><script>async function send(){const command=document.getElementById('cmd').value;const r=await fetch('/api/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command})});document.getElementById('out').textContent=JSON.stringify(await r.json(),null,2);load()}async function load(){const r=await fetch('/api/state');const x=await r.json();document.getElementById('app').innerHTML=`<div class="card"><h3>Executive</h3><b>${x.agents.filter(a=>a.department==='Executive').length}</b> agents</div><div class="card"><h3>Departments</h3>${[...new Set(x.agents.map(a=>a.department))].map(d=>`<span class="pill">${d}</span>`).join('')}</div><div class="card"><h3>Agents</h3>${x.agents.map(a=>`<div>${a.name} — ${a.state}</div>`).join('')}</div><div class="card"><h3>Projects</h3><b>${x.projects.length}</b></div><div class="card"><h3>Tasks</h3><b>${x.tasks.length}</b></div><div class="card"><h3>Approvals</h3><b>${x.approvals.filter(a=>a.state==='pending').length}</b> pending</div>`}load()</script></body></html>`;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/') return new Response(dashboard(), { headers: { 'content-type': 'text/html;charset=UTF-8' } });
      if (request.method === 'GET' && url.pathname === '/api/health') return ok({ service: 'mauli2.0', status: 'healthy', time: now() });
      if (request.method === 'GET' && url.pathname === '/api/state') return ok({ agents: listAgents(), projects: listProjects(), tasks: listTasks(), approvals: listApprovals(), tools: listTools(), events: store.recentEvents() });
      if (request.method === 'POST' && url.pathname === '/api/command') {
        const body = await json(request);
        return ok({ result: planCommand(body.command) }, 201);
      }
      if (request.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
        const approvalId = url.pathname.split('/').pop();
        const body = await json(request);
        const result = decideApproval(approvalId, Boolean(body.approved), body.note ?? '');
        return result ? ok({ approval: result }) : fail('Approval not found', 404);
      }
      return fail('Route not found', 404);
    } catch (error) { return fail(error.message || 'Internal error', 500); }
  }
};
