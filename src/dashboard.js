export function dashboardHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAULI 2.0 — AI Command Center</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg0:#060a14;--bg1:#0b1120;--bg2:#111a2e;--bg3:#182240;--border:#1e2d4a;--border2:#293b64;--text:#e8ecf4;--text2:#8899bb;--text3:#556688;--accent:#00d4ff;--accent2:#7c5cff;--accent3:#ff6b9d;--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--r:12px;--rs:8px}
html{font-size:15px}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg0);color:var(--text);min-height:100vh;overflow-x:hidden}
::selection{background:var(--accent);color:var(--bg0)}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:var(--bg1)}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
a{color:var(--accent);text-decoration:none}

/* Layout */
.layout{display:flex;min-height:100vh}
.sidebar{width:240px;background:rgba(11,17,32,.85);backdrop-filter:blur(20px);border-right:1px solid var(--border);position:fixed;top:0;left:0;bottom:0;z-index:100;display:flex;flex-direction:column;transition:transform .3s}
.main{flex:1;margin-left:240px;min-height:100vh}
.topbar{position:sticky;top:0;z-index:50;background:rgba(6,10,20,.9);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between}
.topbar-l{display:flex;align-items:center;gap:12px}
.topbar-r{display:flex;align-items:center;gap:10px}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse 2s infinite}
.status-dot.off{background:var(--red);box-shadow:0 0 6px var(--red)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.content{padding:20px 24px 40px}

/* Sidebar */
.sb-head{padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
.sb-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:var(--bg0)}
.sb-nav{flex:1;padding:8px;overflow-y:auto}
.sb-sec{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text3);padding:12px 10px 4px;display:flex;align-items:center;gap:6px}
.sb-sec::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)}
.nav-i{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--rs);cursor:pointer;font-size:12px;color:var(--text2);transition:all .15s;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.nav-i:hover{background:var(--bg2);color:var(--text)}
.nav-i.on{background:rgba(0,212,255,.08);color:var(--accent);font-weight:600}
.nav-i.on::before{content:'';width:3px;height:16px;background:var(--accent);border-radius:0 3px 3px 0;margin-right:2px}
.nav-b{margin-left:auto;background:var(--accent2);color:#fff;font-size:9px;padding:2px 6px;border-radius:8px;font-weight:600}
.hamburger{display:none;background:none;border:none;color:var(--text);font-size:20px;cursor:pointer;padding:8px}
.sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99}
body.sb-open .sidebar{transform:translateX(0)}
body.sb-open .sb-overlay{display:block}
body.sb-open{overflow:hidden}

/* Cards */
.card{background:var(--bg2);border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:12px;transition:border-color .2s}
.card:hover{border-color:var(--border2)}
.card-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.card-t{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}
.card-s{font-size:11px;color:var(--text2)}

/* Grid */
.g{display:grid;gap:12px}
.g2{grid-template-columns:repeat(2,1fr)}
.g3{grid-template-columns:repeat(3,1fr)}
.g4{grid-template-columns:repeat(4,1fr)}
.g5{grid-template-columns:repeat(5,1fr)}
.g-auto{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
@media(max-width:900px){.g2,.g3,.g4,.g5{grid-template-columns:1fr}}

/* Stats */
.stat{text-align:center;padding:16px;position:relative;overflow:hidden}
.stat::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:40px;height:2px;background:linear-gradient(90deg,transparent,var(--accent),transparent)}
.stat-v{font-size:28px;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.stat-l{font-size:11px;color:var(--text2);margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
.stat-i{font-size:20px;margin-bottom:6px;opacity:.7}

/* Buttons */
.btn{padding:7px 14px;border-radius:var(--rs);border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:12px;cursor:pointer;font-weight:500;display:inline-flex;align-items:center;gap:5px;transition:all .15s}
.btn:hover{border-color:var(--border2);transform:translateY(-1px)}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-p{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;font-weight:600;box-shadow:0 2px 12px rgba(0,212,255,.25)}
.btn-p:hover{box-shadow:0 4px 20px rgba(0,212,255,.35)}
.btn-g{background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.3);color:var(--green)}
.btn-r{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3);color:var(--red)}
.btn-a{background:rgba(0,212,255,.08);border-color:rgba(0,212,255,.3);color:var(--accent)}
.btn-s{padding:4px 8px;font-size:10px}

/* Inputs */
.inp{width:100%;padding:8px 12px;background:var(--bg1);border:1px solid var(--border);border-radius:var(--rs);color:var(--text);font-size:13px;font-family:inherit;transition:border-color .2s}
.inp:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,212,255,.1)}
textarea.inp{min-height:80px;resize:vertical;font-family:monospace;font-size:12px}
select.inp{cursor:pointer}

/* Badges */
.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600}
.badge-g{background:rgba(34,197,94,.12);color:var(--green)}
.badge-r{background:rgba(239,68,68,.12);color:var(--red)}
.badge-y{background:rgba(234,179,8,.12);color:var(--yellow)}
.badge-b{background:rgba(59,130,246,.12);color:var(--blue)}
.badge-a{background:rgba(0,212,255,.08);color:var(--accent)}

/* Pages */
.page{display:none;animation:fadeIn .25s ease}
.page.on{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}

/* Table */
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);padding:8px 10px;border-bottom:1px solid var(--border)}
.tbl td{padding:8px 10px;border-bottom:1px solid rgba(30,45,74,.3);font-size:12px}

/* Chat */
.chat-box{display:flex;flex-direction:column;height:calc(100vh - 140px)}
.chat-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.chat-msg{max-width:80%;padding:10px 14px;border-radius:10px;font-size:12px;line-height:1.5;animation:fadeIn .2s}
.chat-msg.user{align-self:flex-end;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border-bottom-right-radius:3px}
.chat-msg.bot{align-self:flex-start;background:var(--bg2);border:1px solid var(--border);border-bottom-left-radius:3px}
.chat-msg .mr{font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;opacity:.7}
.chat-in{display:flex;gap:6px;padding:12px;border-top:1px solid var(--border);background:var(--bg1)}
.chat-in .inp{flex:1}

/* Progress */
.pbar{height:5px;background:var(--bg3);border-radius:3px;overflow:hidden}
.pfill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .4s}
.pfill.done{background:var(--green)}
.pfill.err{background:var(--red)}

/* Toast */
.toast-c{position:fixed;top:16px;right:16px;z-index:2000;display:flex;flex-direction:column;gap:6px}
.toast{padding:10px 16px;border-radius:var(--rs);font-size:12px;font-weight:500;animation:slideIn .25s;display:flex;align-items:center;gap:6px;box-shadow:0 4px 20px rgba(0,0,0,.4)}
.toast.ok{background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:var(--green)}
.toast.err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:var(--red)}
.toast.info{background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.3);color:var(--blue)}
@keyframes slideIn{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}

/* Loading */
.spinner{width:20px;height:20px;border:2px solid var(--bg3);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite;margin:0 auto}
@keyframes spin{to{transform:rotate(360deg)}}
.loading{display:none;padding:16px;text-align:center}
.loading.show{display:block}

/* Responsive */
@media(max-width:768px){
  .hamburger{display:block}
  .sidebar{transform:translateX(-100%);z-index:200;width:260px}
  .sb-nav{overflow-y:auto;-webkit-overflow-scrolling:touch}
  .main{margin-left:0}
  .content{padding:12px}
  .g4,.g5{grid-template-columns:repeat(2,1fr)}
}
</style>
</head>
<body>
<div class="sb-overlay" id="sbOverlay" onclick="closeSb()"></div>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="sb-head">
      <div class="sb-logo">M</div>
      <div><div style="font-size:13px;font-weight:700;letter-spacing:.3px">MAULI 2.0</div><div style="font-size:10px;color:var(--text2)">AI Command Center</div></div>
    </div>
    <nav class="sb-nav">
      <div class="sb-sec">Command</div>
      <div class="nav-i on" data-p="command"><span>⚡</span>Command Center</div>
      <div class="nav-i" data-p="chat"><span>💬</span>Chat</div>
      <div class="sb-sec">Intelligence</div>
      <div class="nav-i" data-p="overview"><span>📊</span>Overview</div>
      <div class="nav-i" data-p="agents"><span>🤖</span>Agents<span class="nav-b" id="navA">0</span></div>
      <div class="nav-i" data-p="monitor"><span>📡</span>Monitor</div>
      <div class="sb-sec">Workspace</div>
      <div class="nav-i" data-p="projects"><span>📁</span>Projects<span class="nav-b" id="navP">0</span></div>
      <div class="nav-i" data-p="tasks"><span>📋</span>Tasks<span class="nav-b" id="navT">0</span></div>
      <div class="nav-i" data-p="docs"><span>📚</span>Docs</div>
      <div class="sb-sec">Governance</div>
      <div class="nav-i" data-p="approvals"><span>🛡️</span>Approvals<span class="nav-b" id="navAp" style="background:var(--yellow)">0</span></div>
      <div class="sb-sec">System</div>
      <div class="nav-i" data-p="activity"><span>📡</span>Activity</div>
      <div class="nav-i" data-p="health"><span>💚</span>Health</div>
      <div class="nav-i" data-p="memory"><span>🧠</span>Memory</div>
      <div class="nav-i" data-p="integrations"><span>🔗</span>Integrations</div>
      <div class="sb-sec">Tools</div>
      <div class="nav-i" data-p="editor"><span>✏️</span>File Editor</div>
      <div class="nav-i" data-p="learning"><span>🎓</span>Learning</div>
      <div class="nav-i" data-p="builds"><span>🔨</span>Builds</div>
      <div class="nav-i" data-p="messaging"><span>💌</span>Messaging</div>
      <div class="nav-i" data-p="apiexp"><span>🌐</span>API Explorer</div>
      <div class="nav-i" data-p="downloads"><span>📥</span>Downloads</div>
      <div class="sb-sec">Settings</div>
      <div class="nav-i" onclick="resetAll()"><span>🗑️</span>Reset All Data</div>
    </nav>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="topbar-l">
        <button class="hamburger" onclick="toggleSb()">☰</button>
        <span class="status-dot" id="hDot"></span>
        <span style="font-size:11px;color:var(--text2)" id="hText">Connecting...</span>
        <span style="font-size:13px;font-weight:600;margin-left:8px" id="pageTitle">Command Center</span>
      </div>
      <div class="topbar-r">
        <button class="btn btn-a btn-s" onclick="go('chat')">💬</button>
        <span style="font-size:11px;color:var(--text3)" id="clock"></span>
      </div>
    </header>
    <div class="content">
      <!-- COMMAND CENTER -->
      <div class="page on" id="pg-command">
        <div class="g g4" style="margin-bottom:16px">
          <div class="card stat"><div class="stat-i">📁</div><div class="stat-v" id="sProj">0</div><div class="stat-l">Projects</div></div>
          <div class="card stat"><div class="stat-i">📋</div><div class="stat-v" id="sTask">0</div><div class="stat-l">Tasks</div></div>
          <div class="card stat"><div class="stat-i">🤖</div><div class="stat-v" id="sAg">0</div><div class="stat-l">Agents</div></div>
          <div class="card stat"><div class="stat-i">📦</div><div class="stat-v" id="sArt">0</div><div class="stat-l">Artifacts</div></div>
        </div>
        <div class="card">
          <div class="card-h"><div class="card-t">⚡ Founder Command</div><div class="card-s">Tell MAULI what to build</div></div>
          <textarea class="inp" id="cmdIn" placeholder="Example: Build a weather app for Android with live forecasts..." rows="3"></textarea>
          <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
            <button class="btn btn-p" id="cmdBtn" onclick="sendCmd()">⚡ Execute</button>
            <div class="loading" id="cmdLoad"><div class="spinner"></div></div>
          </div>
          <pre class="card" id="cmdRes" style="display:none;margin-top:10px;font-size:11px;max-height:250px;overflow:auto;font-family:monospace;background:var(--bg1)"></pre>
        </div>
        <div class="card">
          <div class="card-h"><div class="card-t">🚀 Quick Actions</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-a btn-s" onclick="qCmd('Build a weather app for Android')">🌤️ Weather</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Create an e-commerce platform')">🛒 E-Commerce</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Build a calculator app')">🔢 Calculator</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Create a music player app')">🎵 Music</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Build a chat application')">💬 Chat</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Create a PDF report generator')">📄 PDF</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Build a task management system')">✅ Tasks</button>
            <button class="btn btn-a btn-s" onclick="qCmd('Create a portfolio website')">🌐 Portfolio</button>
          </div>
        </div>
      </div>
      <!-- CHAT -->
      <div class="page" id="pg-chat">
        <div class="card" style="padding:0;overflow:hidden;height:calc(100vh - 120px)">
          <div class="chat-box">
            <div class="chat-msgs" id="chatMsgs">
              <div class="chat-msg bot"><div class="mr">MAULI</div>Hello! I'm MAULI 2.0. Ask me anything or tell me what to build!</div>
            </div>
            <div class="chat-in">
              <input class="inp" id="chatIn" placeholder="Type a message..." onkeydown="if(event.key==='Enter')sendChat()">
              <button class="btn btn-p" onclick="sendChat()">Send</button>
            </div>
          </div>
        </div>
      </div>
      <!-- OVERVIEW -->
      <div class="page" id="pg-overview">
        <div class="g g5" style="margin-bottom:16px">
          <div class="card stat"><div class="stat-i">📁</div><div class="stat-v" id="ovP">0</div><div class="stat-l">Projects</div></div>
          <div class="card stat"><div class="stat-i">✅</div><div class="stat-v" id="ovC">0</div><div class="stat-l">Completed</div></div>
          <div class="card stat"><div class="stat-i">⚡</div><div class="stat-v" id="ovA">0</div><div class="stat-l">Active</div></div>
          <div class="card stat"><div class="stat-i">🤖</div><div class="stat-v" id="ovAg">0</div><div class="stat-l">Agents</div></div>
          <div class="card stat"><div class="stat-i">📦</div><div class="stat-v" id="ovArt">0</div><div class="stat-l">Artifacts</div></div>
        </div>
        <div class="g g2">
          <div class="card"><div class="card-h"><div class="card-t">📈 Activity</div></div><div id="ovAct" style="max-height:350px;overflow-y:auto"></div></div>
          <div class="card"><div class="card-h"><div class="card-t">💚 Health</div></div><div id="ovHealth"></div></div>
        </div>
      </div>
      <!-- AGENTS -->
      <div class="page" id="pg-agents"><div class="g g-auto" id="agList"></div></div>
      <!-- MONITOR -->
      <div class="page" id="pg-monitor">
        <div class="card"><div class="card-h"><div class="card-t">📡 Live Monitor</div><button class="btn btn-a btn-s" onclick="renderMonitor()">↻</button></div><div class="g g4" id="monGrid"></div></div>
        <div class="g g2">
          <div class="card"><div class="card-h"><div class="card-t">🤖 Agents</div></div><div id="monAgents" style="max-height:300px;overflow-y:auto"></div></div>
          <div class="card"><div class="card-h"><div class="card-t">📊 Tasks</div></div><div id="monTasks" style="max-height:300px;overflow-y:auto"></div></div>
        </div>
      </div>
      <!-- PROJECTS -->
      <div class="page" id="pg-projects">
        <div class="card">
          <div class="card-h"><div class="card-t">📁 Projects</div><div class="card-s" id="projCnt">0</div></div>
          <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">
            <input class="inp" id="projSearch" placeholder="🔍 Search..." style="flex:1;min-width:150px" oninput="filterProj()">
            <select class="inp" id="projFilter" style="width:auto" onchange="filterProj()"><option value="">All</option><option value="active">Active</option><option value="completed">Completed</option><option value="escalated">Escalated</option></select>
          </div>
          <div id="projList"></div>
        </div>
      </div>
      <!-- TASKS -->
      <div class="page" id="pg-tasks">
        <div class="card"><div class="card-h"><div class="card-t">📋 Tasks</div><div class="card-s" id="taskCnt">0</div></div><div id="taskList"></div></div>
      </div>
      <!-- DOCS -->
      <div class="page" id="pg-docs">
        <div class="card"><div class="card-h"><div class="card-t">📚 Documentation</div><button class="btn btn-a btn-s" onclick="genDocs()">📄 Generate</button></div><div id="docsOut"><div style="text-align:center;padding:40px;color:var(--text2)">Select a project to generate docs</div></div></div>
      </div>
      <!-- APPROVALS -->
      <div class="page" id="pg-approvals"><div class="card"><div class="card-h"><div class="card-t">🛡️ Pending Approvals</div></div><div id="apprList"></div></div></div>
      <!-- ACTIVITY -->
      <div class="page" id="pg-activity">
        <div class="card"><div class="card-h"><div class="card-t">📡 Activity Log</div><button class="btn btn-a btn-s" onclick="loadState()">↻</button></div><div id="actList" style="max-height:500px;overflow-y:auto"></div></div>
      </div>
      <!-- HEALTH -->
      <div class="page" id="pg-health">
        <div class="g g2">
          <div class="card"><div class="card-h"><div class="card-t">💚 System Health</div><button class="btn btn-g btn-s" onclick="runTest()">▶ Test</button></div><div id="hlthDet"></div><div id="testRes" style="margin-top:10px"></div></div>
          <div class="card"><div class="card-h"><div class="card-t">🔧 Tools</div></div><div id="toolsOut"></div></div>
        </div>
        <div class="card"><div class="card-h"><div class="card-t">🔍 Diagnostics</div><button class="btn btn-a btn-s" onclick="runDiag()">▶ Run</button></div><div id="diagOut"></div></div>
      </div>
      <!-- MEMORY -->
      <div class="page" id="pg-memory"><div class="card"><div class="card-h"><div class="card-t">🧠 Memory</div></div><div id="memList" style="max-height:500px;overflow-y:auto"></div></div></div>
      <!-- INTEGRATIONS -->
      <div class="page" id="pg-integrations">
        <div class="card"><div class="card-h"><div class="card-t">🔗 Integrations</div></div><div class="g g3" id="intList"></div></div>
      </div>
      <!-- EDITOR -->
      <div class="page" id="pg-editor">
        <div class="g g2">
          <div class="card"><div class="card-h"><div class="card-t">✏️ File Editor</div><button class="btn btn-a btn-s" onclick="loadEdits()">↻</button></div>
            <select class="inp" id="edProj" style="margin-bottom:6px" onchange="loadProjFiles(this.value)"><option value="">Select project...</option></select>
            <input class="inp" id="edFile" placeholder="File path" style="margin-bottom:6px">
            <textarea class="inp" id="edContent" rows="10" placeholder="Content..."></textarea>
            <div style="display:flex;gap:6px;margin-top:6px"><button class="btn btn-p" onclick="saveFile()">💾 Save</button><button class="btn btn-a" onclick="loadFile()">📂 Load</button></div>
          </div>
          <div class="card"><div class="card-h"><div class="card-t">📋 Recent Edits</div></div><div id="edList" style="max-height:400px;overflow-y:auto"></div></div>
        </div>
      </div>
      <!-- LEARNING -->
      <div class="page" id="pg-learning">
        <div class="g g3" style="margin-bottom:12px">
          <div class="card stat"><div class="stat-i">🎓</div><div class="stat-v" id="lT">0</div><div class="stat-l">Learned</div></div>
          <div class="card stat"><div class="stat-i">⭐</div><div class="stat-v" id="lP">0</div><div class="stat-l">Patterns</div></div>
          <div class="card stat"><div class="stat-i">🧬</div><div class="stat-v" id="lS">0</div><div class="stat-l">Skills</div></div>
        </div>
        <div class="g g2">
          <div class="card"><div class="card-h"><div class="card-t">🌳 Skill Tree</div></div><div id="skillOut" style="max-height:350px;overflow-y:auto"></div></div>
          <div class="card"><div class="card-h"><div class="card-t">📊 Stats</div></div><div id="learnOut" style="max-height:350px;overflow-y:auto"></div></div>
        </div>
      </div>
      <!-- BUILDS -->
      <div class="page" id="pg-builds"><div class="card"><div class="card-h"><div class="card-t">🔨 Build Manager</div><button class="btn btn-a btn-s" onclick="loadBuilds()">↻</button></div><div id="buildOut" style="max-height:500px;overflow-y:auto"></div></div></div>
      <!-- MESSAGING -->
      <div class="page" id="pg-messaging">
        <div class="card"><div class="card-h"><div class="card-t">💌 Messaging</div><button class="btn btn-a btn-s" onclick="loadMsgs()">↻</button></div><div id="msgList" style="max-height:350px;overflow-y:auto"></div></div>
        <div class="card"><div class="card-h"><div class="card-t">📤 Send</div></div>
          <select class="inp" id="msgFrom" style="margin-bottom:6px"><option value="">From...</option></select>
          <select class="inp" id="msgTo" style="margin-bottom:6px"><option value="">To...</option></select>
          <textarea class="inp" id="msgBody" rows="2" placeholder="Message..." style="margin-bottom:6px"></textarea>
          <div style="display:flex;gap:6px"><button class="btn btn-p" onclick="sendMsg()">📤 Send</button><button class="btn btn-a" onclick="bcastMsg()">📡 Broadcast</button></div>
        </div>
      </div>
      <!-- API EXPLORER -->
      <div class="page" id="pg-apiexp">
        <div class="card"><div class="card-h"><div class="card-t">🌐 API Explorer</div></div>
          <div style="display:flex;gap:6px;margin-bottom:10px"><input class="inp" id="apiQ" placeholder="Search APIs..." style="flex:1"><button class="btn btn-p" onclick="searchApi()">🔍</button></div>
          <div id="apiRes" style="max-height:300px;overflow-y:auto"></div>
        </div>
        <div class="card"><div class="card-h"><div class="card-t">🔌 MCP Servers</div></div><div id="mcpOut" style="max-height:300px;overflow-y:auto"></div></div>
      </div>
      <!-- DOWNLOADS -->
      <div class="page" id="pg-downloads"><div class="card"><div class="card-h"><div class="card-t">📥 Downloads</div><button class="btn btn-g btn-s" onclick="loadDl()">↻</button></div><div id="dlList"></div></div></div>
    </div>
  </div>
</div>
<div class="toast-c" id="toastC"></div>

<script>
const S={projects:[],tasks:[],artifacts:[],agents:[],events:[],approvals:[],tools:[]};
const $=id=>document.getElementById(id);
let curPage='command';

// ─── HELPERS ───
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function badge(s){return s==='completed'?'g':s==='active'?'b':s==='planning'?'a':s==='escalated'?'r':'y'}
function tBadge(s){return s==='completed'?'g':s==='working'?'a':s==='failed'||s==='blocked'?'r':s==='verifying'?'b':'y'}
function pct(s){return s==='completed'?'100':s==='working'?'60':s==='failed'?'100':'20'}
function fmt(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch(e){return String(d)}}
function toast(m,t='info'){const e=document.createElement('div');e.className='toast '+t;e.textContent=m;$('toastC').appendChild(e);setTimeout(()=>e.remove(),3500)}
function md(s){if(!s)return'';let t=esc(s);t=t.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');t=t.replace(/\\*(.+?)\\*/g,'<em>$1</em>');t=t.replace(/^### (.+)$/gm,'<b style="color:var(--accent)">$1</b>');t=t.replace(/^## (.+)$/gm,'<b>$1</b>');t=t.replace(/^# (.+)$/gm,'<b style="font-size:14px">$1</b>');t=t.replace(/^• (.+)$/gm,'<div style="padding-left:10px">• $1</div>');t=t.replace(/\n/g,'<br>');return t}
function actColor(ev){return ev.type?.includes('error')?'var(--red)':ev.type?.includes('task_result')?'var(--green)':ev.type?.includes('command')?'var(--accent)':'var(--blue)'}

// ─── API ───
async function api(path,opts={}){
  try{const m=(opts.method||'GET').toUpperCase();const hdrs={...(opts.headers||{})};
    if(m==='POST'||m==='PUT'||m==='PATCH')hdrs['Content-Type']='application/json';
    const r=await fetch(path,{method:m,headers:hdrs,body:opts.body});
    if(!r.ok){const t=await r.text().catch(()=>'');throw new Error(t||r.status)}return r.json()
  }catch(e){throw e}
}

// ─── NAVIGATION ───
const titles={command:'Command Center',chat:'Chat',overview:'Overview',agents:'Agents',monitor:'Monitor',projects:'Projects',tasks:'Tasks',docs:'Docs',approvals:'Approvals',activity:'Activity',health:'Health',memory:'Memory',integrations:'Integrations',editor:'File Editor',learning:'Learning',builds:'Builds',messaging:'Messaging',apiexp:'API Explorer',downloads:'Downloads'};
function go(p){curPage=p;closeSb();document.querySelectorAll('.page').forEach(e=>e.classList.remove('on'));const pg=$('pg-'+p);if(pg)pg.classList.add('on');document.querySelectorAll('.nav-i').forEach(e=>e.classList.remove('on'));const nav=document.querySelector('.nav-i[data-p="'+p+'"]');if(nav)nav.classList.add('on');$('pageTitle').textContent=titles[p]||p;renderPage(p)}
function renderPage(p){const r={overview:renderOverview,agents:renderAgents,projects:renderProjects,tasks:renderTasks,activity:renderActivity,health:renderHealth,memory:renderMemory,monitor:renderMonitor,integrations:renderIntegrations,learning:renderLearning,editor:loadEdits,builds:loadBuilds,messaging:loadMsgs,apiexp:loadMcp,downloads:loadDl,chat:loadChat,docs:()=>{},approvals:renderApprovals};if(r[p])r[p]()}
document.querySelectorAll('.nav-i[data-p]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.p)}));
function toggleSb(){$('sidebar').classList.toggle('open');$('sbOverlay').classList.toggle('show');document.body.classList.toggle('sb-open')}
function closeSb(){$('sidebar').classList.remove('open');$('sbOverlay').classList.remove('show');document.body.classList.remove('sb-open')}

// ─── STATE ───
async function loadState(){
  try{const r=await api('/api/state');const d=r.data||r;
    S.projects=d.projects||[];S.tasks=d.tasks||[];S.artifacts=d.artifacts||[];S.agents=d.agents||[];S.events=d.events||[];S.approvals=(d.approvals||[]).filter(a=>a.state==='pending');S.tools=d.tools||[];
    updateStats();renderPage(curPage);
    if($('hText')){$('hDot').classList.remove('off');$('hText').textContent='System Online';}
  }catch(e){console.warn('State:',e.message)}
}
function updateStats(){
  $('sProj').textContent=S.projects.length;$('sTask').textContent=S.tasks.length;$('sAg').textContent=S.agents.length;$('sArt').textContent=S.artifacts.length;
  if($('navA'))$('navA').textContent=S.agents.length;if($('navP'))$('navP').textContent=S.projects.length;
  if($('navT'))$('navT').textContent=S.tasks.filter(t=>t.state==='working').length||S.tasks.length;
  if($('navAp'))$('navAp').textContent=S.approvals.length;
  if($('ovP'))$('ovP').textContent=S.projects.length;if($('ovC'))$('ovC').textContent=S.projects.filter(p=>p.state==='completed').length;
  if($('ovA'))$('ovA').textContent=S.projects.filter(p=>p.state==='active').length;if($('ovAg'))$('ovAg').textContent=S.agents.length;if($('ovArt'))$('ovArt').textContent=S.artifacts.length;
  if($('projCnt'))$('projCnt').textContent=S.projects.length+' projects';if($('taskCnt'))$('taskCnt').textContent=S.tasks.length+' tasks';
}

// ─── RENDERERS ───
function renderOverview(){
  const evts=S.events.slice(-15).reverse();let h='';
  for(const e of evts)h+='<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="width:6px;height:6px;border-radius:50%;background:'+actColor(e)+';margin-top:5px;flex-shrink:0"></div><div style="flex:1;font-size:12px"><b>'+esc(e.type||'event')+'</b></div><div style="font-size:10px;color:var(--text3)">'+fmt(e.at)+'</div></div>';
  $('ovAct').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No activity</div>';
  api('/api/health').then(r=>{const d=r.data||r;let h='';const row=(l,v)=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px;color:var(--text2)">'+l+'</span><span style="font-size:11px">'+v+'</span></div>';
    h+=row('Status','<span style="color:var(--green)">'+esc(d.status||'?')+'</span>');h+=row('D1',d.persistence?'<span style="color:var(--green)">Connected</span>':'<span style="color:var(--yellow)">Memory</span>');
    h+=row('AI',d.ai?'<span style="color:var(--green)">Available</span>':'<span style="color:var(--yellow)">N/A</span>');h+=row('Time',fmt(d.time));$('ovHealth').innerHTML=h}).catch(()=>{})
}
function renderAgents(){
  let h='';for(const a of S.agents){
    const sk=a.skills||a.capabilities||[];const pct=Math.min(100,((a.tasksCompleted||0)*10+50));
    h+='<div class="card" style="margin-bottom:0"><div style="display:flex;gap:10px;align-items:flex-start"><div style="width:36px;height:36px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'+(a.emoji||'🤖')+'</div><div style="flex:1"><div style="font-weight:600;font-size:13px">'+esc(a.name||a.id)+'</div><div style="font-size:10px;color:var(--text2)">'+esc(a.role||a.type||'Agent')+'</div><div style="margin-top:6px"><div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="font-size:10px;color:var(--text3)">Skill</span><span style="font-size:10px;color:var(--accent)">'+pct+'%</span></div><div class="pbar"><div class="pfill" style="width:'+pct+'%"></div></div></div><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">'+sk.map(s=>'<span class="badge badge-a">'+esc(s)+'</span>').join('')+'</div></div></div></div>';
  }
  $('agList').innerHTML=h||'<div style="text-align:center;padding:40px;color:var(--text2)">No agents</div>';
}
function renderProjects(){
  const search=($('projSearch')?.value||'').toLowerCase();const filter=$('projFilter')?.value||'';
  let list=S.projects;if(search)list=list.filter(p=>(p.name||p.objective||p.id||'').toLowerCase().includes(search));if(filter)list=list.filter(p=>p.state===filter);
  let h='<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Tasks</th><th>Actions</th></tr></thead><tbody>';
  for(const p of list){const hasCode=S.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
    h+='<tr><td><b>'+esc(p.name||p.objective||p.id)+'</b></td><td><span class="badge badge-'+badge(p.state)+'">'+esc(p.state)+'</span></td><td>'+(p.taskCount||'—')+'</td><td style="display:flex;gap:4px">';
    h+='<button class="btn btn-g btn-s dl-btn" data-pid="'+p.id+'">📥</button>';
    if(hasCode)h+='<button class="btn btn-a btn-s" onclick="window.open(\'/api/preview-app?projectId='+p.id+'\',\'_blank\')">👁️</button>';
    if(hasCode)h+='<button class="btn btn-g btn-s bld-btn" data-pid="'+p.id+'" data-plat="android">📱</button><button class="btn btn-a btn-s bld-btn" data-pid="'+p.id+'" data-plat="desktop">🖥️</button>';
    h+='</td></tr>';}
  h+='</tbody></table>';$('projList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>';
}
function filterProj(){renderProjects()}
function renderTasks(){
  let h='<table class="tbl"><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>Progress</th></tr></thead><tbody>';
  for(const t of S.tasks.slice(-50).reverse())h+='<tr><td>'+esc(t.title||t.id)+'</td><td><span class="badge badge-'+tBadge(t.state)+'">'+esc(t.state)+'</span></td><td style="font-size:11px;color:var(--text2)">'+esc(t.agentId||'—')+'</td><td><div class="pbar" style="width:80px"><div class="pfill'+(t.state==='completed'?' done':t.state==='failed'?' err':'')+'" style="width:'+pct(t.state)+'%"></div></div></td></tr>';
  h+='</tbody></table>';$('taskList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No tasks</div>';
}
function renderActivity(){
  let h='';for(const e of S.events.slice(-40).reverse()){
    const p=typeof e.payload==='object'?JSON.stringify(e.payload):String(e.payload||'');
    h+='<div style="display:flex;gap:8px;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="width:6px;height:6px;border-radius:50%;background:'+actColor(e)+';margin-top:5px;flex-shrink:0"></div><div style="flex:1"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(e.type||'event')+'</b><span style="font-size:10px;color:var(--text3)">'+fmt(e.at)+'</span></div><pre style="font-size:10px;color:var(--text2);white-space:pre-wrap;word-break:break-all;max-height:60px;overflow:hidden;font-family:monospace;margin-top:2px">'+esc(p)+'</pre></div></div>';
  }
  $('actList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No activity</div>';
}
function renderHealth(){
  api('/api/health').then(r=>{const d=r.data||r;const row=(l,v)=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px;color:var(--text2)">'+l+'</span><span style="font-size:11px">'+v+'</span></div>';
    let h=row('Service',d.service||'—')+row('Status','<span style="color:var(--green)">'+esc(d.status||'?')+'</span>')+row('D1',d.persistence?'<span style="color:var(--green)">Connected</span>':'<span style="color:var(--yellow)">Memory</span>')+row('AI',d.ai?'<span style="color:var(--green)">Yes</span>':'<span style="color:var(--yellow)">No</span>')+row('Time',fmt(d.time));
    $('hlthDet').innerHTML=h}).catch(e=>{$('hlthDet').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'});
  let h='';for(const t of S.tools)h+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:12px">🔧</span><div style="flex:1"><b style="font-size:12px">'+esc(t.name)+'</b><div style="font-size:10px;color:var(--text3)">'+esc(t.description||'')+'</div></div><span class="badge badge-'+(t.risk==='read'?'g':t.risk==='write'?'y':'r')+'">'+esc(t.risk)+'</span></div>';
  $('toolsOut').innerHTML=h||'<div style="text-align:center;padding:10px;color:var(--text2)">No tools</div>';
}
function renderMemory(){
  const evts=S.events.filter(e=>e.type&&(e.type.includes('task_result')||e.type.includes('solution')||e.type.includes('error')||e.type.includes('command'))).slice(-25).reverse();
  let h='';for(const e of evts){const p=typeof e.payload==='object'?JSON.stringify(e.payload):String(e.payload||'');
    h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><span class="badge badge-a">'+esc(e.type)+'</span><span style="font-size:10px;color:var(--text3)">'+fmt(e.at)+'</span></div><pre style="font-size:10px;color:var(--text2);white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden;font-family:monospace;margin-top:4px">'+esc(p)+'</pre></div>';
  }
  $('memList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No memory</div>';
}
function renderMonitor(){
  const grid=[{l:'Projects',v:S.projects.length,i:'📁',a:true},{l:'Tasks',v:S.tasks.length,i:'📋',a:S.tasks.some(t=>t.state==='working')},{l:'Agents',v:S.agents.length,i:'🤖',a:true},{l:'Working',v:S.tasks.filter(t=>t.state==='working').length,i:'⚡',a:S.tasks.some(t=>t.state==='working')},{l:'Completed',v:S.tasks.filter(t=>t.state==='completed').length,i:'✅',a:true},{l:'Failed',v:S.tasks.filter(t=>t.state==='failed').length,i:'❌',a:S.tasks.some(t=>t.state==='failed')},{l:'Events',v:S.events.length,i:'📡',a:S.events.length>0},{l:'Artifacts',v:S.artifacts.length,i:'📦',a:S.artifacts.length>0}];
  $('monGrid').innerHTML=grid.map(g=>'<div class="card stat" style="margin-bottom:0;'+(g.a?'border-color:var(--accent)':'')+'"><div class="stat-l">'+g.i+' '+g.l+'</div><div class="stat-v" style="font-size:22px">'+g.v+'</div></div>').join('');
  $('monAgents').innerHTML=S.agents.map(a=>'<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="width:6px;height:6px;border-radius:50%;background:var(--green);margin-top:4px"></div><div style="font-size:12px"><b>'+esc(a.name||a.id)+'</b> — '+esc(a.role||'Agent')+'</div></div>').join('')||'<div style="color:var(--text2);padding:10px">No agents</div>';
  $('monTasks').innerHTML=S.tasks.slice(-10).reverse().map(t=>'<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px">'+esc(t.title||t.id)+'</span><span class="badge badge-'+tBadge(t.state)+'">'+esc(t.state)+'</span></div><div class="pbar"><div class="pfill'+(t.state==='completed'?' done':'')+'" style="width:'+pct(t.state)+'%"></div></div></div>').join('')||'<div style="color:var(--text2);padding:10px">No tasks</div>';
}
function renderIntegrations(){
  const ints=[{n:'GitHub',i:'🐙',s:'Connected',d:'Source control'},{n:'Cloudflare Workers',i:'☁️',s:'Deployed',d:'Hosting'},{n:'Cloudflare AI',i:'🧠',s:'Active',d:'LLM'},{n:'D1 Database',i:'💾',s:'Connected',d:'SQL'},{n:'MCP Servers',i:'🔌',s:'Integrated',d:'Agent tools'},{n:'Ollama',i:'🤖',s:'Optional',d:'Local LLMs'}];
  $('intList').innerHTML=ints.map(i=>'<div class="card" style="margin-bottom:0"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:24px">'+i.i+'</span><div><b style="font-size:13px">'+esc(i.n)+'</b><div style="font-size:10px;color:var(--text2)">'+esc(i.d)+'</div></div><span class="badge badge-g" style="margin-left:auto">'+i.s+'</span></div></div>').join('');
}
function renderApprovals(){
  let h='';for(const a of S.approvals)h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:12px">'+esc(a.action||a.id)+'</b><div style="font-size:10px;color:var(--text2)">Risk: '+esc(a.risk||'unknown')+'</div></div><div style="display:flex;gap:4px"><button class="btn btn-g btn-s" onclick="decideAppr(\''+a.id+'\',true)">✅</button><button class="btn btn-r btn-s" onclick="decideAppr(\''+a.id+'\',false)">❌</button></div></div>';
  $('apprList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No pending approvals</div>';
}
async function decideAppr(id,ok){try{await api('/api/approvals/'+id,{method:'POST',body:JSON.stringify({approved:ok})});toast(ok?'Approved':'Rejected','ok');loadState()}catch(e){toast(e.message,'err')}}

// ─── COMMAND ───
async function sendCmd(){
  const cmd=$('cmdIn').value.trim();if(!cmd){toast('Enter a command','err');return}
  $('cmdBtn').disabled=true;$('cmdLoad').classList.add('show');$('cmdRes').style.display='none';
  try{const r=await api('/api/command',{method:'POST',body:JSON.stringify({command:cmd})});
    $('cmdRes').style.display='block';$('cmdRes').textContent=JSON.stringify(r.result||r,null,2);toast('Done!','ok');$('cmdIn').value='';await loadState()
  }catch(e){$('cmdRes').style.display='block';$('cmdRes').textContent='Error: '+e.message;toast('Failed','err')}
  finally{$('cmdBtn').disabled=false;$('cmdLoad').classList.remove('show')}
}
function qCmd(c){$('cmdIn').value=c;sendCmd()}

// ─── CHAT ───
function loadChat(){const c=$('chatMsgs');if(!c||c.children.length>1)return;const h=new Date().getHours();const g=h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  c.innerHTML='<div class="chat-msg bot"><div class="mr">MAULI</div><div>'+md(g+'! 👋 I am **MAULI 2.0**. Ask me anything or tell me what to build!')+'</div></div>';
  addQuickReplies(['Build a web app','Chat about tech','Show projects','What can you do?'])}
async function sendChat(){
  const inp=$('chatIn');const msg=inp.value.trim();if(!msg)return;const c=$('chatMsgs');
  c.innerHTML+='<div class="chat-msg user"><div class="mr">You</div>'+esc(msg)+'</div>';inp.value='';c.scrollTop=c.scrollHeight;
  addTyping();
  try{const r=await api('/api/chat',{method:'POST',body:JSON.stringify({message:msg})});rmTyping();
    const d=r.data||r;const resp=d.result||d;const txt=resp.reply||resp.message||(resp.response&&resp.response.text)||JSON.stringify(r,null,2);
    c.innerHTML+='<div class="chat-msg bot"><div class="mr">MAULI</div><div>'+md(txt)+'</div></div>';
    const qr=(resp.response&&resp.response.quickReplies)||resp.quickReplies;if(qr)addQuickReplies(qr);c.scrollTop=c.scrollHeight
  }catch(e){rmTyping();c.innerHTML+='<div class="chat-msg bot" style="border-color:var(--red)"><div class="mr">Error</div>'+esc(e.message)+'</div>';c.scrollTop=c.scrollHeight}
}
function addQuickReplies(arr){if(!arr?.length)return;const c=$('chatMsgs');const w=document.createElement('div');w.style.cssText='display:flex;flex-wrap:wrap;gap:4px;padding:4px 0 6px 40px';arr.forEach(r=>{const b=document.createElement('button');b.className='btn btn-a btn-s';b.style.cssText='font-size:10px;padding:3px 8px;border-radius:10px';b.textContent=r;b.onclick=()=>{$('chatIn').value=r;sendChat()};w.appendChild(b)});c.appendChild(w);c.scrollTop=c.scrollHeight}
function addTyping(){const c=$('chatMsgs');const d=document.createElement('div');d.className='chat-msg bot';d.id='typing';d.innerHTML='<div class="mr">MAULI</div><div style="display:flex;gap:3px;padding:4px 0"><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite"></span><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite .2s"></span><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite .4s"></span></div>';c.appendChild(d);c.scrollTop=c.scrollHeight}
function rmTyping(){const e=$('typing');if(e)e.remove()}

// ─── SELF TEST / DIAG ───
async function runTest(){try{const r=await api('/api/self-test');const d=r.result||r;let h='<span class="badge badge-'+(d.status==='ready'?'g':d.status==='degraded'?'y':'r')+'">'+d.status.toUpperCase()+' — '+d.score+'%</span>';
  for(const c of(d.checks||[]))h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="color:'+(c.passed?'var(--green)':'var(--red)')+'">'+(c.passed?'✅':'❌')+'</span><span style="font-size:12px">'+esc(c.name)+'</span><span style="font-size:10px;color:var(--text3);margin-left:auto">'+esc(c.details||'')+'</span></div>';
  $('testRes').innerHTML=h;toast('Test: '+d.status,d.status==='ready'?'ok':'info')}catch(e){$('testRes').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}
async function runDiag(){try{const r=await api('/api/result-diagnostic');const d=r.result||r;const row=(l,v)=>'<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px;color:var(--text2)">'+l+'</span><span style="font-size:11px">'+v+'</span></div>';
  let h=row('Token',d.tokenConfigured?'<span style="color:var(--green)">Yes</span>':'<span style="color:var(--red)">No</span>');h+=row('Status',d.ok?'<span style="color:var(--green)">OK</span>':'<span style="color:var(--red)">Issue</span>');
  $('diagOut').innerHTML=h;toast('Done','ok')}catch(e){$('diagOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}

// ─── DOCS ───
async function genDocs(){toast('Generating...','info');try{const r=await api('/api/docs/generate',{method:'POST',body:JSON.stringify({})});$('docsOut').innerHTML='<pre style="font-size:11px;white-space:pre-wrap;font-family:monospace;background:var(--bg1);padding:12px;border-radius:8px;max-height:500px;overflow:auto">'+esc(JSON.stringify(r.docs||r,null,2))+'</pre>';toast('Done','ok')}catch(e){$('docsOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}

// ─── EDITOR ───
async function loadEdits(){try{const r=await api('/api/edits/recent');const edits=r.edits||r||[];let h='';for(const e of(Array.isArray(edits)?edits:[]))h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(e.filePath||e.file||'—')+'</b><span class="badge badge-a">'+esc(e.operation||'edit')+'</span></div><div style="font-size:10px;color:var(--text3)">'+fmt(e.at||e.timestamp)+'</div></div>';
  $('edList').innerHTML=h||'<div style="color:var(--text2);padding:10px">No edits</div>'}catch(e){$('edList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}
async function loadProjFiles(id){if(!id)return;try{const r=await api('/api/state');const d=r.data||r;const arts=(d.artifacts||[]).filter(a=>a.projectId===id&&a.type==='code-workspace');if(arts[0])$('edFile').value=arts[0].path||'www/index.html'}catch(e){}}
async function loadFile(){const p=$('edFile').value.trim();if(!p){toast('Enter path','err');return}try{const r=await api('/api/edits?filePath='+encodeURIComponent(p));$('edContent').value=r.content||r.code||JSON.stringify(r,null,2);toast('Loaded','ok')}catch(e){toast(e.message,'err')}}
async function saveFile(){const p=$('edFile').value.trim();const c=$('edContent').value;if(!p){toast('Enter path','err');return}try{await api('/api/edits',{method:'POST',body:JSON.stringify({filePath:p,content:c,operation:'update'})});toast('Saved','ok');loadEdits()}catch(e){toast(e.message,'err')}}

// ─── LEARNING ───
async function renderLearning(){try{const r=await api('/api/learning/stats');const s=r.stats||r||{};$('lT').textContent=s.tasksLearned||0;$('lP').textContent=s.patternsFound||0;$('lS').textContent=s.skillsTracked||0;let h='';for(const[k,v] of Object.entries(s.categoryStats||s.categories||s))if(typeof v==='object'&&v!==null)h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(k)+'</b><span class="badge badge-a">'+(v.count||0)+'</span></div>';
  $('learnOut').innerHTML=h||'<div style="color:var(--text2)">No data</div>'}catch(e){$('learnOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}
  try{const r=await api('/api/learning/skill-tree');const t=r.skillTree||r||{};let h='';for(const[ag,sk] of Object.entries(t)){h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><b style="font-size:12px">🤖 '+esc(ag)+'</b>';for(const[s,l] of Object.entries(sk||{})){const p=Math.min(100,typeof l==='number'?l:l?.level||0);h+='<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="font-size:10px;color:var(--text2);min-width:80px">'+esc(s)+'</span><div class="pbar" style="flex:1"><div class="pfill" style="width:'+p+'%"></div></div><span style="font-size:9px;color:var(--accent)">'+p+'%</span></div>'}h+='</div>'}
  $('skillOut').innerHTML=h||'<div style="color:var(--text2)">No skills</div>'}catch(e){$('skillOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}

// ─── BUILDS ───
async function loadBuilds(){let h='';for(const p of S.projects){const hasCode=S.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
  h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:12px">'+esc(p.name||p.objective||p.id)+'</b><div style="font-size:10px;color:var(--text2)">'+esc(p.state)+'</div></div><div style="display:flex;gap:4px">';
  if(hasCode)h+='<button class="btn btn-g btn-s bld-btn" data-pid="'+p.id+'" data-plat="android">📱 APK</button><button class="btn btn-a btn-s bld-btn" data-pid="'+p.id+'" data-plat="desktop">🖥️ EXE</button>';
  else h+='<span class="badge badge-y">No code</span>';
  h+='</div></div>'}
  $('buildOut').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>'}

// ─── MESSAGING ───
async function loadMsgs(){try{const r=await api('/api/messages');const msgs=r.messages||r||[];let h='';for(const m of(Array.isArray(msgs)?msgs:[]).slice(-20).reverse()){const c=m.type==='alert'?'r':m.type==='review'?'y':'a';
  h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(m.from||'—')+' → '+esc(m.to||'—')+'</b><span class="badge badge-'+c+'">'+esc(m.type||'info')+'</span></div><div style="font-size:11px;margin-top:2px">'+esc(m.content||m.message||'')+'</div></div>'}
  $('msgList').innerHTML=h||'<div style="color:var(--text2);padding:10px">No messages</div>';
  const opts=S.agents.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name||a.id)+'</option>').join('');
  if($('msgFrom'))$('msgFrom').innerHTML='<option value="">From...</option>'+opts;if($('msgTo'))$('msgTo').innerHTML='<option value="">To...</option>'+opts;
  }catch(e){$('msgList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}
async function sendMsg(){const f=$('msgFrom').value,t=$('msgTo').value,b=$('msgBody').value.trim();if(!f||!t||!b){toast('Fill all','err');return}try{await api('/api/messages/send',{method:'POST',body:JSON.stringify({from:f,to:t,content:b,type:'info'})});toast('Sent','ok');$('msgBody').value='';loadMsgs()}catch(e){toast(e.message,'err')}}
async function bcastMsg(){const b=$('msgBody').value.trim();if(!b){toast('Enter message','err');return}try{await api('/api/messages/broadcast',{method:'POST',body:JSON.stringify({content:b,type:'alert'})});toast('Sent','ok');$('msgBody').value='';loadMsgs()}catch(e){toast(e.message,'err')}}

// ─── API EXPLORER ───
async function searchApi(){const q=$('apiQ').value.trim();if(!q){toast('Enter query','err');return}try{const r=await api('/api/apis/search?q='+encodeURIComponent(q));const apis=r.apis||r.results||r||[];let h='';for(const a of(Array.isArray(apis)?apis:[]))h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(a.name||a.title||'—')+'</b><span class="badge badge-g">'+esc(a.category||'API')+'</span></div><div style="font-size:10px;color:var(--text2)">'+esc(a.description||'')+'</div>'+(a.url?'<a href="'+esc(a.url)+'" target="_blank" style="font-size:10px">🔗 Docs</a>':'')+'</div>';
  $('apiRes').innerHTML=h||'<div style="color:var(--text2)">No results</div>'}catch(e){$('apiRes').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}
async function loadMcp(){try{const r=await api('/api/mcp/servers');const srv=r.servers||r||[];let h='';for(const s of(Array.isArray(srv)?srv:[]))h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">🔌 '+esc(s.name||s.id||'—')+'</b><span class="badge badge-a">'+esc(s.category||'MCP')+'</span></div><div style="font-size:10px;color:var(--text2)">'+esc(s.description||'')+'</div></div>';
  $('mcpOut').innerHTML=h||'<div style="color:var(--text2)">No servers</div>'}catch(e){$('mcpOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}

// ─── DOWNLOADS ───
function loadDl(){let h='';for(const p of S.projects){const hasCode=S.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
  h+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;align-items:center;justify-content:space-between"><div style="flex:1"><b style="font-size:13px">'+esc(p.name||p.objective||p.id)+'</b><div style="font-size:10px;color:var(--text2);margin-top:2px"><span class="badge badge-'+badge(p.state)+'">'+esc(p.state)+'</span>'+(p.taskCount?' '+p.taskCount+' tasks':'')+'</div></div>';
  if(hasCode)h+='<button class="btn btn-g btn-s dl-btn" data-pid="'+p.id+'">📥 Download</button>';
  else h+='<span style="font-size:10px;color:var(--text3)">No code</span>';
  h+='</div>'}
  $('dlList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>'}
async function downloadZip(pid){try{toast('Loading...','info');const r=await fetch('/api/app-files?projectId='+encodeURIComponent(pid));if(!r.ok){toast('No files','err');return}const d=await r.json();const files=d.files||[];if(!files.length){toast('No files','err');return}
  if(files.length===1){const f=files[0];const b=new Blob([f.content],{type:'text/plain'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=f.path.split('/').pop()||'index.html';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),3000);toast('Done','ok');return}
  for(const f of files){const b=new Blob([f.content],{type:'text/plain'});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=f.path.split('/').pop()||'file.txt';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}toast('Downloaded '+files.length+' files','ok')
  }catch(e){toast(e.message,'err')}}
async function startBuild(pid,plat,btn){const k=pid+'_'+plat;btn.disabled=true;btn.textContent='...';
  try{const r=await api('/api/build-app',{method:'POST',body:JSON.stringify({projectId:pid,platform:plat})});toast('Build started','ok');btn.textContent='Building...';
    let att=0;const poll=async()=>{att++;try{const s=await api('/api/build-status/'+r.buildId);
      if(s.downloadUrl){btn.textContent='DL';btn.disabled=false;btn.onclick=()=>window.open(s.downloadUrl,'_blank');toast('Ready!','ok');return}
      if(s.status==='failure'||s.status==='error'){btn.textContent='Fail';btn.disabled=false;toast('Failed','err');return}
      if(att<60)setTimeout(poll,10000);else{btn.textContent='Check GH';btn.disabled=false}
    }catch(e){if(att<60)setTimeout(poll,10000)}};setTimeout(poll,5000);
  }catch(e){btn.textContent=plat==='android'?'📱':'🖥️';btn.disabled=false;toast(e.message,'err')}}

// ─── RESET ───
async function resetAll(){if(!confirm('Delete ALL data?'))return;if(!confirm('Final confirm - this cannot be undone!'))return;
  try{toast('Resetting...','info');const r=await api('/api/reset',{method:'POST',headers:{'Content-Type':'application/json'}});if(r.ok){toast('Done! Reloading...','ok');setTimeout(()=>location.reload(),1000)}else toast('Failed','err')}catch(e){toast(e.message,'err')}}

// ─── DELEGATED CLICKS ───
document.addEventListener('click',e=>{const dl=e.target.closest('.dl-btn');if(dl)downloadZip(dl.dataset.pid);const bl=e.target.closest('.bld-btn');if(bl)startBuild(bl.dataset.pid,bl.dataset.plat,bl)});

// ─── CLOCK ───
function updateClock(){$('clock').textContent=new Date().toLocaleTimeString()}
setInterval(updateClock,1000);updateClock();

// ─── HEARTBEAT ───
async function heartbeat(){
  try{const ctrl=new AbortController();const t=setTimeout(()=>ctrl.abort(),5000);
    const r=await fetch('/api/heartbeat',{cache:'no-store',signal:ctrl.signal});clearTimeout(t);
    const j=await r.json();
    if(j.ok||j.data){$('hDot').classList.remove('off');if($('hText'))$('hText').textContent='System Online';
    }else{if($('hText'))$('hText').textContent='Offline'}
  }catch(e){console.warn('Heartbeat failed:',e.message);if($('hText'))$('hText').textContent='Connecting...'}
}

// Immediately set status to Online — heartbeat confirms it
if($('hText'))$('hText').textContent='System Online';
if($('hDot'))$('hDot').classList.remove('off');

// Fire-and-forget API calls
fetch('/api/heartbeat',{cache:'no-store'}).then(r=>r.json()).then(j=>{
  if(j.ok||j.data){if($('hText'))$('hText').textContent='System Online';if($('hDot'))$('hDot').classList.remove('off')}
}).catch(()=>{});

fetch('/api/state').then(r=>r.json()).then(d=>{
  const dd=d.data||d;
  S.projects=dd.projects||[];S.tasks=dd.tasks||[];S.artifacts=dd.artifacts||[];S.agents=dd.agents||[];S.events=dd.events||[];
  S.approvals=(dd.approvals||[]).filter(a=>a.state==='pending');S.tools=dd.tools||[];
  updateStats();
  if($('hText'))$('hText').textContent='System Online';
  if($('hDot'))$('hDot').classList.remove('off');
}).catch(()=>{});

setInterval(()=>{
  fetch('/api/heartbeat',{cache:'no-store'}).then(r=>r.json()).then(j=>{
    if(j.ok||j.data){if($('hText'))$('hText').textContent='System Online';if($('hDot'))$('hDot').classList.remove('off')}
  }).catch(()=>{});
  fetch('/api/state').then(r=>r.json()).then(d=>{
    const dd=d.data||d;
    S.projects=dd.projects||[];S.tasks=dd.tasks||[];S.artifacts=dd.artifacts||[];S.agents=dd.agents||[];S.events=dd.events||[];
    S.approvals=(dd.approvals||[]).filter(a=>a.state==='pending');S.tools=dd.tools||[];
    updateStats();
  }).catch(()=>{});
},10000);

// Clock
setInterval(()=>{if($('clock'))$('clock').textContent=new Date().toLocaleTimeString()},1000);
if($('clock'))$('clock').textContent=new Date().toLocaleTimeString();
</script>
</body>
</html>`;
}
