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

/* Founder key control — every protected panel (Chat, Learning, Messaging, API Explorer,
   Docs, File Editor, Integrations, Builds) answers 401 without this key. It used to be
   reachable only through a window.prompt() that the founder can dismiss without noticing,
   so those panels silently rendered as empty and read as "the options are missing". */
.mauli-keybar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;margin-bottom:14px;border:1px solid rgba(234,179,8,.45);background:rgba(234,179,8,.1);border-radius:var(--r);font-size:12px;color:var(--yellow)}
.mauli-keybar[hidden]{display:none}
.mauli-keybar button{margin-top:0}
.mauli-keymodal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(4,7,15,.82);backdrop-filter:blur(4px)}
.mauli-keymodal[hidden]{display:none}
.mauli-keycard{width:100%;max-width:440px;background:var(--bg2);border:1px solid var(--border2);border-radius:14px;padding:20px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
.mauli-keycard h3{margin:0 0 6px;font-size:15px}
.mauli-keycard p{margin:0 0 12px;font-size:11px;color:var(--text2);line-height:1.5}
.mauli-keyremember{display:flex;align-items:center;gap:7px;margin-top:10px;font-size:11px;color:var(--text2);font-weight:400}
.mauli-keyremember input{width:auto;margin:0}
.mauli-keyrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.mauli-keyrow button{flex:1 1 110px;margin-top:0}
.mauli-keymsg{min-height:1.2em;margin-top:10px;font-size:11px;color:var(--text2)}
.mauli-keymsg.err{color:var(--red)}
.mauli-keymsg.ok{color:var(--green)}
.key-btn-off{color:var(--yellow)!important;border-color:rgba(234,179,8,.5)!important}

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
      <div class="nav-i" data-p="usage"><span>📊</span>Limits & Usage</div>
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
        <span style="font-size:11px;color:var(--text3)" id="groqChip" title="Groq fallback provider status, read from /api/health">➖</span>
        <span style="font-size:13px;font-weight:600;margin-left:8px" id="pageTitle">Command Center</span>
      </div>
      <div class="topbar-r">
        <button class="btn btn-a btn-s" id="mauliKeyBtn" onclick="openFounderKey()" title="Founder key — required by Chat, Learning, Messaging, API Explorer, Docs, Editor and Builds">🔑 <span id="mauliKeyState">locked</span></button>
        <button class="btn btn-a btn-s" onclick="go('chat')" title="Chat">💬</button>
        <span style="font-size:11px;color:var(--text3)" id="clock"></span>
      </div>
    </header>
    <div class="content">
      <div class="mauli-keybar" id="mauliKeyBar" hidden>
        <span>🔒 <b>Founder key लागत आहे.</b> Chat, Learning, Messaging, API Explorer, Docs, File Editor, Integrations आणि Builds — ही panels रिकामी दिसतात कारण तीं founder-protected endpoints वरून 401 मिळतात.</span>
        <button class="btn btn-p btn-s" onclick="openFounderKey()">🔑 Key भरा</button>
      </div>
      <!-- COMMAND CENTER -->
      <div class="page on" id="pg-command">
        <div class="g g4" style="margin-bottom:16px">
          <div class="card stat"><div class="stat-i">📁</div><div class="stat-v" id="sProj">0</div><div class="stat-l">Projects</div></div>
          <div class="card stat"><div class="stat-i">📋</div><div class="stat-v" id="sTask">0</div><div class="stat-l">Tasks</div></div>
          <div class="card stat"><div class="stat-i">🤖</div><div class="stat-v" id="sAg">0</div><div class="stat-l">Agents</div></div>
          <div class="card stat"><div class="stat-i">📦</div><div class="stat-v" id="sArt">0</div><div class="stat-l">Artifacts</div></div>
        </div>
        <div class="card">
          <div class="card-h"><div class="card-t">⚡ Founder Command</div><div class="card-s">Pick the platform, then tell MAULI what to build</div></div>
          <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px">Build for</div>
          <div id="platSel" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
          <textarea class="inp" id="cmdIn" placeholder="Example: Build a weather app with live forecasts..." rows="3"></textarea>
          <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
            <button class="btn btn-p" id="cmdBtn" onclick="sendCmd()">⚡ Execute</button>
            <span id="cmdPlatHint" style="font-size:10px;color:var(--text2)"></span>
            <div class="loading" id="cmdLoad"><div class="spinner"></div></div>
          </div>
          <div id="cmdOutcome" style="display:none;margin-top:12px"></div>
          <details class="card" id="cmdRawWrap" style="display:none;margin-top:10px"><summary style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px;cursor:pointer;user-select:none">Raw API response</summary><pre id="cmdRes" style="font-size:11px;max-height:260px;overflow:auto;font-family:monospace;background:var(--bg1);margin-top:8px;border-radius:var(--rs)"></pre></details>
        </div>
        <div class="card">
          <div class="card-h"><div class="card-t">🚀 Quick Actions</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-a btn-s" onclick="qCmd('Build a weather app with live forecasts')">🌤️ Weather</button>
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
        <div class="card"><div class="card-h"><div class="card-t">🔍 Diagnostics</div><button class="btn btn-a btn-s" onclick="renderDiagnostics()">▶ Run</button></div><div id="diagOut"></div></div>
      </div>
      <!-- MEMORY -->
      <div class="page" id="pg-memory"><div class="card"><div class="card-h"><div class="card-t">🧠 Memory</div></div><div id="memList" style="max-height:500px;overflow-y:auto"></div></div></div>
      <!-- INTEGRATIONS -->
      <div class="page" id="pg-integrations">
        <div class="card"><div class="card-h"><div class="card-t">🔗 Integrations</div><button class="btn btn-a btn-s" onclick="refreshPage()">↻ Refresh</button></div><div id="intSummary" style="font-size:11px;color:var(--text2);margin-bottom:8px"></div><div class="g g3" id="intList"></div></div>
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
        <div class="card"><div class="card-h"><div class="card-t">🌐 API Explorer</div><button class="btn btn-a btn-s" onclick="refreshPage()">↻</button></div>
          <div style="display:flex;gap:6px;margin-bottom:10px"><input class="inp" id="apiQ" placeholder="Search weather, maps, email..." style="flex:1" onkeydown="if(event.key==='Enter')searchApiCatalog()"><button class="btn btn-p" onclick="searchApiCatalog()">🔍 Search</button></div>
          <div id="apiRes" style="max-height:420px;overflow-y:auto"><div style="color:var(--text2);padding:10px">Loading API catalog...</div></div>
        </div>
        <div class="card"><div class="card-h"><div class="card-t">🔌 MCP Servers</div></div><div style="font-size:10px;color:var(--text2);padding:2px 0 8px">MCP = Model Context Protocol — agents ला callable tools (files, databases, browser) देण्याचा standard मार्ग. खाली MAULI जे MCP servers वापरू शकते ते आहेत.</div><div id="mcpOut" style="max-height:300px;overflow-y:auto"></div></div>
      </div>
      <!-- USAGE / LIMITS -->
      <div class="page" id="pg-usage">
        <div class="g g3" style="margin-bottom:16px">
          <div class="card stat"><div class="stat-i">💾</div><div class="stat-v" id="uDb">—</div><div class="stat-l">D1 Storage</div></div>
          <div class="card stat"><div class="stat-i">⚡</div><div class="stat-v" id="uReq">—</div><div class="stat-l">Workers Requests</div></div>
          <div class="card stat"><div class="stat-i">⏱️</div><div class="stat-v" id="uCpu">10ms</div><div class="stat-l">CPU Limit</div></div>
        </div>
        <div class="g g2">
          <div class="card">
            <div class="card-h"><div class="card-t">💾 D1 Database Storage</div><button class="btn btn-a btn-s" onclick="loadUsage()">↻</button></div>
            <div id="uD1Bar" style="margin-bottom:12px"></div>
            <div id="uD1Detail"></div>
          </div>
          <div class="card">
            <div class="card-h"><div class="card-t">⚡ Workers Limits (Free Tier)</div></div>
            <div id="uWorkers"></div>
          </div>
        </div>
        <div class="g g2">
          <div class="card">
            <div class="card-h"><div class="card-t">🔑 KV Storage Limits</div></div>
            <div id="uKv"></div>
          </div>
          <div class="card">
            <div class="card-h"><div class="card-t">🧹 Storage Cleanup</div><button class="btn btn-r btn-s" onclick="runCleanup()">🧹 Clean</button></div>
            <div id="uCleanup"><div style="font-size:11px;color:var(--text2)">Click Clean to remove old events, results, builds, and verifications.</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><div class="card-t">📋 Storage Breakdown by Type</div></div>
          <div id="uBreakdown"></div>
        </div>
        <div class="card">
          <div class="card-h"><div class="card-t">🌐 Cloudflare API Status</div><span id="cfStatus"><span class="badge badge-y">Loading...</span></span></div>
          <div id="cfD1"></div>
          <div id="cfWorkers"></div>
          <div id="cfKv"></div>
          <div style="padding:8px 0"><div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px">🚨 Alerts</div><div id="cfAlerts"></div></div>
          <div style="padding:4px 0 8px"><button class="btn btn-a btn-s" onclick="loadCFData()">🔄 Refresh Cloudflare Data</button></div>
        </div>
      </div>
      <!-- DOWNLOADS -->
      <div class="page" id="pg-downloads"><div class="card"><div class="card-h"><div class="card-t">📥 Downloads</div><button class="btn btn-g btn-s" onclick="loadDl()">↻</button></div><div id="dlList"></div></div></div>
    </div>
  </div>
</div>
<div class="mauli-keymodal" id="mauliKeyModal" hidden>
  <div class="mauli-keycard">
    <h3>🔑 MAULI founder key</h3>
    <p>Cloudflare dashboard → या Worker चे <b>Settings → Variables and Secrets</b> → <b>MAULI_FOUNDER_KEY</b>. Key browser मध्येच राहते, server ला फक्त header म्हणून जाते.</p>
    <input class="inp" id="mauliKeyInput" type="password" placeholder="Paste MAULI_FOUNDER_KEY" autocomplete="off">
    <label class="mauli-keyremember"><input type="checkbox" id="mauliKeyRemember"> या device वर लक्षात ठेवा (browser बंद केल्यावर पण राहते)</label>
    <div class="mauli-keyrow">
      <button class="btn btn-p" id="mauliKeySave">Save &amp; continue</button>
      <button class="btn" id="mauliKeyCancel">Cancel</button>
      <button class="btn btn-r" id="mauliKeyClear">Clear key</button>
    </div>
    <div class="mauli-keymsg" id="mauliKeyMsg"></div>
  </div>
</div>
<div class="toast-c" id="toastC"></div>

<script>
const S={projects:[],tasks:[],artifacts:[],agents:[],events:[],approvals:[],tools:[]};
const $=id=>document.getElementById(id);
let curPage='command';

// ─── HELPERS ───
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function dedupeDashboardAgents(agents){
  const byName=new Map();
  for(const agent of(Array.isArray(agents)?agents:[])){
    if(!agent||typeof agent!=='object')continue;
    const key=String(agent.name??'').trim().toLowerCase()||('id:'+String(agent.id??''));
    const current=byName.get(key);
    if(!current){byName.set(key,agent);continue;}
    const score=a=>{const m=a.metadata??{};return Object.keys(m.learning??{}).length*10+Object.keys(m.skillTree??{}).length*2+Number(m.successRate??0)*5+(a.updatedAt?Date.parse(a.updatedAt)||0:0)/1e12;};
    if(score(agent)>score(current))byName.set(key,agent);
  }
  return [...byName.values()].sort((a,b)=>String(a.name??a.id??'').localeCompare(String(b.name??b.id??'')));
}
function applyDashboardState(d){
  const state=d&&typeof d==='object'?d:{};
  // Degraded only means the row LISTS could not be read this time. The true counters
  // (summary.totals) are computed from a separate, cached D1 COUNT and are still valid, so
  // apply them even on a degraded payload — otherwise the numbers froze at their last value
  // and the dashboard gave no sign the system was doing anything.
  if(state.summary&&typeof state.summary==='object')S.summary=state.summary;
  // A cold Worker isolate can answer /api/state before it can read D1. Applying its empty
  // lists would wipe good rows and flash the dashboard back to zeros, so keep whatever is
  // already rendered and let the next poll fill it in.
  if(state.degraded)return false;
  S.projects=Array.isArray(state.projects)?state.projects:[];
  S.tasks=Array.isArray(state.tasks)?state.tasks:[];
  S.artifacts=Array.isArray(state.artifacts)?state.artifacts:[];
  S.agents=dedupeDashboardAgents(state.agents);
  S.events=Array.isArray(state.events)?state.events:[];
  S.approvals=Array.isArray(state.approvals)?state.approvals.filter(a=>a.state==='pending'):[];
  S.tools=Array.isArray(state.tools)?state.tools:[];
  return true;
}
window.__mauliDedupeAgents=dedupeDashboardAgents;
window.__applyDashboardState=applyDashboardState;
function badge(s){return s==='completed'?'g':s==='active'?'b':s==='planning'?'a':s==='escalated'?'r':'y'}
function tBadge(s){return s==='completed'?'g':s==='working'?'a':s==='failed'||s==='blocked'?'r':s==='verifying'?'b':'y'}
function pct(s){return s==='completed'?'100':s==='working'?'60':s==='failed'?'100':'20'}
function fmt(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch(e){return String(d)}}
function toast(m,t='info'){const e=document.createElement('div');e.className='toast '+t;e.textContent=m;$('toastC').appendChild(e);setTimeout(()=>e.remove(),3500)}
function md(s){if(!s)return'';let t=esc(s);t=t.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');t=t.replace(/\\*(.+?)\\*/g,'<em>$1</em>');t=t.replace(/^### (.+)$/gm,'<b style="color:var(--accent)">$1</b>');t=t.replace(/^## (.+)$/gm,'<b>$1</b>');t=t.replace(/^# (.+)$/gm,'<b style="font-size:14px">$1</b>');t=t.replace(/^• (.+)$/gm,'<div style="padding-left:10px">• $1</div>');t=t.replace(/\\n/g,'<br>');return t}
function actColor(ev){return ev.type?.includes('error')?'var(--red)':ev.type?.includes('task_result')?'var(--green)':ev.type?.includes('command')?'var(--accent)':'var(--blue)'}
// A background poll re-renders the current page every few seconds. Rewriting a container's
// innerHTML with IDENTICAL markup still tears the DOM down and rebuilds it, which is what makes
// the view blink and an inner scroller jump even when nothing changed. Write only when the markup
// really changed, and show a "Loading…" placeholder only before the first paint.
function setHtml(el,html){if(!el)return;const s=String(html);if(el.__mauliHtml===s)return;el.__mauliHtml=s;el.innerHTML=s}
function showPlaceholderOnce(el,html){if(!el||el.__mauliHtml!=null)return;const s=String(html);el.__mauliHtml=s;el.innerHTML=s}
function renderApiRows(apis){
  const list=Array.isArray(apis)?apis:[];
  if(!list.length){setHtml($('apiRes'),'<div style="color:var(--text2);padding:10px">No matching APIs</div>');return;}
  let h='<div style="font-size:10px;color:var(--text3);padding:4px 0 8px">'+list.length+' API'+(list.length===1?'':'s')+' available</div>';
  for(const a of list){const category=a.category||'API';const auth=a.auth||a.authentication||'Not specified';const free=a.free===false?'Paid':'Free tier';
    h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:12px">'+esc(a.name||a.title||'—')+'</b><span class="badge badge-g">'+esc(category)+'</span></div><div style="display:flex;gap:6px;align-items:center;margin-top:5px"><span class="badge badge-a">'+esc(free)+'</span><span style="font-size:10px;color:var(--text2)">Auth: '+esc(auth)+'</span>'+(a.url?'<a href="'+esc(a.url)+'" target="_blank" rel="noopener" style="font-size:10px;margin-left:auto">Open API ↗</a>':'')+'</div></div>';
  }
  setHtml($('apiRes'),h);
}
async function loadApiExplorer(){
  if(!$('apiRes'))return;
  showPlaceholderOnce($('apiRes'),'<div style="color:var(--text2);padding:10px">Loading API catalog...</div>');
  try{const r=await api('/api/apis/catalog');const catalog=r.catalog||{};const apis=[];
    for(const[group,items]of Object.entries(catalog))for(const item of(Array.isArray(items)?items:[]))apis.push({...item,category:item.category||group});
    renderApiRows(apis);
  }catch(e){setHtml($('apiRes'),'<div style="color:var(--red)">'+esc(e.message)+'</div>')}
  // Awaited so the page's render promise covers the MCP list too — otherwise a refresh would
  // restore the scroll before MCP had re-rendered and the card would still jump to the top.
  await loadMcp();
}
async function searchApiCatalog(){const q=$('apiQ').value.trim();if(!q){await loadApiExplorer();return}showPlaceholderOnce($('apiRes'),'<div style="color:var(--text2);padding:10px">Searching...</div>');try{const r=await api('/api/apis/search?q='+encodeURIComponent(q));renderApiRows(r.apis||r.results||[])}catch(e){setHtml($('apiRes'),'<div style="color:var(--red)">'+esc(e.message)+'</div>')}}

// ─── API ───
// ─── FOUNDER KEY ───
// Founder-protected endpoints require the MAULI_FOUNDER_KEY. It is kept in
// sessionStorage (never localStorage/cookie) and attached to every API call.
const FOUNDER_KEY_STORAGE='mauli_founder_key';
const FOUNDER_KEY_REMEMBER='mauli_founder_key_remember';
function founderKey(){try{return sessionStorage.getItem(FOUNDER_KEY_STORAGE)||localStorage.getItem(FOUNDER_KEY_STORAGE)||''}catch(_){return ''}}
function clearFounderKey(){
  try{sessionStorage.removeItem(FOUNDER_KEY_STORAGE);localStorage.removeItem(FOUNDER_KEY_STORAGE)}catch(_){}
  // Repaint here, not only in the button handler: window.__mauliClearFounderKey is a public
  // entry point, and clearing the key without restoring the banner left the UI still
  // claiming "key set" while every protected request was being refused.
  try{paintFounderKeyState()}catch(_){}
}
function setFounderKey(k,remember){
  try{
    if(!k){clearFounderKey();return}
    (remember?localStorage:sessionStorage).setItem(FOUNDER_KEY_STORAGE,k);
    // Exactly one copy survives, so "Clear" can never leave a stale key behind.
    (remember?sessionStorage:localStorage).removeItem(FOUNDER_KEY_STORAGE);
    localStorage.setItem(FOUNDER_KEY_REMEMBER,remember?'1':'0');
  }catch(_){}
}
function founderHeaders(h){const k=founderKey();return k?{...h,'x-mauli-founder':k}:h}
function founderAuthNeeded(r){return r&&(r.status===401||r.status===503)}

// The one place that decides whether the founder is signed in, and the only place that
// draws the consequence. Without it a refused request looked identical to an empty
// collection: Chat answered with a raw JSON envelope and every other panel rendered its
// "No items" state, so a missing key read as missing features.
let founderKeyPrompt=null;
function paintFounderKeyState(){
  const on=!!founderKey();
  const btn=$('mauliKeyBtn');const label=$('mauliKeyState');const bar=$('mauliKeyBar');
  if(label)label.textContent=on?'key set':'locked';
  if(btn)btn.classList.toggle('key-btn-off',!on);
  if(bar)bar.hidden=on;
  return on;
}
function showFounderKeyModal(){
  if(founderKeyPrompt)return founderKeyPrompt;
  const modal=$('mauliKeyModal');if(!modal)return Promise.resolve(!!founderKey());
  let remember=false;try{remember=localStorage.getItem(FOUNDER_KEY_REMEMBER)==='1'}catch(_){}
  const input=$('mauliKeyInput');const box=$('mauliKeyRemember');const msg=$('mauliKeyMsg');
  if(input)input.value=founderKey();
  if(box)box.checked=remember;
  if(msg){msg.textContent='';msg.className='mauli-keymsg'}
  modal.hidden=false;
  let settle=null;
  founderKeyPrompt=new Promise(resolve=>{settle=resolve});
  const close=result=>{
    modal.hidden=true;
    const p=founderKeyPrompt;founderKeyPrompt=null;
    document.removeEventListener('keydown',onKey);
    if(p)settle(result);
  };
  const onKey=e=>{if(e.key==='Escape')close(false)};
  document.addEventListener('keydown',onKey);
  const save=()=>{
    const value=(input&&input.value||'').trim();
    if(!value){if(msg){msg.textContent='Key रिकामी आहे — MAULI_FOUNDER_KEY paste करा.';msg.className='mauli-keymsg err'}return}
    setFounderKey(value,!!(box&&box.checked));
    const ok=paintFounderKeyState();
    if(msg){msg.textContent=ok?'✓ Key save झाली. Panels आता load होतात…':'Key save झाली नाही';msg.className='mauli-keymsg '+(ok?'ok':'err')}
    // Re-run whatever the founder was looking at, so the panel they came to fix is the
    // one that repaints — not a different one.
    close(true);
    if(ok){refreshAfterFounderKey();toast('Founder key saved','ok')}
  };
  const cancel=$('mauliKeyCancel');if(cancel)cancel.onclick=()=>close(false);
  const clear=$('mauliKeyClear');if(clear)clear.onclick=()=>{clearFounderKey();if(msg){msg.textContent='Key clear केली';msg.className='mauli-keymsg'}close(false);toast('Founder key cleared','info')};
  const saveBtn=$('mauliKeySave');if(saveBtn)saveBtn.onclick=save;
  if(input)input.onkeydown=e=>{if(e.key==='Enter')save()};
  modal.onclick=e=>{if(e.target===modal)close(false)};
  if(input)setTimeout(()=>{try{input.focus();input.select()}catch(_){}},0);
  return founderKeyPrompt;
}
function openFounderKey(){return showFounderKeyModal()}
function refreshAfterFounderKey(){
  try{renderPage(curPage)}catch(_){}
  try{updateStats()}catch(_){}
  try{loadState&&loadState()}catch(_){}
}
// Resolves true only when the founder actually supplied a key. Every 401/503 in the app
// funnels through here, so a founder who cancels sees the panels stay honestly empty and
// the banner stay up — instead of a raw "{"ok":false...}" string in the chat bubble.
function requestFounderKey(){return showFounderKeyModal()}
window.__mauliFounderKey=founderKey;window.__mauliSetFounderKey=setFounderKey;window.__mauliClearFounderKey=clearFounderKey;window.__mauliFounderHeaders=founderHeaders;window.__mauliOpenFounderKey=openFounderKey;
paintFounderKeyState();
// downloadZip lives in this script; the injected live layer calls it for the
// project-details modal's Download button (function declarations are hoisted).
window.__mauliDownloadProject=downloadZip;window.__mauliRequestFounderKey=requestFounderKey;
// A refused call used to throw the whole response body, so a founder-key error reached the
// UI as the literal text {"ok":false,"error":{...}} — the chat bubble printed raw JSON and
// every panel's catch() swallowed the real reason. Read the envelope and speak plainly.
function readableApiError(raw,status){
  const text=String(raw||'').trim();
  if(text){
    try{
      const body=JSON.parse(text);
      const message=body&&(body.error&&body.error.message||body.error||body.message);
      if(typeof message==='string'&&message.trim())return message.trim();
    }catch(_){}
    if(!/^[\[{]/.test(text))return text;
  }
  return 'Request failed (HTTP '+status+')';
}
async function api(path,opts={},retried=false){
  try{const m=(opts.method||'GET').toUpperCase();const hdrs={...(opts.headers||{})};
    if(m==='POST'||m==='PUT'||m==='PATCH')hdrs['Content-Type']='application/json';
    const r=await fetch(path,{method:m,headers:founderHeaders(hdrs),body:opts.body});
    if(founderAuthNeeded(r)){
      if(!retried&&await requestFounderKey())return api(path,opts,true);
      paintFounderKeyState();
      throw new Error(founderKey()
        ? 'Founder key चुकीची आहे — settings मध्ये MAULI_FOUNDER_KEY तपासा.'
        : 'Founder key लागत आहे — टॉपबारमधील 🔑 बटण दाबून key भरा.');
    }
    if(!r.ok){const t=await r.text().catch(()=>'');throw new Error(readableApiError(t,r.status))}
    const j=await r.json();
    // Unwrap the {ok, data} envelope so every panel reads its own fields directly
    // (stats/skillTree/messages/servers/... all live under data). Keep the ok flag
    // for callers that check it explicitly (e.g. reset).
    return (j&&j.ok===true&&j.data&&typeof j.data==='object')?{...j.data,ok:true}:j;

  }catch(e){throw e}
}

// ─── NAVIGATION ───
const titles={command:'Command Center',chat:'Chat',overview:'Overview',agents:'Agents',monitor:'Monitor',projects:'Projects',tasks:'Tasks',docs:'Docs',approvals:'Approvals',activity:'Activity',health:'Health',memory:'Memory',integrations:'Integrations',editor:'File Editor',learning:'Learning',builds:'Builds',messaging:'Messaging',apiexp:'API Explorer',downloads:'Downloads',usage:'Limits & Usage'};
function go(p){curPage=p;closeSb();document.querySelectorAll('.page').forEach(e=>e.classList.remove('on'));const pg=$('pg-'+p);if(pg)pg.classList.add('on');document.querySelectorAll('.nav-i').forEach(e=>e.classList.remove('on'));const nav=document.querySelector('.nav-i[data-p="'+p+'"]');if(nav)nav.classList.add('on');$('pageTitle').textContent=titles[p]||p;renderPage(p)}
// A background refresh re-renders the current page every few seconds. Each renderer first swaps
// its container to a short "Loading…" placeholder, which collapses the document; the browser then
// clamps every scroll position it held, so a founder reading Integrations or the API Explorer was
// snapped back to the top on every poll. Snapshot the scrolled positions, then put them back once
// the re-render has landed.
function scrollSnapshot(){
  const seen=new Set(),out=[];
  const add=el=>{if(!el||seen.has(el))return;seen.add(el);try{if(el.scrollTop>0||el.scrollLeft>0)out.push({el,top:el.scrollTop,left:el.scrollLeft})}catch(_){}};
  add(document.scrollingElement);add(document.documentElement);add(document.body);
  const scope=document.querySelector('.page.on')||document;
  try{for(const el of scope.querySelectorAll('*'))add(el)}catch(_){}
  return out;
}
function restoreScrollSnapshot(snap){for(const s of snap){try{s.el.scrollTop=s.top;s.el.scrollLeft=s.left}catch(_){}}}
function renderPage(p,keepScroll){
  const r={overview:renderOverview,agents:renderAgents,projects:renderProjects,tasks:renderTasks,activity:renderActivity,health:renderHealth,memory:renderMemory,monitor:renderMonitor,integrations:renderIntegrations,learning:renderLearning,editor:loadEdits,builds:loadBuilds,messaging:loadMsgs,apiexp:loadApiExplorer,downloads:loadDl,usage:()=>{loadUsage();loadCFData();},chat:loadChat,docs:()=>{},approvals:renderApprovals};
  if(!r[p])return;
  const snap=keepScroll?scrollSnapshot():null;
  const done=()=>{if(snap)restoreScrollSnapshot(snap)};
  let out;
  try{out=r[p]()}catch(e){done();throw e}
  if(out&&typeof out.then==='function')return Promise.resolve(out).finally(done);
  done();
  return out;
}
// Every refresh path (the state poll, the ↻ buttons) goes through here so the view stays where the
// founder scrolled to. Navigation (go) deliberately does not, or a new page would open mid-scroll.
function refreshPage(){return renderPage(curPage,true)}
document.querySelectorAll('.nav-i[data-p]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();go(el.dataset.p)}));
function toggleSb(){$('sidebar').classList.toggle('open');$('sbOverlay').classList.toggle('show');document.body.classList.toggle('sb-open')}
function closeSb(){$('sidebar').classList.remove('open');$('sbOverlay').classList.remove('show');document.body.classList.remove('sb-open')}

// ─── STATE ───
async function loadState(){
  try{const r=await api('/api/state');const d=r.data||r;
    applyDashboardState(d);
    updateStats();refreshPage();
    if($('hText')){$('hDot').classList.remove('off');$('hText').textContent='System Online';}
  }catch(e){console.warn('State:',e.message)}
}
function updateStats(){
  // /api/state ships the true store-wide totals (the visible lists are deliberately
  // capped at 100/300/100, so counting rows made Tasks/Artifacts look frozen at 300/100).
  const totals=(S.summary&&S.summary.totals)||{};
  $('sProj').textContent=totals.projects??S.projects.length;$('sTask').textContent=totals.tasks??S.tasks.length;$('sAg').textContent=S.agents.length;$('sArt').textContent=totals.artifacts??S.artifacts.length;
  if($('navA'))$('navA').textContent=S.agents.length;if($('navP'))$('navP').textContent=S.projects.length;
  if($('navT'))$('navT').textContent=S.tasks.filter(t=>t.state==='working').length||S.tasks.length;
  if($('navAp'))$('navAp').textContent=S.approvals.length;
  if($('ovP'))$('ovP').textContent=S.projects.length;if($('ovC'))$('ovC').textContent=S.projects.filter(p=>p.state==='completed').length;
  if($('ovA'))$('ovA').textContent=S.projects.filter(p=>p.state==='active').length;if($('ovAg'))$('ovAg').textContent=S.agents.length;if($('ovArt'))$('ovArt').textContent=totals.artifacts??S.artifacts.length;
  if($('projCnt'))$('projCnt').textContent=(totals.projects??S.projects.length)+' projects';if($('taskCnt'))$('taskCnt').textContent=(totals.tasks??S.tasks.length)+' tasks';
}

// ─── GROQ STATUS ───
// The topbar is the one place painted on every page, so this status needs no navigation and
// no click: it answers "did the GROQ_API_KEY secret reach this Worker?" from the moment the
// dashboard loads. It reads /api/health — only the config verdict travels, never the key.
//
// The chip is a SYMBOL, not a sentence. Printing "Configured - <model> - path: <path>" in the
// topbar wrapped onto its own line and doubled the status (the chip carried the same words),
// so the row read as two overlapping labels on a phone. The detail is not lost — it lives in
// the tooltip and as full rows on the Health page — while the bar stays one glyph wide.
function paintGroqChip(d){
  const el=$('groqChip');if(!el)return;
  if(!d||typeof d.groqConfigured==='undefined'){
    el.style.color='var(--text3)';el.textContent='➖';
    el.title='Groq: unknown — /api/health did not report a verdict.';return;
  }
  if(!d.groqConfigured){
    el.style.color='var(--yellow)';el.textContent='❌';
    el.title='Groq: Not Configured — GROQ_API_KEY and MAULI_GROQ_KEY are unset on this Worker, so a spent Workers AI allowance falls straight to templates.';return;
  }
  el.style.color='var(--green)';el.textContent='✅';
  el.title='Groq: Configured · model '+String(d.groqModel||'—')+' · generation path '+String(d.generationPath||'—')+'. Read from /api/health; the key itself is never shown.';
}
async function loadGroqChip(){
  try{const r=await api('/api/health');paintGroqChip(r.data||r);}
  catch(_){const el=$('groqChip');if(el){el.style.color='var(--text3)';el.textContent='➖';el.title='Groq: unknown — /api/health did not answer.';}}
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
    h+='<div class="card" style="margin-bottom:0"><div style="display:flex;gap:10px;align-items:flex-start"><div style="width:36px;height:36px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'+(a.emoji||'🤖')+'</div><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">'+esc(a.name||a.id)+'</div><div style="font-size:10px;color:var(--text2)">'+esc(a.role||a.type||'Agent')+' · ID: '+esc(a.id||'—')+'</div><div style="margin-top:6px"><div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="font-size:10px;color:var(--text3)">Skill</span><span style="font-size:10px;color:var(--accent)">'+pct+'%</span></div><div class="pbar"><div class="pfill" style="width:'+pct+'%"></div></div></div><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:3px">'+sk.map(s=>'<span class="badge badge-a">'+esc(s)+'</span>').join('')+'</div></div></div></div>';
  }
  $('agList').innerHTML=h||'<div style="text-align:center;padding:40px;color:var(--text2)">No agents</div>';
}
function projRealState(p){const t=S.tasks.filter(t=>t.projectId===p.id);if(!t.length)return p.state||'queued';if(t.some(t=>t.state==='failed')&&!t.some(t=>['working','assigned','queued'].includes(t.state)))return 'failed';if(t.some(t=>['working','assigned'].includes(t.state)))return 'active';if(t.every(t=>t.state==='completed'))return 'completed';if(t.some(t=>t.state==='completed'))return 'active';return p.state||'queued';}
function renderProjects(){
  const search=($('projSearch')?.value||'').toLowerCase();const filter=$('projFilter')?.value||'';
  let list=S.projects;if(search)list=list.filter(p=>(p.name||p.objective||p.id||'').toLowerCase().includes(search));if(filter)list=list.filter(p=>projRealState(p)===filter);
  let h='<table class="tbl"><thead><tr><th>Name</th><th>Status</th><th>Deployment</th><th>Production Runtime</th><th>Runtime URL</th><th>Final Delivery</th><th>Tasks</th><th>Actions</th></tr></thead><tbody>';
  // hasCode comes from the server (it can see every artifact); the capped local sample
  // is only a fallback, which is why the download/preview/build buttons used to vanish
  // for finished projects whose artifact sat outside /api/state's newest 100.
  for(const p of list){const hasCode=('hasCode' in p)?!!p.hasCode:S.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');const canBuild=('canBuild' in p)?!!p.canBuild:hasCode;const rs=projRealState(p);const tasks=S.tasks.filter(t=>t.projectId===p.id);const done=tasks.filter(t=>t.state==='completed').length;const total=tasks.length;
    // Point 16: the runtime verdict is a column of its own, so the founder reads
    // PASS / FAILED / BLOCKED next to the project state instead of having to open it and
    // find a "QA Passed" badge that says nothing about whether the product was ever run.
    const rt=p.productionRuntime||null;const rtLabel=String((rt&&rt.label)||'NOT RUN');const rtCls=rtLabel==='PASS'?'g':rtLabel==='FAILED'?'r':rtLabel==='LOCAL'?'a':'y';
    // Point 21: deployment, runtime URL and final-delivery readiness are their OWN columns.
    // Folding them into a single "QA Passed" is what let a never-deployed product read as
    // finished, so the table can no longer show runtime without saying where it ran.
    const dep=String((rt&&rt.deploymentStatus)||'NOT_DEPLOYED');const depCls=dep==='DEPLOYED'?'g':dep==='FAILED'?'r':'y';
    const url=(rt&&rt.runtimeUrl)||null;
    const fd=(rt&&rt.finalDelivery)||'BLOCKED';
    // The project name is the obvious thing to tap for details, and it was inert text.
    // Reusing .proj-detail lets the injected live layer's delegated handler open the same
    // detail view the row's Details button opens.
    h+='<tr><td><b class="proj-detail" data-pid="'+p.id+'" style="cursor:pointer" title="Open full project details">'+esc(p.name||p.objective||p.id)+'</b></td><td><span class="badge badge-'+badge(rs)+'">'+esc(rs)+'</span></td>'+
    '<td><span class="badge badge-'+depCls+'" title="'+esc((rt&&rt.deploymentError)?(rt.deploymentError.category+': '+rt.deploymentError.message):dep)+'">'+esc(dep)+'</span></td>'+
    '<td><span class="badge badge-'+rtCls+'" title="'+esc(rt&&rt.reason?rt.reason:'No production runtime acceptance run has been recorded for this project.')+'">'+esc(rtLabel)+'</span></td>'+
    '<td style="font-size:10px">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener">'+esc(url.slice(url.indexOf('://')+3))+'</a>':'<span style="color:var(--text2)">—</span>')+'</td>'+
    '<td><span class="badge badge-'+(fd==='READY'?'g':'r')+'">'+esc(fd)+'</span></td>'+
    '<td style="font-size:11px">'+(total?done+'/'+total:'—')+'</td><td style="display:flex;gap:4px;flex-wrap:wrap">';
    h+='<button class="btn btn-a btn-s proj-detail" data-pid="'+p.id+'">📄 Details</button>';
    h+='<button class="btn btn-g btn-s dl-btn" data-pid="'+p.id+'">📥</button>';
    // A class, not an inline window.open(): /api/preview-app is founder-protected and a new tab cannot send the key header, so this button used to open a 401 page. The injected live layer (DASHBOARD_LIVE_SCRIPT) handles .pv-btn with the key attached.
    if(hasCode)h+='<button class="btn btn-a btn-s pv-btn" data-pid="'+p.id+'" title="App preview">👁️</button>';
    if(hasCode&&canBuild)h+='<button class="btn btn-g btn-s bld-btn" data-pid="'+p.id+'" data-plat="android" title="Android APK build">📱</button><button class="btn btn-a btn-s bld-btn" data-pid="'+p.id+'" data-plat="desktop" title="Desktop build">🖥️</button>';
    else if(hasCode)h+='<span class="badge badge-y" title="या project मध्ये web app (www/index.html) नाही, त्यामुळे APK/EXE बनत नाही" style="cursor:help;align-self:center">⚠️ web app नाही</span>';
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
function renderHealthTools(){
  const list=Array.isArray(S.tools)?S.tools:[];if(!$('toolsOut'))return;
  if(!list.length){$('toolsOut').innerHTML='<div style="text-align:center;padding:20px;color:var(--text2)">No tools registered</div>';return;}
  let h='<div style="font-size:10px;color:var(--text3);padding:2px 0 8px">'+list.length+' tool'+(list.length===1?'':'s')+' registered</div>';
  for(const t of list){
    const risk=t.risk||'read';const riskColor=risk==='critical'||risk==='high'?'var(--yellow)':'var(--text2)';
    h+='<div style="padding:7px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:12px">'+esc(t.name||t.id||'—')+'</b><span class="badge badge-'+(t.enabled===false?'y':'g')+'">'+(t.enabled===false?'Disabled':'Enabled')+'</span></div><div style="font-size:10px;color:var(--text2);margin-top:3px">'+esc(t.description||'')+'</div><div style="font-size:9px;color:var(--text3);margin-top:3px">Scope: '+esc(t.scope||'internal')+' · Risk: <span style="color:'+riskColor+'">'+esc(risk)+'</span></div></div>';
  }
  $('toolsOut').innerHTML=h;
}
// The old card asked for a GitHub "Token" and painted a red "Issue" whenever it was unset.
// Results are persisted in D1, so a missing optional GitHub token is not a system fault —
// the card now reports real result-storage health instead.
async function renderDiagnostics(){
  if(!$('diagOut'))return;
  $('diagOut').innerHTML='<div style="color:var(--text2);padding:6px 0">Running diagnostic...</div>';
  try{
    const r=await api('/api/result-diagnostic');const d=r.result||r;
    const row=(l,v)=>'<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px;color:var(--text2)">'+l+'</span><span style="font-size:11px">'+v+'</span></div>';
    const ok='color:var(--green)',bad='color:var(--red)',warn='color:var(--yellow)';
    const flushState=String(d.flushState||'flushed');
    const flushLabel=flushState==='flushed'?'Flushed':flushState==='flush-timeout'?'Pending (slow D1)':'Deferred';
    const flushColor=flushState==='flushed'?ok:flushState==='flush-timeout'?warn:bad;
    let h=row('Result storage',d.d1Connected?'<span style="'+ok+'">D1 (connected)</span>':'<span style="'+bad+'">Memory only</span>');
    h+=row('Stored results',Number(d.storedResults||0).toLocaleString());
    h+=row('Pending flush','<span style="'+flushColor+'">'+esc(flushLabel)+'</span>');
    h+=row('GitHub token (optional)',d.tokenConfigured?'<span style="'+ok+'">Set</span>':'<span style="'+warn+'">Not set</span>');
    h+=row('Status',d.ok?'<span style="'+ok+'">OK</span>':'<span style="'+bad+'">Issue</span>');
    h+='<div style="font-size:9px;color:var(--text3);margin-top:6px">'+esc(d.reason||'')+'</div>';
    $('diagOut').innerHTML=h;
  }catch(e){$('diagOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}
}
function renderHealth(){
  api('/api/health').then(r=>{const d=r.data||r;paintGroqChip(d);const row=(l,v)=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px;color:var(--text2)">'+l+'</span><span style="font-size:11px">'+v+'</span></div>';
    const q=d.d1Quota||{};
    const used=Number(q.used||0), limit=Number(q.limit||100000), remaining=Math.max(0,Number(q.remaining ?? (limit-used)));
    const pct=Math.min(100,Number(q.percent||0));
    const status=String(q.status||'unknown');
    const statusLabel=status==='limit_reached'?'Protection':status==='critical'?'Critical':status==='high'?'High':status==='watch'?'Watch':'Healthy';
    let h=row('Service',d.service||'—')+row('Status','<span style="color:var(--green)">'+esc(d.status||'?')+'</span>')+row('D1',d.persistence?'<span style="color:var(--green)">Connected</span>':'<span style="color:var(--yellow)">Memory</span>')+row('AI',d.ai?'<span style="color:var(--green)">Yes</span>':'<span style="color:var(--yellow)">No</span>')
      +row('Groq',d.groqConfigured?'<span style="color:var(--green)">✅ Configured</span>':'<span style="color:var(--yellow)">❌ Not Configured</span>')
      +(d.groqConfigured?row('Groq model',esc(d.groqModel||'—'))+row('Generation path',esc(d.generationPath||'—')):'')
      +row('Time',fmt(d.time));
    h += '<div style="margin-top:12px;padding:10px;border:1px solid var(--border);border-radius:var(--rs)"><div style="font-size:12px;font-weight:700;margin-bottom:6px">D1 Daily Usage</div>'+row('Used',used.toLocaleString()+' / '+limit.toLocaleString())+row('Remaining',remaining.toLocaleString())+row('Usage',pct.toFixed(2)+'%')+row('Status','<span>'+esc(statusLabel)+'</span>')+row('UTC Day',esc(q.date||'—'))+'<div style="font-size:9px;color:var(--text3);margin-top:6px">MAULI tracked writes; Cloudflare account meter may differ.</div></div>';
    // State reads used to fail silently, which is how the counters could blank to zero with
    // no explanation. Report the real cause here whenever a read did fail on this isolate.
    const sr=d.stateReads||{};
    const hydrateErr=Array.isArray(sr.hydrateErrors)?sr.hydrateErrors:[];
    const hasStateReadIssue=Number(sr.degradedCount||0)>0||Number(sr.recoveredCount||0)>0;
    if(hasStateReadIssue||hydrateErr.length>0){
      h += '<div style="margin-top:10px;padding:10px;border:1px solid var(--border);border-radius:var(--rs)"><div style="font-size:12px;font-weight:700;margin-bottom:6px">State Reads</div>';
      if(hasStateReadIssue)h += row('Unrecovered',String(sr.degradedCount||0))+row('Recovered on retry',String(sr.recoveredCount||0))+row('Last reason','<span style="color:var(--yellow)">'+esc(sr.lastReason||'—')+'</span>')+row('Last seen',fmt(sr.lastAt));
      if(hydrateErr.length>0){
        const last=hydrateErr[hydrateErr.length-1];
        h += row('Hydration','<span style="color:var(--yellow)">'+esc((sr.hydrateFailures||[]).join(', ')||'partial')+'</span>')+row('Hydration error','<span style="color:var(--yellow)">'+esc(last.type+': '+last.reason)+'</span>')+row('Hydration seen',fmt(last.at));
      }
      h += '<div style="font-size:9px;color:var(--text3);margin-top:6px">A failed read is served from the last good snapshot; the dashboard keeps showing its current rows.</div></div>';
    }
    $('hlthDet').innerHTML=h}).catch(e=>{$('hlthDet').innerHTML='<div style="color:var(--red);padding:10px">Health unavailable</div>'});
  // The Tools card had no renderer at all (toolsOut stayed empty) and the Diagnostics card
  // only appeared after a manual click, so both are now filled on page render.
  // Clear a stale emoji when Health had no verdict before the first poll answered.
  if($('hlthDet')&&$('hlthDet').textContent==='Loading…'){
    const sp=$('hlthDet').querySelector('span.groq-emoji');
    if(sp)sp.textContent='➖';
  }
  renderHealthTools();
  if(!renderHealth._diagStarted){renderHealth._diagStarted=true;renderDiagnostics();}
}
function renderMemory(){
  const evts=S.events.filter(e=>e.type&&(e.type.includes('task_result')||e.type.includes('solution')||e.type.includes('error')||e.type.includes('command'))).slice(-25).reverse();
  let h='';for(const e of evts){const p=typeof e.payload==='object'?JSON.stringify(e.payload):String(e.payload||'');
    h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><span class="badge badge-a">'+esc(e.type)+'</span><span style="font-size:10px;color:var(--text3)">'+fmt(e.at)+'</span></div><pre style="font-size:10px;color:var(--text2);white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden;font-family:monospace;margin-top:4px">'+esc(p)+'</pre></div>';
  }
  $('memList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No memory</div>';
}
function renderMonitor(){
  // The lists are capped at 100/300 rows; without the server totals this grid read
  // "300 tasks / 100 artifacts" while the header correctly said 738/429.
  const tot=(S.summary&&S.summary.totals)||{};
  const grid=[{l:'Projects',v:tot.projects??S.projects.length,i:'📁',a:true},{l:'Tasks',v:tot.tasks??S.tasks.length,i:'📋',a:S.tasks.some(t=>t.state==='working')},{l:'Agents',v:S.agents.length,i:'🤖',a:true},{l:'Working',v:S.tasks.filter(t=>t.state==='working').length,i:'⚡',a:S.tasks.some(t=>t.state==='working')},{l:'Completed',v:S.tasks.filter(t=>t.state==='completed').length,i:'✅',a:true},{l:'Failed',v:S.tasks.filter(t=>t.state==='failed').length,i:'❌',a:S.tasks.some(t=>t.state==='failed')},{l:'Events',v:S.events.length,i:'📡',a:S.events.length>0},{l:'Artifacts',v:tot.artifacts??S.artifacts.length,i:'📦',a:(tot.artifacts??S.artifacts.length)>0}];
  $('monGrid').innerHTML=grid.map(g=>'<div class="card stat" style="margin-bottom:0;'+(g.a?'border-color:var(--accent)':'')+'"><div class="stat-l">'+g.i+' '+g.l+'</div><div class="stat-v" style="font-size:22px">'+g.v+'</div></div>').join('');
  $('monAgents').innerHTML=S.agents.map(a=>'<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="width:6px;height:6px;border-radius:50%;background:var(--green);margin-top:4px"></div><div style="font-size:12px"><b>'+esc(a.name||a.id)+'</b> — '+esc(a.role||'Agent')+'</div></div>').join('')||'<div style="color:var(--text2);padding:10px">No agents</div>';
  $('monTasks').innerHTML=S.tasks.slice(-10).reverse().map(t=>'<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:11px">'+esc(t.title||t.id)+'</span><span class="badge badge-'+tBadge(t.state)+'">'+esc(t.state)+'</span></div><div class="pbar"><div class="pfill'+(t.state==='completed'?' done':'')+'" style="width:'+pct(t.state)+'%"></div></div></div>').join('')||'<div style="color:var(--text2);padding:10px">No tasks</div>';
}
// ─── USAGE / LIMITS ───
function usageBar(pct,color){const c=pct>90?'var(--red)':pct>70?'var(--yellow)':color||'var(--accent)';return '<div class="pbar" style="height:8px;margin:4px 0"><div style="height:100%;border-radius:3px;background:'+c+';width:'+Math.min(100,pct)+'%"></div></div>'}
function usageRow(label,used,limit,unit){const pct=limit>0?(used/limit*100):0;const c=pct>90?'var(--red)':pct>70?'var(--yellow)':'var(--green)';return '<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:var(--text2)">'+label+'</span><span style="font-size:11px;font-weight:600;color:'+c+'">'+used+' / '+limit+' '+unit+' ('+pct.toFixed(1)+'%)</span></div>'+usageBar(pct)+'</div>'}
async function loadUsage(){
  try{
    const r=await api('/api/usage');const u=r.usage||r.data||r;
    const d1=u.d1||{};const w=u.workers||{};const kv=u.kv||{};
    // Fallback to CF API data when local D1 is empty (limit exceeded)
    const cfD1=d1.cfTotalMB?{usedMB:d1.cfTotalMB,limitMB:500,pct:d1.cfPercent,remainingMB:parseFloat(d1.cfTotalMB)?(500-parseFloat(d1.cfTotalMB)).toFixed(2):'—',rows:null,events:null,cfAvailable:true}:null;
    const displayD1=cfD1||d1;
    if($('uDb'))$('uDb').textContent=displayD1.usedMB?displayD1.usedMB+'MB':'—';
    if($('uReq'))$('uReq').textContent=w.requestsPerDay?w.requestsPerDay.toLocaleString():'—';
    if($('uCpu'))$('uCpu').textContent=w.cpuMs?w.cpuMs+'ms':'—';
    // D1 bar
    if($('uD1Bar')){
      const pct=parseFloat(displayD1.pct||'0');
      const c=pct>90?'var(--red)':pct>70?'var(--yellow)':'var(--accent)';
      $('uD1Bar').innerHTML='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px;font-weight:600">'+displayD1.usedMB+' MB / '+displayD1.limitMB+' MB</span><span style="font-size:12px;font-weight:600;color:'+c+'">'+pct+'%</span></div>'+usageBar(pct)+'<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3)"><span>Remaining: <b style="color:var(--green)">'+displayD1.remainingMB+' MB</b></span><span>'+displayD1.rows||'—'+(cfD1?' (CF API)':'')+' rows total</span></div>';
    }
    if($('uDetail')||$('uD1Detail')){
      const el=$('uDetail')||$('uD1Detail');
      const evtCount=cfD1?null:(d1.events?.count||0);
      let h='<div style="font-size:11px;color:var(--text2);margin-bottom:8px">Events: '+(evtCount??'— CF API')+' stored</div>';
      h+=usageRow('Events Storage',((displayD1.events?.bytes||0)/1048576).toFixed(2),Math.min(displayD1.limitMB*0.1,50).toFixed(2),'MB');
      el.innerHTML=h;
    }
    // Workers
    if($('uWorkers')){
      let h='';
      h+=usageRow('Requests / Day','—',w.requestsPerDay?.toLocaleString()||'100K','req');
      h+=usageRow('CPU Time','—',w.cpuMs||10,'ms');
      h+=usageRow('Memory','—',w.memoryMB||128,'MB');
      h+=usageRow('Subrequests','—',w.subrequests||50,'/req');
      h+=usageRow('Worker Size','—',w.sizeMB||3,'MB');
      $('uWorkers').innerHTML=h;
    }
    // KV
    if($('uKv')){
      let h='';
      h+=usageRow('Reads / Day','—',kv.readsPerDay?.toLocaleString()||'100K','req');
      h+=usageRow('Writes / Day','—',kv.writesPerDay?.toLocaleString()||'1K','req');
      h+=usageRow('Storage','—',kv.storageMB?.toLocaleString()||'25K','MB');
      $('uKv').innerHTML=h;
    }
    // Breakdown
    if($('uBreakdown')){
      const breakdown=d1.breakdown||[];
      let h='<table class="tbl"><thead><tr><th>Type</th><th>Rows</th><th>Size</th><th>% of DB</th></tr></thead><tbody>';
      for(const t of breakdown){
        const pct=t.bytes>0?(t.bytes/(d1.usedMB*1048576||1)*100):0;
        h+='<tr><td style="font-weight:600">'+esc(t.type)+'</td><td>'+t.count+'</td><td>'+t.mb+' MB</td><td>'+usageBar(pct)+'<span style="font-size:10px;color:var(--text3)">'+pct.toFixed(1)+'%</span></td></tr>';
      }
      h+='</tbody></table>';
      $('uBreakdown').innerHTML=h||'<div style="color:var(--text2)">No data</div>';
    }
  }catch(e){console.warn('Usage:',e.message)}
}
async function runCleanup(){
  if(!confirm('This will delete old events, results, builds, and verifications to free D1 storage. Continue?'))return;
  try{
    $('uCleanup').innerHTML='<div class="spinner"></div>';
    const r=await api('/api/cleanup',{method:'POST',body:JSON.stringify({})});
    const c=r.cleanup||r.data||r;
    let h='<div style="padding:8px 0">';
    h+='<div style="font-size:12px;font-weight:600;color:var(--green)">✅ Cleanup Complete!</div>';
    if(c.eventsPruned)h+='<div style="font-size:11px;color:var(--text2)">Events pruned: '+c.eventsPruned+'</div>';
    if(c.resultsPruned)h+='<div style="font-size:11px;color:var(--text2)">Results pruned: '+c.resultsPruned+'</div>';
    if(c.buildsPruned)h+='<div style="font-size:11px;color:var(--text2)">Builds pruned: '+c.buildsPruned+'</div>';
    if(c.verificationsPruned)h+='<div style="font-size:11px;color:var(--text2)">Verifications pruned: '+c.verificationsPruned+'</div>';
    if(c.runsPruned)h+='<div style="font-size:11px;color:var(--text2)">Runs pruned: '+c.runsPruned+'</div>';
    h+='<div style="font-size:11px;margin-top:6px"><b>Storage freed: '+c.freedMB+' MB</b> | After: '+c.afterMB+' MB</div>';
    h+='</div>';
    $('uCleanup').innerHTML=h;
    toast('Cleanup done! Freed '+c.freedMB+' MB','ok');
    loadUsage();
  }catch(e){$('uCleanup').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';toast('Cleanup failed','err')}
}
async function loadCFData(){
  try{
    const r=await api('/api/cf/usage');
    const u=r.usage||r.data?.usage||r;
    if($('cfStatus')){
      const connected=u.apiConnected;
      $('cfStatus').innerHTML='<span class="badge badge-'+(connected?'g':'y')+'">'+(connected?'🟢 Connected':'⚪ Not Connected')+'</span>';
    }
    if(u.d1&&u.d1.available&&$('cfD1')){
      const d=u.d1;
      let h='<div style="padding:8px 0">';
      h+='<div style="font-size:12px;font-weight:600;color:var(--accent)">☁️ Real D1 Usage (Cloudflare API)</div>';
      h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Total Used</span><b style="font-size:11px">'+d.totalMB+' MB / '+d.limit+' MB</b></div>';
      h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Remaining</span><b style="font-size:11px;color:var(--green)">'+d.remaining+' MB</b></div>';
      h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Usage</span><b style="font-size:11px;color:'+(parseFloat(d.percent)>80?'var(--red)':'var(--accent)')+'">'+d.percent+'%</b></div>';
      if(d.tables&&d.tables.length){
        h+='<div style="margin-top:8px;font-size:11px;font-weight:600">Table Breakdown:</div>';
        for(const t of d.tables)h+='<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:10px"><span style="color:var(--text2)">'+esc(t.type)+'</span><span>'+t.count+' rows ('+t.mb+' MB)</span></div>';
      }
      h+='</div>';
      $('cfD1').innerHTML=h;
    }else if($('cfD1')){
      $('cfD1').innerHTML='<div style="padding:8px;color:var(--text2);font-size:11px">'+esc(u.d1?.error||'Not available')+'</div>';
    }
    if(u.workers&&u.workers.available&&$('cfWorkers')){
      const w=u.workers;
      let h='<div style="padding:8px 0">';
      h+='<div style="font-size:12px;font-weight:600;color:var(--accent)">⚡ Worker Info (Cloudflare API)</div>';
      h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Script Size</span><b style="font-size:11px">'+w.sizeMB+' MB</b></div>';
      if(w.created)h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Created</span><span style="font-size:11px">'+new Date(w.created).toLocaleDateString()+'</span></div>';
      if(w.modified)h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Modified</span><span style="font-size:11px">'+new Date(w.modified).toLocaleDateString()+'</span></div>';
      h+='</div>';
      $('cfWorkers').innerHTML=h;
    }else if($('cfWorkers')){
      $('cfWorkers').innerHTML='<div style="padding:8px;color:var(--text2);font-size:11px">'+esc(u.workers?.error||'Not available')+'</div>';
    }
    if(u.kv&&u.kv.available&&$('cfKv')){
      const k=u.kv;
      let h='<div style="padding:8px 0">';
      h+='<div style="font-size:12px;font-weight:600;color:var(--accent)">🔑 KV Status (Cloudflare API)</div>';
      h+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:11px">Namespaces</span><b style="font-size:11px">'+k.namespaces.length+'</b></div>';
      for(const ns of k.namespaces)h+='<div style="padding:4px 0 4px 12px;font-size:10px;color:var(--text2)">📁 '+esc(ns.title)+' ('+ns.keyCount+' keys)</div>';
      h+='</div>';
      $('cfKv').innerHTML=h;
    }
    if(u.alerts&&$('cfAlerts')){
      if(u.alerts.length){
        let h='';
        for(const a of u.alerts){
          const c=a.level==='critical'?'r':a.level==='warning'?'y':'a';
          h+='<div style="padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;align-items:center;gap:6px"><span class="badge badge-'+c+'">'+a.level.toUpperCase()+'</span><span style="font-size:11px">'+esc(a.message)+'</span></div>';
        }
        $('cfAlerts').innerHTML=h;
      }else{
        $('cfAlerts').innerHTML='<div style="padding:8px;color:var(--green);font-size:11px">✅ No alerts — all limits OK</div>';
      }
    }
  }catch(e){console.warn('CF API:',e.message);if($('cfStatus'))$('cfStatus').innerHTML='<span class="badge badge-r">❌ '+esc(e.message)+'</span>'}
}

// Every row below came from the Worker: the previous version painted six fixed cards that
// always read "Configured" / "Connected" / "Bound" / "Deployed" and never asked anything, so
// an unset GITHUB_TOKEN looked identical to a healthy deployment. The status is now the
// server's own verdict and a missing dependency says so.
const INT_TONE={connected:'badge-g',warning:'badge-y',missing:'badge-r'};
async function renderIntegrations(){
  const list=$('intList');
  if(!list)return;
  showPlaceholderOnce(list,'<div class="card" style="margin-bottom:0"><div style="font-size:11px;color:var(--text2)">Checking what this Worker actually has…</div></div>');
  let data;
  try{data=await api('/api/integrations');}
  catch(e){
    setHtml(list,'<div class="card" style="margin-bottom:0"><div style="font-size:11px;color:var(--red)">Could not read integration status: '+esc(e.message)+'</div></div>');
    const s=$('intSummary');if(s)s.textContent='';
    return;
  }
  const rows=data.integrations??[];
  const c=data.counts??{};
  const s=$('intSummary');
  if(s)s.textContent=rows.length+' checked · '+c.connected+' connected · '+(c.warning??0)+' warning · '+(c.missing??0)+' missing';
  setHtml(list,rows.map(i=>{
    const tone=INT_TONE[i.status]||'badge-a';
    return '<div class="card" style="margin-bottom:0"><div style="display:flex;align-items:center;gap:10px">'+
      '<span style="font-size:24px">'+esc(i.icon)+'</span>'+
      '<div style="min-width:0"><b style="font-size:13px">'+esc(i.name)+'</b>'+
      '<div style="font-size:10px;color:var(--text2)">'+esc(i.category)+'</div>'+
      '<div style="font-size:10px;color:var(--text2);margin-top:3px;overflow-wrap:anywhere">'+esc(i.detail)+'</div>'+
      (i.status==='missing'?'<div style="font-size:10px;color:var(--red);margin-top:3px">'+esc(i.hint)+'</div>':'')+
      '</div><span class="badge '+tone+'" style="margin-left:auto;white-space:nowrap">'+esc(i.statusLabel)+'</span></div></div>';
  }).join(''));
}
function renderApprovals(){
  let h='';for(const a of S.approvals)h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:12px">'+esc(a.action||a.id)+'</b><div style="font-size:10px;color:var(--text2)">Risk: '+esc(a.risk||'unknown')+'</div></div><div style="display:flex;gap:4px"><button class="btn btn-g btn-s" onclick="decideAppr(\\''+a.id+'\\',true)">✅</button><button class="btn btn-r btn-s" onclick="decideAppr(\\''+a.id+'\\',false)">❌</button></div></div>';
  $('apprList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No pending approvals</div>';
}
async function decideAppr(id,ok){try{await api('/api/approvals/'+id,{method:'POST',body:JSON.stringify({approved:ok})});toast(ok?'Approved':'Rejected','ok');loadState()}catch(e){toast(e.message,'err')}}

// ─── PLATFORM SELECTOR ───
// The target platform is chosen before the command is sent, so the product is built for it
// from the start instead of being discovered when the founder clicks a build button later.
let PLATFORMS=[{id:'web',label:'Web',icon:'🌐'},{id:'android',label:'Android',icon:'📱'},{id:'ios',label:'iOS',icon:'🍎'},{id:'desktop',label:'Desktop',icon:'🖥️'}];
let SEL_PLATFORM='web';
function renderPlatforms(){
  const box=$('platSel');if(!box)return;
  box.innerHTML=PLATFORMS.map(p=>'<button class="btn btn-s '+(p.id===SEL_PLATFORM?'btn-p':'btn-g')+'" data-plat="'+esc(p.id)+'" onclick="selPlat(\\''+esc(p.id)+'\\')" style="display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:8px">'+p.icon+' '+esc(p.label)+'</button>').join('');
  const hint=$('cmdPlatHint');const cur=PLATFORMS.find(p=>p.id===SEL_PLATFORM);
  if(hint)hint.textContent=cur?('Building for '+cur.label):'';
}
function selPlat(id){SEL_PLATFORM=id;renderPlatforms()}
async function loadPlatforms(){
  try{const r=await api('/api/platforms');const d=r.data||r;if(Array.isArray(d.platforms)&&d.platforms.length){PLATFORMS=d.platforms;if(d.default)SEL_PLATFORM=d.default;}}catch(_){}
  renderPlatforms();
}
function platLabel(id){const p=PLATFORMS.find(x=>x.id===id);return p?(p.icon+' '+p.label):'🌐 Web'}

// ─── COMMAND ───
// The founder's most important screen used to answer a command with a raw JSON dump in a
// <pre>. The numbers a founder needs — what was created, what state it is in, what happens
// next, where the code is — were buried in it. This renders the same response as an outcome
// the founder can read at a glance, and keeps the raw payload one click away for debugging
// instead of in front of them by default.
function renderCommandOutcome(o){
  const el=$('cmdOutcome');if(!el)return;
  const tone=o.failed?'r':(o.state==='completed'?'g':(o.state==='blocked'||o.state==='failed'?'y':'a'));
  const steps=o.tasks&&o.tasks.length?o.tasks.slice(0,6):[];
  let h='<div class="card" style="margin:0;border-color:var(--border2)">';
  h+='<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
  h+='<span class="badge badge-'+tone+'">'+esc(o.headline||'Command accepted')+'</span>';
  if(o.platform)h+='<span class="badge badge-b">'+esc(platLabel(o.platform))+'</span>';
  if(o.project)h+='<span class="badge badge-'+badge(o.state)+'">'+esc(o.state||'queued')+'</span>';
  h+='<span style="margin-left:auto;font-size:10px;color:var(--text3);font-family:monospace">run ' +esc(String(o.runId||'—'))+'</span>';
  h+='</div>';
  if(o.title)h+='<div style="margin-top:10px;font-size:14px;font-weight:600">'+esc(o.title)+'</div>';
  if(o.objective)h+='<div style="margin-top:3px;font-size:12px;color:var(--text2);line-height:1.5">'+esc(o.objective)+'</div>';
  if(o.progress!=null)h+='<div class="pbar" style="margin-top:12px"><div class="pfill" style="width:'+Math.max(0,Math.min(100,o.progress))+'%"></div></div>';
  if(steps.length){
    h+='<div style="margin-top:12px;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.6px">Plan · '+o.tasks.length+' task'+(o.tasks.length===1?'':'s')+'</div><div style="margin-top:6px">';
    for(const t of steps)h+='<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px"><span class="badge badge-'+badge(t.state)+'">'+esc(t.state||'queued')+'</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.title||t.id)+'</span></div>';
    if(o.tasks.length>steps.length)h+='<div style="font-size:10px;color:var(--text3);padding-top:4px">+'+(o.tasks.length-steps.length)+' more in Tasks</div>';
    h+='</div>';
  }
  h+='<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);line-height:1.6">'+esc(o.next||'')+'</div>';
  if(o.actions&&o.actions.length){
    h+='<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">';
    for(const a of o.actions)h+='<button class="btn btn-a btn-s" onclick="'+esc(a.fn)+'">'+esc(a.label)+'</button>';
    h+='</div>';
  }
  h+='</div>';
  el.style.display='block';setHtml(el,h);
}
// The dashboard has no per-project route, so "open" means: show the project list and load
// that project's files into the Editor, which is the one place a founder acts on real code.
function openProject(pid){go('projects');try{const sel=$('edProj');if(sel){sel.value=String(pid);loadProjFiles(String(pid));}}catch(_){}}
function showRawCommandResponse(payload){
  $('cmdRes').textContent=typeof payload==='string'?payload:JSON.stringify(payload,null,2);
  $('cmdRawWrap').style.display='block';
}
async function sendCmd(){
  const cmd=$('cmdIn').value.trim();if(!cmd){toast('Enter a command','err');return}
  $('cmdBtn').disabled=true;$('cmdLoad').classList.add('show');
  $('cmdOutcome').style.display='none';$('cmdRawWrap').style.display='none';
  try{const r=await api('/api/command',{method:'POST',body:JSON.stringify({command:cmd,platform:SEL_PLATFORM})});
    const queued=r.result||r;
    const project=queued?.project||queued?.result?.project||null;
    const platform=queued?.platform?.platform||queued?.result?.platform?.platform||project?.platform||SEL_PLATFORM;
    const tasks=Array.isArray(queued?.tasks)?queued.tasks:[];
    showRawCommandResponse(queued);
    renderCommandOutcome({
      headline:project?'Project created':'Command accepted',
      title:project?(project.name||'Untitled project'):null,
      objective:project?(project.objective||cmd):cmd,
      state:project?.state||'planning',
      platform:platform,
      runId:queued?.runId||queued?.result?.runId||null,
      tasks:tasks.map(t=>({id:t.id,title:t.title,state:t.state})),
      progress:tasks.length?Math.round(tasks.filter(t=>['completed','verified'].includes(t.state)).length/tasks.length*100):0,
      next:project?('MAULI is building this now. Code, evidence and the downloadable workspace appear under Projects once every gate has passed.'):'MAULI accepted the command and is planning the project.',
      actions:project?[{label:'Open project',fn:"openProject('"+String(project.id).replace(/'/g,"")+"')"},{label:'Watch live',fn:"go('monitor')"}]:[{label:'View projects',fn:"go('projects')"}]
    });
    toast(project?('Project created for '+platLabel(platform)):'Command accepted','ok');$('cmdIn').value='';await loadState();
    if(project?.id){
      setTimeout(async()=>{try{const d=await api('/api/projects/'+encodeURIComponent(project.id)+'/detail');const detail=d.detail||d.data?.detail;
        if(!detail)return;
        showRawCommandResponse(detail);
        const dt=detail.tasks||[];
        renderCommandOutcome({
          headline:detail.project?.state==='completed'?'Delivered':'Building',
          title:detail.project?.name,objective:detail.project?.objective,
          state:detail.project?.state,platform:detail.project?.platform||platform,
          runId:queued?.runId||queued?.result?.runId||null,
          tasks:dt.map(t=>({id:t.id,title:t.title,state:t.state})),
          progress:dt.length?Math.round(dt.filter(t=>['completed','verified'].includes(t.state)).length/dt.length*100):0,
          next:detail.summary||'MAULI is working through the plan. Delivery unlocks when every gate passes.',
          actions:[{label:'Open project',fn:"openProject('"+String(project.id).replace(/'/g,"")+"')"},{label:'Watch live',fn:"go('monitor')"}]
        });
        await loadState();
      }catch(_){ }},1500);
    }
  }catch(e){showRawCommandResponse({error:String(e?.message||e)});renderCommandOutcome({failed:true,headline:'Command failed',title:cmd,next:String(e?.message||e),actions:[{label:'Try again',fn:"$('cmdIn').focus()"}]});toast('Failed','err')}
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
    const d=r.data||r;const resp=d.result||d;
    // The engine answers {userMessage, assistantMessage, response:{text,quickReplies}}.
    // Every earlier shape is still accepted, but a response with no readable text now says
    // so instead of printing the raw payload into the chat bubble.
    const txt=(resp.response&&resp.response.text)||resp.reply||resp.message||resp.text
      ||(typeof resp.assistantMessage==='object'&&resp.assistantMessage&&resp.assistantMessage.content)
      ||'मला काही उत्तर मिळाले नाही. दुसऱ्या शब्दांत विचारा.';
    c.innerHTML+='<div class="chat-msg bot"><div class="mr">MAULI</div><div>'+md(txt)+'</div></div>';
    const qr=(resp.response&&resp.response.quickReplies)||resp.quickReplies;if(qr)addQuickReplies(qr);c.scrollTop=c.scrollHeight
  }catch(e){rmTyping();c.innerHTML+='<div class="chat-msg bot" style="border-color:var(--red)"><div class="mr">Error</div>'+esc(e.message||'Chat failed')+'</div>';c.scrollTop=c.scrollHeight}
}
function addQuickReplies(arr){if(!arr?.length)return;const c=$('chatMsgs');const w=document.createElement('div');w.style.cssText='display:flex;flex-wrap:wrap;gap:4px;padding:4px 0 6px 40px';arr.forEach(r=>{const b=document.createElement('button');b.className='btn btn-a btn-s';b.style.cssText='font-size:10px;padding:3px 8px;border-radius:10px';b.textContent=r;b.onclick=()=>{$('chatIn').value=r;sendChat()};w.appendChild(b)});c.appendChild(w);c.scrollTop=c.scrollHeight}
function addTyping(){const c=$('chatMsgs');const d=document.createElement('div');d.className='chat-msg bot';d.id='typing';d.innerHTML='<div class="mr">MAULI</div><div style="display:flex;gap:3px;padding:4px 0"><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite"></span><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite .2s"></span><span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pulse 1s infinite .4s"></span></div>';c.appendChild(d);c.scrollTop=c.scrollHeight}
function rmTyping(){const e=$('typing');if(e)e.remove()}

// ─── SELF TEST / DIAG ───
async function runTest(){try{const r=await api('/api/self-test');const d=r.result||r;let h='<span class="badge badge-'+(d.status==='ready'?'g':d.status==='degraded'?'y':'r')+'">'+d.status.toUpperCase()+' — '+d.score+'%</span>';
  for(const c of(d.checks||[]))h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="color:'+(c.passed?'var(--green)':'var(--red)')+'">'+(c.passed?'✅':'❌')+'</span><span style="font-size:12px">'+esc(c.name)+'</span><span style="font-size:10px;color:var(--text3);margin-left:auto">'+esc(c.details||'')+'</span></div>';
  $('testRes').innerHTML=h;toast('Test: '+d.status,d.status==='ready'?'ok':'info')}catch(e){$('testRes').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}

// ─── DOCS ───
async function genDocs(){toast('Generating...','info');const proj=S.projects[S.projects.length-1];if(!proj){$('docsOut').innerHTML='<div style="color:var(--text2)">No projects yet</div>';return}try{const r=await api('/api/docs/'+encodeURIComponent(proj.id));$('docsOut').innerHTML='<pre style="font-size:11px;white-space:pre-wrap;font-family:monospace;background:var(--bg1);padding:12px;border-radius:8px;max-height:500px;overflow:auto">'+esc(JSON.stringify(r.docs||r,null,2))+'</pre>';toast('Done','ok')}catch(e){$('docsOut').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}

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
  h+='<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:12px">'+esc(p.name||p.objective||p.id)+'</b><div style="font-size:10px;color:var(--text2)">'+esc(p.state)+' · '+esc(platLabel(p.platform))+'</div></div><div style="display:flex;gap:4px">';
  // Build for the platform the founder commissioned, not a hard-coded pair of buttons.
  // Android gets an APK, desktop gets an EXE, and the web has nothing to package.
  const bplat=p.platform||'web';
  const bicon={android:'📱 APK',ios:'📱 IPA',desktop:'🖥️ EXE'}[bplat];
  if(hasCode&&bicon)h+='<button class="btn btn-a btn-s bld-btn" data-pid="'+p.id+'" data-plat="'+esc(bplat)+'">'+bicon+'</button>';
  else if(hasCode)h+='<span class="badge badge-g">🌐 Web</span>';
  else h+='<span class="badge badge-y">No code</span>';
  h+='</div></div>'}
  $('buildOut').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>'}

// ─── MESSAGING ───
async function loadMsgs(){try{const r=await api('/api/messages');const msgs=r.messages||r||[];let h='';for(const m of(Array.isArray(msgs)?msgs:[]).slice(-20).reverse()){const c=m.type==='alert'?'r':m.type==='review'?'y':'a';
  // The stored record uses the canonical fields {fromAgentId,toAgentId,body,subject}; the old
  // renderer read the dashboard's own short names {from,to,content}, so every real message
  // printed as "— → —" with an empty body even after it had been sent.
  const from=m.fromAgentId||m.from||'—';const to=m.toAgentId||m.to||'—';const text=m.body||m.content||m.message||'';const subj=m.subject&&m.subject!=='Untitled'?('<b>'+esc(m.subject)+'</b> '):'';
  h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(from)+' → '+esc(to)+'</b><span class="badge badge-'+c+'">'+esc(m.type||'info')+'</span></div><div style="font-size:11px;margin-top:2px">'+subj+esc(text)+'</div></div>'}
  $('msgList').innerHTML=h||'<div style="color:var(--text2);padding:10px">No messages</div>';
  const opts=S.agents.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name||a.id)+'</option>').join('');
  if($('msgFrom'))$('msgFrom').innerHTML='<option value="">From...</option>'+opts;if($('msgTo'))$('msgTo').innerHTML='<option value="">To...</option>'+opts;
  }catch(e){$('msgList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}
async function sendMsg(){const f=$('msgFrom').value,t=$('msgTo').value,b=$('msgBody').value.trim();if(!f||!t||!b){toast('Fill all','err');return}try{await api('/api/messages/send',{method:'POST',body:JSON.stringify({from:f,to:t,content:b,type:'info'})});toast('Sent','ok');$('msgBody').value='';loadMsgs()}catch(e){toast(e.message,'err')}}
async function bcastMsg(){const b=$('msgBody').value.trim();if(!b){toast('Enter message','err');return}try{await api('/api/messages/broadcast',{method:'POST',body:JSON.stringify({content:b,type:'alert'})});toast('Sent','ok');$('msgBody').value='';loadMsgs()}catch(e){toast(e.message,'err')}}

// ─── API EXPLORER ───
async function searchApi(){const q=$('apiQ').value.trim();if(!q){toast('Enter query','err');return}try{const r=await api('/api/apis/search?q='+encodeURIComponent(q));const apis=r.apis||r.results||r||[];let h='';for(const a of(Array.isArray(apis)?apis:[]))h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">'+esc(a.name||a.title||'—')+'</b><span class="badge badge-g">'+esc(a.category||'API')+'</span></div><div style="font-size:10px;color:var(--text2)">'+esc(a.description||'')+'</div>'+(a.url?'<a href="'+esc(a.url)+'" target="_blank" style="font-size:10px">🔗 Docs</a>':'')+'</div>';
  $('apiRes').innerHTML=h||'<div style="color:var(--text2)">No results</div>'}catch(e){$('apiRes').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>'}}
async function loadMcp(){try{const r=await api('/api/mcp/servers');
  // The endpoint ships the servers as an object keyed by slug, NOT an array — /api/integrations
  // already wraps it in Object.values for exactly this reason. Reading it as an array iterated
  // nothing and the MCP card stayed permanently empty. Accept either shape.
  const raw=r.servers||r;const srv=Array.isArray(raw)?raw:Object.values(raw||{}).filter(s=>s&&typeof s==='object');
  let h=srv.length?('<div style="font-size:10px;color:var(--text3);padding:2px 0 8px">'+srv.length+' MCP server'+(srv.length===1?'':'s')+'</div>'):'<div style="color:var(--text2);padding:2px 0">No MCP servers</div>';
  for(const s of srv)h+='<div style="padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><b style="font-size:12px">🔌 '+esc(s.name||s.id||'—')+'</b><span class="badge badge-a">'+esc(s.category||'MCP')+'</span></div><div style="font-size:10px;color:var(--text2)">'+esc(s.description||'')+'</div></div>';
  setHtml($('mcpOut'),h)}catch(e){setHtml($('mcpOut'),'<div style="color:var(--red)">'+esc(e.message)+'</div>')}}

// ─── DOWNLOADS ───
function loadDl(){let h='';for(const p of S.projects){const hasCode=S.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
  h+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3);display:flex;align-items:center;justify-content:space-between"><div style="flex:1"><b style="font-size:13px">'+esc(p.name||p.objective||p.id)+'</b><div style="font-size:10px;color:var(--text2);margin-top:2px"><span class="badge badge-'+badge(p.state)+'">'+esc(p.state)+'</span>'+(p.taskCount?' · '+p.taskCount+' tasks':'')+' · '+esc(platLabel(p.platform))+'</div></div>';
  if(hasCode)h+='<button class="btn btn-g btn-s dl-btn" data-pid="'+p.id+'">📥 Download</button>';
  else h+='<span style="font-size:10px;color:var(--text3)">No code</span>';
  h+='</div>'}
  $('dlList').innerHTML=h||'<div style="text-align:center;padding:20px;color:var(--text2)">No projects</div>'}
async function downloadZip(pid){try{toast('Loading...','info');const r=await fetch('/api/app-files?projectId='+encodeURIComponent(pid),{headers:window.__mauliFounderHeaders?window.__mauliFounderHeaders({}):{}});if(!r.ok){toast('No files','err');return}const d=await r.json();const files=d.files||[];if(!files.length){toast('No files','err');return}
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

// Groq status is painted on load — the founder should not have to open a page to learn
// whether the fallback provider's key arrived.
loadGroqChip();

// Paint the platform selector immediately, then reconcile it with the server's list so
// the founder can pick a target before typing anything.
renderPlatforms();
loadPlatforms();

// Fire-and-forget API calls
fetch('/api/heartbeat',{cache:'no-store'}).then(r=>r.json()).then(j=>{
  if(j.ok||j.data){if($('hText'))$('hText').textContent='System Online';if($('hDot'))$('hDot').classList.remove('off')}
}).catch(()=>{});

setInterval(()=>{
  fetch('/api/heartbeat',{cache:'no-store'}).then(r=>r.json()).then(j=>{
    if(j.ok||j.data){if($('hText'))$('hText').textContent='System Online';if($('hDot'))$('hDot').classList.remove('off')}
  }).catch(()=>{});
},60000);

// Clock
setInterval(()=>{if($('clock'))$('clock').textContent=new Date().toLocaleTimeString()},1000);
if($('clock'))$('clock').textContent=new Date().toLocaleTimeString();
</script>
</body>
</html>`;
}
