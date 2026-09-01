export function dashboardHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAULI 2.0 — AI Command Center</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg-0:#060a14;--bg-1:#0b1120;--bg-2:#111a2e;--bg-3:#182240;
  --border:#1e2d4a;--border-light:#293b64;--border-glow:rgba(0,212,255,.15);
  --text:#e8ecf4;--text-muted:#8899bb;--text-dim:#556688;
  --accent:#00d4ff;--accent-2:#7c5cff;--accent-3:#ff6b9d;
  --green:#22c55e;--green-bg:rgba(34,197,94,.12);
  --yellow:#eab308;--yellow-bg:rgba(234,179,8,.12);
  --red:#ef4444;--red-bg:rgba(239,68,68,.12);
  --blue:#3b82f6;--blue-bg:rgba(59,130,246,.12);
  --cyan-bg:rgba(0,212,255,.08);
  --radius:12px;--radius-sm:8px;--radius-lg:16px;
  --shadow:0 4px 24px rgba(0,0,0,.4);
  --shadow-lg:0 8px 48px rgba(0,0,0,.6);
  --transition:all .2s cubic-bezier(.4,0,.2,1);
  --glass:rgba(11,17,32,.7);
  --glass-border:rgba(30,45,74,.5);
}
html{font-size:15px}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg-0);color:var(--text);line-height:1.6;min-height:100vh;overflow-x:hidden}
a{color:var(--accent);text-decoration:none}
::selection{background:var(--accent);color:var(--bg-0)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg-1)}
::-webkit-scrollbar-thumb{background:var(--border-light);border-radius:3px}
.bg-canvas{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.bg-gradient{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;
  background:radial-gradient(ellipse at 20% 50%,rgba(0,212,255,.04) 0%,transparent 50%),
  radial-gradient(ellipse at 80% 20%,rgba(124,92,255,.04) 0%,transparent 50%),
  radial-gradient(ellipse at 50% 80%,rgba(255,107,157,.03) 0%,transparent 50%);
  animation:bgShift 20s ease-in-out infinite alternate}
@keyframes bgShift{0%{opacity:.6;filter:hue-rotate(0deg)}50%{opacity:1;filter:hue-rotate(10deg)}100%{opacity:.7;filter:hue-rotate(-5deg)}}
.grid-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;
  background-image:linear-gradient(rgba(0,212,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,.03) 1px,transparent 1px);
  background-size:60px 60px;animation:gridMove 30s linear infinite}
@keyframes gridMove{0%{transform:translate(0,0)}100%{transform:translate(60px,60px)}}
.layout{display:flex;min-height:100vh;position:relative;z-index:1}
.sidebar{width:260px;background:var(--glass);backdrop-filter:blur(20px);border-right:1px solid var(--glass-border);position:fixed;top:0;left:0;bottom:0;z-index:100;display:flex;flex-direction:column;transition:transform .3s ease}
.sidebar-header{padding:20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
.sidebar-brand{display:flex;align-items:center;gap:10px}
.sidebar-logo{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:var(--bg-0);box-shadow:0 0 20px rgba(0,212,255,.3)}
.sidebar-title{font-size:14px;font-weight:700;letter-spacing:.5px}
.sidebar-sub{font-size:11px;color:var(--text-muted);margin-top:2px}
.sidebar-nav{flex:1;padding:12px 8px;overflow-y:auto}
.nav-section{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);padding:14px 12px 6px;display:flex;align-items:center;gap:8px}
.nav-section::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:var(--transition);font-size:13px;color:var(--text-muted);position:relative}
.nav-item:hover{background:var(--bg-2);color:var(--text)}
.nav-item.active{background:var(--cyan-bg);color:var(--accent);font-weight:600}
.nav-item.active::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:20px;background:var(--accent);border-radius:0 3px 3px 0;box-shadow:0 0 8px var(--accent)}
.nav-icon{width:18px;text-align:center;font-size:14px;flex-shrink:0}
.nav-badge{margin-left:auto;background:var(--accent-2);color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600}
.nav-badge.live{animation:badgePulse 2s infinite}
@keyframes badgePulse{0%,100%{box-shadow:0 0 0 0 rgba(124,92,255,.4)}50%{box-shadow:0 0 0 4px rgba(124,92,255,0)}}
.main{flex:1;margin-left:260px;min-height:100vh}
.topbar{position:sticky;top:0;z-index:50;background:rgba(6,10,20,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between}
.topbar-left{display:flex;align-items:center;gap:12px}
.topbar-title{font-size:15px;font-weight:600}
.topbar-right{display:flex;align-items:center;gap:12px}
.topbar-status{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite;box-shadow:0 0 6px var(--green)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.status-dot.dead{background:var(--red);animation:pulse-fast .5s infinite;box-shadow:0 0 6px var(--red)}
@keyframes pulse-fast{0%,100%{opacity:1}50%{opacity:.2}}
.topbar-time{font-size:12px;color:var(--text-dim);font-variant-numeric:tabular-nums}
.shortcut-hint{font-size:10px;color:var(--text-dim);background:var(--bg-3);padding:3px 8px;border-radius:4px;border:1px solid var(--border);cursor:pointer;transition:var(--transition)}
.shortcut-hint:hover{border-color:var(--accent);color:var(--accent)}
.content{padding:24px 28px 40px}
.page{display:none;animation:fadeIn .3s ease}
.page.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.card{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px;transition:var(--transition)}
.card:hover{border-color:var(--border-light);box-shadow:0 4px 16px rgba(0,0,0,.2)}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.card-title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
.card-subtitle{font-size:12px;color:var(--text-muted)}
.card-body{position:relative}
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-5{grid-template-columns:repeat(5,1fr)}
.grid-auto{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
@media(max-width:900px){.grid-2,.grid-3,.grid-4,.grid-5{grid-template-columns:1fr}}
.stat{text-align:center;padding:20px;position:relative;overflow:hidden}
.stat::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:60px;height:2px;background:linear-gradient(90deg,transparent,var(--accent),transparent);border-radius:1px}
.stat-value{font-size:32px;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.2}
.stat-label{font-size:12px;color:var(--text-muted);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
.stat-icon{font-size:24px;margin-bottom:8px;opacity:.7}
.btn{padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-3);color:var(--text);font-size:13px;cursor:pointer;transition:var(--transition);font-weight:500;display:inline-flex;align-items:center;gap:6px}
.btn:hover{border-color:var(--border-light);transform:translateY(-1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));border:none;color:#fff;font-weight:600;box-shadow:0 2px 12px rgba(0,212,255,.3)}
.btn-primary:hover{box-shadow:0 4px 20px rgba(0,212,255,.4);transform:translateY(-2px)}
.btn-green{background:var(--green-bg);border-color:rgba(34,197,94,.3);color:var(--green)}
.btn-red{background:var(--red-bg);border-color:rgba(239,68,68,.3);color:var(--red)}
.btn-accent{background:var(--cyan-bg);border-color:rgba(0,212,255,.3);color:var(--accent)}
.btn-sm{padding:5px 10px;font-size:11px}
.input{width:100%;padding:10px 14px;background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-size:14px;font-family:inherit;transition:var(--transition)}
.input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,212,255,.1)}
textarea.input{min-height:100px;resize:vertical;font-family:'JetBrains Mono',monospace;font-size:13px}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600}
.badge-green{background:var(--green-bg);color:var(--green)}
.badge-red{background:var(--red-bg);color:var(--red)}
.badge-yellow{background:var(--yellow-bg);color:var(--yellow)}
.badge-blue{background:var(--blue-bg);color:var(--blue)}
.badge-accent{background:var(--cyan-bg);color:var(--accent)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text-dim);padding:10px 12px;border-bottom:1px solid var(--border)}
td{padding:10px 12px;border-bottom:1px solid rgba(30,45,74,.3);font-size:13px}
.agent-card{position:relative;overflow:hidden}
.agent-card::after{content:'';position:absolute;top:0;right:0;width:80px;height:80px;background:radial-gradient(circle,var(--accent-2),transparent);opacity:.05;border-radius:0 0 0 80px}
.agent-avatar{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.agent-name{font-weight:600;font-size:14px}
.agent-role{font-size:11px;color:var(--text-muted);margin-top:2px}
.agent-status{display:flex;align-items:center;gap:6px;margin-top:8px}
.agent-skill-bar{height:4px;background:var(--bg-3);border-radius:2px;flex:1;overflow:hidden}
.agent-skill-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .5s ease}
.activity-item{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(30,45,74,.3)}
.activity-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0}
.activity-text{font-size:13px;flex:1}
.activity-time{font-size:11px;color:var(--text-dim);flex-shrink:0}
.progress-bar{height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden}
.progress-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .5s ease}
.progress-fill.done{background:var(--green)}
.progress-fill.error{background:var(--red)}
.chat-container{display:flex;flex-direction:column;height:calc(100vh - 160px)}
.chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
.chat-msg{max-width:80%;padding:12px 16px;border-radius:12px;font-size:13px;line-height:1.5;animation:msgIn .2s ease}
@keyframes msgIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
.chat-msg.user{align-self:flex-end;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;border-bottom-right-radius:4px}
.chat-msg.mauli{align-self:flex-start;background:var(--bg-2);border:1px solid var(--border);border-bottom-left-radius:4px}
.chat-msg .msg-role{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;opacity:.7}
.chat-input-wrap{display:flex;gap:8px;padding:16px;border-top:1px solid var(--border);background:var(--bg-1)}
.chat-input-wrap .input{flex:1}
.monitor-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.monitor-card{background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;transition:var(--transition)}
.monitor-card.active{border-color:var(--accent);box-shadow:0 0 12px rgba(0,212,255,.1)}
.monitor-label{font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px}
.monitor-value{font-size:20px;font-weight:700;margin-top:4px}
.palette-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.6);z-index:1000;display:none;align-items:flex-start;justify-content:center;padding-top:15vh;backdrop-filter:blur(4px)}
.palette-overlay.show{display:flex}
.palette-panel{background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius-lg);width:560px;box-shadow:var(--shadow-lg);overflow:hidden}
.palette-input{width:100%;padding:16px 20px;background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-size:16px;font-family:inherit}
.palette-input:focus{outline:none}
.palette-results{max-height:320px;overflow-y:auto}
.palette-item{padding:10px 20px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:var(--transition)}
.palette-item:hover,.palette-item.selected{background:var(--cyan-bg)}
.palette-item-icon{font-size:16px;width:24px;text-align:center}
.palette-item-text{font-size:13px;flex:1}
.palette-item-shortcut{font-size:11px;color:var(--text-dim)}
.toast-container{position:fixed;top:20px;right:20px;z-index:2000;display:flex;flex-direction:column;gap:8px}
.toast{padding:12px 20px;border-radius:var(--radius-sm);font-size:13px;font-weight:500;animation:toastIn .3s ease;display:flex;align-items:center;gap:8px;box-shadow:var(--shadow-lg)}
.toast.success{background:var(--green-bg);border:1px solid rgba(34,197,94,.3);color:var(--green)}
.toast.error{background:var(--red-bg);border:1px solid rgba(239,68,68,.3);color:var(--red)}
.toast.info{background:var(--blue-bg);border:1px solid rgba(59,130,246,.3);color:var(--blue)}
@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
.empty{text-align:center;padding:40px 20px}
.empty-icon{font-size:48px;margin-bottom:12px;opacity:.5}
.empty-text{font-size:14px;color:var(--text-muted)}
.loading{display:none;padding:20px;text-align:center}
.loading.show{display:block}
.spinner{width:24px;height:24px;border:3px solid var(--bg-3);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite;margin:0 auto}
@keyframes spin{to{transform:rotate(360deg)}}
::-webkit-scrollbar-thumb:hover{background:var(--accent);box-shadow:0 0 8px rgba(0,212,255,.3)}
@media(max-width:768px){.sidebar{transform:translateX(-100%)}.sidebar.open{transform:translateX(0)}.main{margin-left:0}.grid-4,.grid-5{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<canvas class="bg-canvas" id="bgCanvas"></canvas>
<div class="bg-gradient"></div>
<div class="grid-overlay"></div>
<div class="layout">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <div class="sidebar-logo">M</div>
        <div><div class="sidebar-title">MAULI 2.0</div><div class="sidebar-sub">AI Command Center</div></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section">Command</div>
      <div class="nav-item active" data-page="command"><span class="nav-icon">⚡</span>Command Center</div>
      <div class="nav-item" data-page="chat"><span class="nav-icon">💬</span>Chat with MAULI</div>
      <div class="nav-section">Intelligence</div>
      <div class="nav-item" data-page="overview"><span class="nav-icon">📊</span>Overview</div>
      <div class="nav-item" data-page="agents"><span class="nav-icon">🤖</span>Agent Hive<span class="nav-badge live" id="nav-agent-count">0</span></div>
      <div class="nav-item" data-page="monitor"><span class="nav-icon">📡</span>Live Monitor</div>
      <div class="nav-section">Workspace</div>
      <div class="nav-item" data-page="projects"><span class="nav-icon">📁</span>Projects<span class="nav-badge" id="nav-project-count">0</span></div>
      <div class="nav-item" data-page="tasks"><span class="nav-icon">📋</span>Tasks<span class="nav-badge" id="nav-task-count">0</span></div>
      <div class="nav-item" data-page="docs"><span class="nav-icon">📚</span>Documentation</div>
      <div class="nav-section">Governance</div>
      <div class="nav-item" data-page="approvals"><span class="nav-icon">🛡️</span>Approvals<span class="nav-badge" id="nav-approval-count" style="background:var(--yellow)">0</span></div>
      <div class="nav-section">System</div>
      <div class="nav-item" data-page="activity"><span class="nav-icon">📡</span>Activity Feed</div>
      <div class="nav-item" data-page="health"><span class="nav-icon">💚</span>System Health</div>
      <div class="nav-item" data-page="memory"><span class="nav-icon">🧠</span>Memory Bank</div>
      <div class="nav-item" data-page="integrations"><span class="nav-icon">🔗</span>Integrations</div>
      <div class="nav-section">Tools</div>
      <div class="nav-item" data-page="editor"><span class="nav-icon">✏️</span>File Editor</div>
      <div class="nav-item" data-page="changelog"><span class="nav-icon">📝</span>Change History</div>
      <div class="nav-item" data-page="learning"><span class="nav-icon">🎓</span>Learning & Skills</div>
      <div class="nav-item" data-page="builds"><span class="nav-icon">🔨</span>Build Manager</div>
      <div class="nav-item" data-page="subagents"><span class="nav-icon">🤖</span>Sub-Agents</div>
      <div class="nav-item" data-page="messaging"><span class="nav-icon">💌</span>Messaging</div>
      <div class="nav-item" data-page="apiexplorer"><span class="nav-icon">🌐</span>API Explorer</div>
      <div class="nav-section">Settings</div>
      <div class="nav-item" data-page="shortcuts"><span class="nav-icon">⌨️</span>Shortcuts</div>
      <div class="nav-item" onclick="clearKey()"><span class="nav-icon">🔑</span>Reset API Key</div>
    </nav>
  </aside>
  <div class="main">
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-status"><span class="status-dot" id="heartbeatDot"></span><span id="heartbeatText">Connecting...</span></div>
        <span class="topbar-title" id="pageTitle">Command Center</span>
      </div>
      <div class="topbar-right">
        <span class="shortcut-hint" onclick="togglePalette()" title="Command Palette (Ctrl+K)">⌘K</span>
        <span class="topbar-time" id="topbarTime"></span>
      </div>
    </header>
    <div class="content">
      <div class="page active" id="page-command">
        <div class="grid grid-4" style="margin-bottom:20px">
          <div class="card stat"><div class="stat-icon">📁</div><div class="stat-value" id="stat-projects">0</div><div class="stat-label">Projects</div></div>
          <div class="card stat"><div class="stat-icon">📋</div><div class="stat-value" id="stat-tasks">0</div><div class="stat-label">Tasks</div></div>
          <div class="card stat"><div class="stat-icon">🤖</div><div class="stat-value" id="stat-agents">0</div><div class="stat-label">Agents</div></div>
          <div class="card stat"><div class="stat-icon">📦</div><div class="stat-value" id="stat-artifacts">0</div><div class="stat-label">Artifacts</div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">⚡ Founder Command</div><div class="card-subtitle">Tell MAULI what to build</div></div>
          <div class="card-body">
            <textarea class="input" id="cmdInput" placeholder="Example: Build a weather app for Android with live forecasts, radar maps, and severe weather alerts..." rows="4"></textarea>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn btn-primary" id="sendCmd" onclick="sendCommand()">⚡ Execute Command</button>
              <span class="loading" id="cmdLoading"><span class="spinner"></span></span>
            </div>
            <pre class="card" id="cmdResult" style="display:none;margin-top:12px;font-size:12px;max-height:300px;overflow:auto;font-family:'JetBrains Mono',monospace;background:var(--bg-1)"></pre>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🚀 Quick Actions</div></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Build a weather app for Android')">🌤️ Weather App</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Create an e-commerce platform')">🛒 E-Commerce</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Build a calculator app')">🔢 Calculator</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Create a music player app')">🎵 Music Player</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Build a chat application')">💬 Chat App</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Create a PDF report generator')">📄 PDF Generator</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Build a task management system')">✅ Task Manager</button>
            <button class="btn btn-sm btn-accent" onclick="quickCmd('Create a portfolio website')">🌐 Portfolio</button>
          </div>
        </div>
      </div>
      <div class="page" id="page-chat">
        <div class="card" style="padding:0;overflow:hidden;height:calc(100vh - 140px)">
          <div class="chat-container">
            <div class="chat-messages" id="chatMessages">
              <div class="chat-msg mauli"><div class="msg-role">MAULI</div>Hello! I'm MAULI 2.0, your AI command center. Tell me what you want to build and I'll create it for you.</div>
            </div>
            <div class="chat-input-wrap">
              <input class="input" id="chatInput" placeholder="Type a message or command..." onkeydown="if(event.key==='Enter')sendChat()">
              <button class="btn btn-primary" onclick="sendChat()">Send</button>
            </div>
          </div>
        </div>
      </div>
      <div class="page" id="page-overview">
        <div class="grid grid-5" style="margin-bottom:20px">
          <div class="card stat"><div class="stat-icon">📁</div><div class="stat-value" id="ov-projects">0</div><div class="stat-label">Projects</div></div>
          <div class="card stat"><div class="stat-icon">✅</div><div class="stat-value" id="ov-completed">0</div><div class="stat-label">Completed</div></div>
          <div class="card stat"><div class="stat-icon">⚡</div><div class="stat-value" id="ov-active">0</div><div class="stat-label">Active</div></div>
          <div class="card stat"><div class="stat-icon">🤖</div><div class="stat-value" id="ov-agents">0</div><div class="stat-label">Agents</div></div>
          <div class="card stat"><div class="stat-icon">📦</div><div class="stat-value" id="ov-artifacts">0</div><div class="stat-label">Artifacts</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card"><div class="card-header"><div class="card-title">📈 Activity Feed</div></div><div id="overviewActivity" style="max-height:400px;overflow-y:auto"></div></div>
          <div class="card"><div class="card-header"><div class="card-title">🛡️ System Health</div></div><div id="healthInfo"></div></div>
        </div>
      </div>
      <div class="page" id="page-agents"><div class="grid grid-auto" id="agentsList"></div></div>
      <div class="page" id="page-monitor">
        <div class="card">
          <div class="card-header"><div class="card-title">📡 Real-Time System Monitor</div><button class="btn btn-sm btn-accent" onclick="refreshMonitor()">↻ Refresh</button></div>
          <div class="monitor-grid" id="monitorGrid"></div>
        </div>
        <div class="grid grid-2">
          <div class="card"><div class="card-header"><div class="card-title">🤖 Agent Activity</div></div><div id="agentActivity" style="max-height:400px;overflow-y:auto"></div></div>
          <div class="card"><div class="card-header"><div class="card-title">📊 Task Progress</div></div><div id="taskProgress" style="max-height:400px;overflow-y:auto"></div></div>
        </div>
      </div>
      <div class="page" id="page-projects">
        <div class="card">
          <div class="card-header"><div class="card-title">📁 All Projects</div><div class="card-subtitle" id="projectCount">0 projects</div></div>
          <div id="projectsList"></div>
        </div>
      </div>
      <div class="page" id="page-tasks">
        <div class="card">
          <div class="card-header"><div class="card-title">📋 Task Overview</div><div class="card-subtitle" id="taskCount">0 tasks</div></div>
          <div id="tasksList"></div>
        </div>
      </div>
      <div class="page" id="page-docs">
        <div class="card">
          <div class="card-header"><div class="card-title">📚 Auto-Generated Documentation</div><button class="btn btn-sm btn-accent" onclick="generateDocs()">📄 Generate Docs</button></div>
          <div id="docsContent"><div class="empty"><div class="empty-icon">📚</div><div class="empty-text">Select a project to generate documentation</div></div></div>
        </div>
      </div>
      <div class="page" id="page-approvals">
        <div class="card"><div class="card-header"><div class="card-title">🛡️ Pending Approvals</div></div><div id="approvalsList"></div></div>
      </div>
      <div class="page" id="page-activity">
        <div class="card">
          <div class="card-header"><div class="card-title">📡 Full Activity Log</div><button class="btn btn-sm btn-accent" onclick="loadState()">↻ Refresh</button></div>
          <div id="activityList" style="max-height:600px;overflow-y:auto"></div>
        </div>
      </div>
      <div class="page" id="page-health">
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><div class="card-title">💚 System Health</div><button class="btn btn-sm btn-green" onclick="runSelfTest()">▶ Run Self-Test</button></div>
            <div id="healthDetail"></div><div id="selfTestResult" style="margin-top:12px"></div>
          </div>
          <div class="card"><div class="card-header"><div class="card-title">🔧 Tools</div></div><div id="toolsList"></div></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🔍 Diagnostics</div><button class="btn btn-sm btn-accent" onclick="runDiagnostic()">▶ Run Diagnostic</button></div>
          <div id="diagResult"></div>
        </div>
      </div>
      <div class="page" id="page-memory">
        <div class="card"><div class="card-header"><div class="card-title">🧠 Company Memory</div></div><div id="memoryList" style="max-height:600px;overflow-y:auto"></div></div>
      </div>
      <div class="page" id="page-integrations">
        <div class="card"><div class="card-header"><div class="card-title">🔗 Active Integrations</div></div><div class="grid grid-3" id="integrationsList"></div></div>
        <div class="card"><div class="card-header"><div class="card-title">🌐 API Catalog</div></div><div id="apiCatalog"></div></div>
      </div>
      <div class="page" id="page-shortcuts">
      <div class="page" id="page-editor">
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header"><div class="card-title">✏️ File Editor</div><button class="btn btn-sm btn-accent" onclick="loadRecentEdits()">↻ Refresh</button></div>
            <div style="margin-bottom:12px">
              <select class="input" id="editorProject" style="margin-bottom:8px" onchange="loadProjectFiles(this.value)"><option value="">Select project...</option></select>
              <input class="input" id="editorFile" placeholder="File path (e.g. src/index.js)" style="margin-bottom:8px">
              <textarea class="input" id="editorContent" rows="12" placeholder="File content..."></textarea>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary" onclick="saveFile()">💾 Save File</button>
              <button class="btn btn-accent" onclick="loadFile()">📂 Load File</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">📋 Recent Edits</div></div>
            <div id="recentEditsList" style="max-height:500px;overflow-y:auto"></div>
          </div>
        </div>
      </div>
      <div class="page" id="page-changelog">
        <div class="card">
          <div class="card-header"><div class="card-title">📝 Change History</div><button class="btn btn-sm btn-accent" onclick="loadChangeHistory()">↻ Refresh</button></div>
          <div id="changeHistoryList" style="max-height:600px;overflow-y:auto"></div>
        </div>
      </div>
      <div class="page" id="page-learning">
        <div class="grid grid-3" style="margin-bottom:16px">
          <div class="card stat"><div class="stat-icon">🎓</div><div class="stat-value" id="learn-tasks">0</div><div class="stat-label">Tasks Learned</div></div>
          <div class="card stat"><div class="stat-icon">⭐</div><div class="stat-value" id="learn-patterns">0</div><div class="stat-label">Patterns Found</div></div>
          <div class="card stat"><div class="stat-icon">🧬</div><div class="stat-value" id="learn-skills">0</div><div class="stat-label">Skills Tracked</div></div>
        </div>
        <div class="grid grid-2">
          <div class="card"><div class="card-header"><div class="card-title">🌳 Skill Tree</div></div><div id="skillTreeList" style="max-height:400px;overflow-y:auto"></div></div>
          <div class="card"><div class="card-header"><div class="card-title">📊 Learning Stats</div></div><div id="learningStatsList" style="max-height:400px;overflow-y:auto"></div></div>
        </div>
      </div>
      <div class="page" id="page-builds">
        <div class="card">
          <div class="card-header"><div class="card-title">🔨 Build Manager</div><button class="btn btn-sm btn-accent" onclick="loadBuildStatus()">↻ Refresh</button></div>
          <div id="buildManagerList" style="max-height:600px;overflow-y:auto"></div>
        </div>
      </div>
      <div class="page" id="page-subagents">
        <div class="card">
          <div class="card-header"><div class="card-title">🤖 Sub-Agent System</div><button class="btn btn-sm btn-accent" onclick="loadSubAgents()">↻ Refresh</button></div>
          <div id="subAgentsList" style="max-height:600px;overflow-y:auto"></div>
        </div>
      </div>
      <div class="page" id="page-messaging">
        <div class="card">
          <div class="card-header"><div class="card-title">💌 Agent Messaging</div><button class="btn btn-sm btn-accent" onclick="loadMessages()">↻ Refresh</button></div>
          <div id="messagesList" style="max-height:500px;overflow-y:auto"></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">📤 Send Message</div></div>
          <div>
            <select class="input" id="msgFrom" style="margin-bottom:8px"><option value="">From agent...</option></select>
            <select class="input" id="msgTo" style="margin-bottom:8px"><option value="">To agent...</option></select>
            <textarea class="input" id="msgContent" rows="3" placeholder="Message content..." style="margin-bottom:8px"></textarea>
            <div style="display:flex;gap:8px">
              <button class="btn btn-primary" onclick="sendAgentMessage()">📤 Send</button>
              <button class="btn btn-accent" onclick="broadcastMessage()">📡 Broadcast</button>
            </div>
          </div>
        </div>
      </div>
      <div class="page" id="page-apiexplorer">
        <div class="card">
          <div class="card-header"><div class="card-title">🌐 API Explorer</div></div>
          <div style="margin-bottom:12px;display:flex;gap:8px">
            <input class="input" id="apiSearchQ" placeholder="Search APIs (e.g. weather, finance...)" style="flex:1">
            <button class="btn btn-primary" onclick="searchAPIs()">🔍 Search</button>
          </div>
          <div id="apiSearchResults" style="max-height:400px;overflow-y:auto"></div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">🔌 MCP Servers</div></div>
          <div id="mcpServersList" style="max-height:400px;overflow-y:auto"></div>
        </div>
      </div>
        <div class="card">
          <div class="card-header"><div class="card-title">⌨️ Keyboard Shortcuts</div></div>
          <div class="card-body">
            <div style="margin-bottom:16px"><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Navigation</div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Open Command Palette</span><div style="display:flex;gap:4px"><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">Ctrl+K</kbd></div></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Command Center</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">1</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Chat</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">2</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Overview</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">3</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Agents</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">4</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Monitor</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">5</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Projects</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">6</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Tasks</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">7</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Activity</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">8</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0"><span>Health</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">9</kbd></div></div>
            <div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:8px">Actions</div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Send Command</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">Ctrl+↵</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span>Refresh Data</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">R</kbd></div>
            <div style="display:flex;justify-content:space-between;padding:8px 0"><span>Help</span><kbd style="background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;font-family:'JetBrains Mono',monospace;color:var(--accent)">?</kbd></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="palette-overlay" id="paletteOverlay" onclick="if(event.target===this)togglePalette()">
  <div class="palette-panel">
    <input class="palette-input" id="paletteInput" placeholder="Type a command..." oninput="filterPalette(this.value)">
    <div class="palette-results" id="paletteResults"></div>
  </div>
</div>
<div class="toast-container" id="toastContainer"></div>
<script>
const STATE={projects:[],tasks:[],artifacts:[],agents:[],events:[],approvals:[],tools:[]};
const $=id=>document.getElementById(id);
async function getKey(){return localStorage.getItem('mauli-api-key')}
async function setKey(k){localStorage.setItem('mauli-api-key',k)}
function clearKey(){localStorage.removeItem('mauli-api-key');toast('API key cleared','info')}
async function api(path,opts={}){
  const k=await getKey();if(!k){const pk=prompt('Enter MAULI API Key:');if(!pk)throw new Error('No key');await setKey(pk);return api(path,opts)}
  const headers={'Content-Type':'application/json','Authorization':'Bearer '+k,...(opts.headers||{})};
  const r=await fetch(path,{...opts,headers});
  if(!r.ok){const t=await r.text();throw new Error(t||r.status)}
  return r.json();
}
function toast(msg,type='info'){
  const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;
  $('toastContainer').appendChild(el);setTimeout(()=>el.remove(),4000);
}
(function initBg(){
  const c=$('bgCanvas');if(!c)return;const ctx=c.getContext('2d');
  let w,h,particles=[];
  function resize(){w=c.width=window.innerWidth;h=c.height=window.innerHeight}
  function createParticles(){
    particles=[];const count=Math.min(60,Math.floor(w*h/25000));
    for(let i=0;i<count;i++){particles.push({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,r:Math.random()*2+1,a:Math.random()*.3+.1})}
  }
  function draw(){
    ctx.clearRect(0,0,w,h);
    for(const p of particles){
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=w;if(p.x>w)p.x=0;if(p.y<0)p.y=h;if(p.y>h)p.y=0;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(0,212,255,'+p.a+')';ctx.fill();
    }
    for(let i=0;i<particles.length;i++){
      for(let j=i+1;j<particles.length;j++){
        const dx=particles[i].x-particles[j].x;const dy=particles[i].y-particles[j].y;const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<120){ctx.beginPath();ctx.moveTo(particles[i].x,particles[i].y);ctx.lineTo(particles[j].x,particles[j].y);ctx.strokeStyle='rgba(0,212,255,'+(0.08*(1-dist/120))+')';ctx.lineWidth=.5;ctx.stroke()}
      }
    }
    requestAnimationFrame(draw);
  }
  resize();createParticles();draw();window.addEventListener('resize',()=>{resize();createParticles()});
})();
let currentPage='command';
const pageTitles={command:'Command Center',chat:'Chat with MAULI',overview:'Overview',agents:'Agent Hive',monitor:'Live Monitor',projects:'Projects',tasks:'Tasks',docs:'Documentation',approvals:'Approvals',activity:'Activity Feed',health:'System Health',memory:'Memory Bank',integrations:'Integrations',shortcuts:'Keyboard Shortcuts',editor:'File Editor',changelog:'Change History',learning:'Learning shortcuts:'Keyboard Shortcuts'}; Skills',builds:'Build Manager',subagents:'Sub-Agents',messaging:'Agent Messaging',apiexplorer:'API Explorer'};
function navigateTo(page){
  currentPage=page;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg=$('page-'+page);if(pg)pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const navEl=document.querySelector('.nav-item[data-page="'+page+'"]');if(navEl)navEl.classList.add('active');
  $('pageTitle').textContent=pageTitles[page]||page;
  if(page==='overview')renderOverview();if(page==='agents')renderAgents();if(page==='projects')renderProjects();
  if(page==='tasks')renderTasks();if(page==='activity')renderActivity();if(page==='health')renderHealth();
  if(page==='memory')renderMemory();if(page==='monitor')renderMonitor();if(page==='integrations')renderIntegrations();if(page==='learning')renderLearning();if(page==='editor')loadRecentEdits();if(page==='changelog')loadChangeHistory();if(page==='builds')loadBuildStatus();if(page==='subagents')loadSubAgents();if(page==='messaging')loadMessages();if(page==='apiexplorer')loadMCPServers();
}
document.querySelectorAll('.nav-item[data-page]').forEach(el=>{el.addEventListener('click',()=>navigateTo(el.dataset.page))});
const navPages=['command','chat','overview','agents','monitor','projects','tasks','docs','approvals','activity','health','memory','integrations','editor','changelog','learning','builds','subagents','messaging','apiexplorer','shortcuts'];
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();togglePalette();return}
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){const page=document.querySelector('.page.active');if(page?.id==='page-command')sendCommand();return}
  if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&document.activeElement.tagName!=='INPUT'&&document.activeElement.tagName!=='TEXTAREA'){
    const num=parseInt(e.key);if(num>=1&&num<=navPages.length){navigateTo(navPages[num-1]);return}
    if(e.key==='r'||e.key==='R'){e.preventDefault();loadState();return}
  }
});
const paletteCommands=[
  {icon:'⚡',text:'Command Center',action:()=>navigateTo('command'),shortcut:'1'},
  {icon:'💬',text:'Chat with MAULI',action:()=>navigateTo('chat'),shortcut:'2'},
  {icon:'📊',text:'Overview',action:()=>navigateTo('overview'),shortcut:'3'},
  {icon:'🤖',text:'Agent Hive',action:()=>navigateTo('agents'),shortcut:'4'},
  {icon:'📡',text:'Live Monitor',action:()=>navigateTo('monitor'),shortcut:'5'},
  {icon:'📁',text:'Projects',action:()=>navigateTo('projects'),shortcut:'6'},
  {icon:'📋',text:'Tasks',action:()=>navigateTo('tasks'),shortcut:'7'},
  {icon:'📚',text:'Documentation',action:()=>navigateTo('docs')},
  {icon:'🛡️',text:'Approvals',action:()=>navigateTo('approvals')},
  {icon:'📡',text:'Activity Feed',action:()=>navigateTo('activity'),shortcut:'8'},
  {icon:'💚',text:'System Health',action:()=>navigateTo('health'),shortcut:'9'},
  {icon:'🧠',text:'Memory Bank',action:()=>navigateTo('memory')},
  {icon:'🔗',text:'Integrations',action:()=>navigateTo('integrations')},
  {icon:'↻',text:'Refresh All Data',action:()=>loadState(),shortcut:'R'},
  {icon:'▶',text:'Run Self-Test',action:()=>{navigateTo('health');setTimeout(runSelfTest,300)}},
  {icon:'🔍',text:'Run Diagnostic',action:()=>{navigateTo('health');setTimeout(runDiagnostic,300)}},
  {icon:'🔑',text:'Reset API Key',action:clearKey},
  {icon:'✏️',text:'File Editor',action:()=>navigateTo('editor')},
  {icon:'📝',text:'Change History',action:()=>navigateTo('changelog')},
  {icon:'🎓',text:'Learning & Skills',action:()=>navigateTo('learning')},
  {icon:'🔨',text:'Build Manager',action:()=>navigateTo('builds')},
  {icon:'🤖',text:'Sub-Agents',action:()=>navigateTo('subagents')},
  {icon:'💌',text:'Agent Messaging',action:()=>navigateTo('messaging')},
  {icon:'🌐',text:'API Explorer',action:()=>navigateTo('apiexplorer')},
];
function togglePalette(){const o=$('paletteOverlay');o.classList.toggle('show');if(o.classList.contains('show')){$('paletteInput').value='';$('paletteInput').focus();filterPalette('')}}
function filterPalette(q){const results=paletteCommands.filter(c=>c.text.toLowerCase().includes(q.toLowerCase()));$('paletteResults').innerHTML=results.map((c,i)=>'<div class="palette-item'+(i===0?' selected':'')+'" onclick="paletteSelect('+paletteCommands.indexOf(c)+')"><span class="palette-item-icon">'+c.icon+'</span><span class="palette-item-text">'+c.text+'</span>'+(c.shortcut?'<span class="palette-item-shortcut"><kbd>'+c.shortcut+'</kbd></span>':'')+'</div>').join('')}
function paletteSelect(i){paletteCommands[i]?.action();$('paletteOverlay').classList.remove('show')}
$('paletteInput')?.addEventListener('keydown',e=>{const items=document.querySelectorAll('.palette-item');const sel=document.querySelector('.palette-item.selected');let idx=[...items].indexOf(sel);if(e.key==='ArrowDown'){e.preventDefault();if(sel)sel.classList.remove('selected');if(idx<items.length-1)idx++;items[idx]?.classList.add('selected')}else if(e.key==='ArrowUp'){e.preventDefault();if(sel)sel.classList.remove('selected');if(idx>0)idx--;items[idx]?.classList.add('selected')}else if(e.key==='Enter'&&sel){sel.click()}else if(e.key==='Escape'){$('paletteOverlay').classList.remove('show')}});
async function loadState(){
  try{const result=await api('/api/state');const d=result.data||result;
    STATE.projects=d.projects||[];STATE.tasks=d.tasks||[];STATE.artifacts=d.artifacts||[];STATE.agents=d.agents||[];STATE.events=d.events||[];
    STATE.approvals=(d.approvals||[]).filter(a=>a.state==='pending');STATE.tools=d.tools||[];
    updateStats();renderCurrentPage();
  }catch(e){console.error('Load state error:',e)}
}
function updateStats(){
  const completed=STATE.projects.filter(p=>p.state==='completed').length;const active=STATE.projects.filter(p=>p.state==='active').length;
  $('stat-projects').textContent=STATE.projects.length;$('stat-tasks').textContent=STATE.tasks.length;
  $('stat-agents').textContent=STATE.agents.length;$('stat-artifacts').textContent=STATE.artifacts.length;
  if($('ov-projects'))$('ov-projects').textContent=STATE.projects.length;if($('ov-completed'))$('ov-completed').textContent=completed;
  if($('ov-active'))$('ov-active').textContent=active;if($('ov-agents'))$('ov-agents').textContent=STATE.agents.length;
  if($('ov-artifacts'))$('ov-artifacts').textContent=STATE.artifacts.length;
  $('nav-agent-count').textContent=STATE.agents.length;$('nav-project-count').textContent=STATE.projects.length;
  $('nav-task-count').textContent=STATE.tasks.filter(t=>t.state==='working').length||STATE.tasks.length;
  $('nav-approval-count').textContent=STATE.approvals.length;
  if($('projectCount'))$('projectCount').textContent=STATE.projects.length+' projects';
  if($('taskCount'))$('taskCount').textContent=STATE.tasks.length+' tasks';
}
function renderCurrentPage(){navigateTo(currentPage)}
function renderOverview(){
  const events=STATE.events.slice(-20).reverse();let html='';
  for(const ev of events){
    const color=ev.type?.includes('error')?'var(--red)':ev.type?.includes('task_result')?'var(--green)':ev.type?.includes('command')?'var(--accent)':'var(--blue)';
    html+='<div class="activity-item"><div class="activity-dot" style="background:'+color+'"></div><div class="activity-text"><strong>'+esc(ev.type||'event')+'</strong></div><div class="activity-time">'+fmtDate(ev.at)+'</div></div>';
  }
  $('overviewActivity').innerHTML=html||'<div class="empty"><div class="empty-text">No recent activity</div></div>';
  loadHealth();
}
function renderAgents(){
  let html='';
  for(const a of STATE.agents){
    const skills=a.skills||a.capabilities||[];const skillPct=Math.min(100,((a.tasksCompleted||0)*10+50));
    html+='<div class="card agent-card"><div style="display:flex;gap:12px;align-items:flex-start"><div class="agent-avatar" style="background:var(--bg-3)">'+(a.emoji||'🤖')+'</div><div style="flex:1"><div class="agent-name">'+esc(a.name||a.id)+'</div><div class="agent-role">'+esc(a.role||a.type||'Agent')+'</div><div class="agent-status"><span class="badge badge-green">Active</span></div></div></div><div style="margin-top:12px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:var(--text-dim)">Skill Level</span><span style="font-size:11px;color:var(--accent)">'+skillPct+'%</span></div><div class="agent-skill-bar"><div class="agent-skill-fill" style="width:'+skillPct+'%"></div></div></div><div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">'+skills.map(s=>'<span class="badge badge-accent" style="font-size:9px">'+esc(s)+'</span>').join('')+'</div></div>';
  }
  $('agentsList').innerHTML=html||'<div class="empty"><div class="empty-icon">🤖</div><div class="empty-text">No agents registered yet</div></div>';
}
function renderProjects(){
  let html='<div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Tasks</th><th>Actions</th></tr></thead><tbody>';
  for(const p of STATE.projects){
    const badge=stateBadge(p.state);const hasCode=STATE.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
    html+='<tr><td><strong>'+esc(p.name||p.objective||p.id)+'</strong></td><td><span class="badge badge-'+badge+'">'+esc(p.state)+'</span></td><td>'+(p.taskCount||'—')+'</td><td style="display:flex;gap:4px">';
    html+='<button class="btn btn-sm btn-accent download-btn" data-path="/api/download/'+p.id+'">📥 ZIP</button>';
    if(hasCode){html+='<button class="btn btn-sm btn-green build-btn" data-project="'+p.id+'" data-platform="android">📱 APK</button><button class="btn btn-sm btn-accent build-btn" data-project="'+p.id+'" data-platform="desktop">🖥️ EXE</button>'}
    html+='</td></tr>';
  }
  html+='</tbody></table></div>';
  $('projectsList').innerHTML=html||'<div class="empty"><div class="empty-icon">📁</div><div class="empty-text">No projects yet. Send a founder command!</div></div>';
}
function renderTasks(){
  let html='<div class="table-wrap"><table><thead><tr><th>Task</th><th>Status</th><th>Agent</th><th>Progress</th></tr></thead><tbody>';
  for(const t of STATE.tasks.slice(-50).reverse()){
    html+='<tr><td>'+esc(t.title||t.id)+'</td><td><span class="badge badge-'+taskBadge(t.state)+'">'+esc(t.state)+'</span></td><td style="font-size:12px;color:var(--text-muted)">'+esc(t.agentId||'—')+'</td><td><div class="progress-bar" style="width:100px"><div class="progress-fill'+(t.state==='completed'?' done':t.state==='failed'?' error':'')+'" style="width:'+progressPct(t.state)+'%"></div></div></td></tr>';
  }
  html+='</tbody></table></div>';
  $('tasksList').innerHTML=html||'<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No tasks yet</div></div>';
}
function renderActivity(){
  let html='';for(const ev of STATE.events.slice(-50).reverse()){
    const color=ev.type?.includes('error')?'var(--red)':ev.type?.includes('task_result')?'var(--green)':ev.type?.includes('command')?'var(--accent)':'var(--blue)';
    const payload=typeof ev.payload==='object'?JSON.stringify(ev.payload,null,2):String(ev.payload||'');
    html+='<div class="activity-item"><div class="activity-dot" style="background:'+color+'"></div><div style="flex:1"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><strong style="font-size:13px">'+esc(ev.type||'event')+'</strong><span class="activity-time">'+fmtDate(ev.at)+'</span></div><pre style="font-size:11px;color:var(--text-muted);white-space:pre-wrap;word-break:break-all;max-height:80px;overflow:hidden;font-family:\'JetBrains Mono\',monospace">'+esc(payload)+'</pre></div></div>';
  }
  $('activityList').innerHTML=html||'<div class="empty"><div class="empty-icon">📡</div><div class="empty-text">No activity yet</div></div>';
}
function renderHealth(){loadHealth();renderTools()}
function loadHealth(){
  api('/api/health').then(h=>{
    let html=healthRow('Service',h.service||'—')+healthRow('Status','<span style="color:var(--green)">'+esc(h.status||'unknown')+'</span>')+healthRow('D1 Persistence',h.persistence?'<span style="color:var(--green)">Connected</span>':'<span style="color:var(--yellow)">Memory Only</span>')+healthRow('Hydrated',h.hydrated?'<span style="color:var(--green)">Yes</span>':'<span style="color:var(--text-dim)">No</span>')+healthRow('AI Binding',h.ai?'<span style="color:var(--green)">Available</span>':'<span style="color:var(--yellow)">Unavailable</span>')+healthRow('Recovered Runs',h.recoveredRuns||0)+healthRow('Time',fmtDate(h.time));
    if($('healthDetail'))$('healthDetail').innerHTML=html;if($('healthInfo'))$('healthInfo').innerHTML=html;
  }).catch(e=>{if($('healthDetail'))$('healthDetail').innerHTML='<div style="color:var(--red)">Failed: '+esc(e.message)+'</div>'});
}
function healthRow(label,value){return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:12px;color:var(--text-muted)">'+label+'</span><span style="font-size:12px">'+value+'</span></div>';}
function renderTools(){
  let html='';for(const tool of STATE.tools){
    html+='<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="font-size:14px">🔧</span><div style="flex:1"><strong style="font-size:13px">'+esc(tool.name)+'</strong><div style="font-size:11px;color:var(--text-dim)">'+esc(tool.description||'')+'</div></div><span class="badge badge-'+(tool.risk==='read'?'green':tool.risk==='write'?'yellow':'red')+'">'+esc(tool.risk)+'</span></div>';
  }
  $('toolsList').innerHTML=html||'<div class="empty"><div class="empty-text">No tools registered</div></div>';
}
function renderMemory(){
  const events=STATE.events.filter(e=>e.type&&e.type.includes('memory')).slice(-20).reverse();
  const memEvents=STATE.events.filter(e=>e.type&&(e.type.includes('task_result')||e.type.includes('solution')||e.type.includes('error')||e.type.includes('project_requirement')||e.type.includes('command'))).slice(-20).reverse();
  const all=[...events,...memEvents].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,30);
  let html='';for(const ev of all){
    const payload=typeof ev.payload==='object'?JSON.stringify(ev.payload,null,2):String(ev.payload||'');
    html+='<div style="padding:12px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><span class="badge badge-accent" style="font-size:10px">'+esc(ev.type)+'</span><span style="font-size:11px;color:var(--text-dim)">'+fmtDate(ev.at)+'</span></div><pre style="font-size:11px;color:var(--text-muted);margin-top:6px;white-space:pre-wrap;word-break:break-all;max-height:100px;overflow:hidden;font-family:\'JetBrains Mono\',monospace">'+esc(payload)+'</pre></div>';
  }
  $('memoryList').innerHTML=html||'<div class="empty"><div class="empty-icon">🧠</div><div class="empty-text">No memory entries yet</div></div>';
}
function renderMonitor(){refreshMonitor()}
function refreshMonitor(){
  const grid=[
    {label:'Projects',value:STATE.projects.length,icon:'📁',active:true},
    {label:'Tasks',value:STATE.tasks.length,icon:'📋',active:STATE.tasks.some(t=>t.state==='working')},
    {label:'Agents',value:STATE.agents.length,icon:'🤖',active:true},
    {label:'Artifacts',value:STATE.artifacts.length,icon:'📦',active:STATE.artifacts.length>0},
    {label:'Working',value:STATE.tasks.filter(t=>t.state==='working').length,icon:'⚡',active:STATE.tasks.some(t=>t.state==='working')},
    {label:'Completed',value:STATE.tasks.filter(t=>t.state==='completed').length,icon:'✅',active:true},
    {label:'Failed',value:STATE.tasks.filter(t=>t.state==='failed').length,icon:'❌',active:STATE.tasks.some(t=>t.state==='failed')},
    {label:'Events',value:STATE.events.length,icon:'📡',active:STATE.events.length>0},
  ];
  $('monitorGrid').innerHTML=grid.map(g=>'<div class="monitor-card'+(g.active?' active':'')+'"><div class="monitor-label">'+g.icon+' '+g.label+'</div><div class="monitor-value">'+g.value+'</div></div>').join('');
  $('agentActivity').innerHTML=STATE.agents.map(a=>'<div class="activity-item"><div class="activity-dot" style="background:var(--green)"></div><div class="activity-text"><strong>'+esc(a.name||a.id)+'</strong> — '+esc(a.role||a.type||'Agent')+'</div></div>').join('')||'<div class="empty"><div class="empty-text">No active agents</div></div>';
  $('taskProgress').innerHTML=STATE.tasks.slice(-10).reverse().map(t=>'<div style="padding:8px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:12px">'+esc(t.title||t.id)+'</span><span class="badge badge-'+taskBadge(t.state)+'" style="font-size:10px">'+esc(t.state)+'</span></div><div class="progress-bar"><div class="progress-fill'+(t.state==='completed'?' done':'')+'" style="width:'+progressPct(t.state)+'%"></div></div></div>').join('')||'<div class="empty"><div class="empty-text">No tasks</div></div>';
}
function renderIntegrations(){
  const ints=[
    {name:'GitHub',icon:'🐙',status:'Connected',desc:'Source control & CI/CD'},
    {name:'Cloudflare Workers',icon:'☁️',status:'Deployed',desc:'Production hosting'},
    {name:'Cloudflare AI',icon:'🧠',status:'Active',desc:'LLM inference'},
    {name:'Cloudflare D1',icon:'💾',status:'Connected',desc:'SQL database'},
    {name:'public-apis',icon:'📡',status:'Integrated',desc:'1400+ free APIs'},
    {name:'MCP Servers',icon:'🔌',status:'Integrated',desc:'Agent tools'},
    {name:'OpenDesign',icon:'🎨',status:'Integrated',desc:'Design systems'},
    {name:'Ollama',icon:'🤖',status:'Optional',desc:'Local LLMs'},
  ];
  $('integrationsList').innerHTML=ints.map(i=>{const color=i.status==='Connected'||i.status==='Active'||i.status==='Deployed'||i.status==='Integrated'?'green':'yellow';return '<div class="card" style="margin-bottom:0"><div style="display:flex;align-items:center;gap:12px"><span style="font-size:28px">'+i.icon+'</span><div><div style="font-weight:600">'+esc(i.name)+'</div><div style="font-size:11px;color:var(--text-muted)">'+esc(i.desc)+'</div></div><span class="badge badge-'+color+'" style="margin-left:auto">'+i.status+'</span></div></div>'}).join('');
  $('apiCatalog').innerHTML='<div style="padding:12px 0">'+['Weather','Finance','Maps','Music','News','Sports','Health','Education','Entertainment','Science'].map(a=>'<span class="badge badge-accent" style="margin:2px">'+a+'</span>').join('')+'</div>';
}
async function sendCommand(){

/* ═══ FILE EDITOR ═══ */
async function loadRecentEdits(){
  try{const r=await api('/api/edits/recent',{auth:true});
    const edits=r.edits||r||[];let html='';
    for(const e of (Array.isArray(edits)?edits:[])){
      html+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">'+esc(e.filePath||e.file||'—')+'</strong><span class="badge badge-accent" style="font-size:10px">'+esc(e.operation||e.type||'edit')+'</span></div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">'+esc(e.description||e.summary||'')+'</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">'+fmtDate(e.at||e.timestamp)+'</div></div>';
    }
    $('recentEditsList').innerHTML=html||'<div class="empty"><div class="empty-text">No recent edits</div></div>';
  }catch(e){$('recentEditsList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
async function loadProjectFiles(projectId){
  if(!projectId)return;
  try{const r=await api('/api/state',{auth:true});const d=r.data||r;
    const artifacts=(d.artifacts||[]).filter(a=>a.projectId===projectId&&a.type==='code-workspace');
    if(artifacts.length>0){$('editorFile').value=artifacts[0].path||'www/index.html';}
  }catch(e){}
}
async function loadFile(){
  const path=$('editorFile').value.trim();if(!path){toast('Enter a file path','error');return}
  try{const r=await api('/api/edits?filePath='+encodeURIComponent(path),{auth:true});
    $('editorContent').value=r.content||r.code||JSON.stringify(r,null,2);
    toast('File loaded','success');
  }catch(e){toast('Load failed: '+e.message,'error');}
}
async function saveFile(){
  const path=$('editorFile').value.trim();const content=$('editorContent').value;
  if(!path){toast('Enter a file path','error');return}
  try{await api('/api/edits',{method:'POST',auth:true,body:JSON.stringify({filePath:path,content,operation:'update',description:'Dashboard edit'})});
    toast('File saved!','success');loadRecentEdits();
  }catch(e){toast('Save failed: '+e.message,'error');}
}

/* ═══ CHANGE HISTORY ═══ */
async function loadChangeHistory(){
  try{const r=await api('/api/edits/history',{auth:true});
    const history=r.history||r.edits||r||[];let html='';
    for(const h of (Array.isArray(history)?history:[])){
      const color=h.operation==='create'?'green':h.operation==='delete'?'red':'accent';
      html+='<div class="activity-item"><div class="activity-dot" style="background:var(--'+color+')"></div><div style="flex:1"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">'+esc(h.filePath||h.file||'—')+'</strong><span class="badge badge-'+color+'" style="font-size:10px">'+esc(h.operation||'edit')+'</span></div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">'+esc(h.description||'')+'</div><div style="font-size:10px;color:var(--text-dim)">'+fmtDate(h.at||h.timestamp)+'</div></div></div>';
    }
    $('changeHistoryList').innerHTML=html||'<div class="empty"><div class="empty-icon">📝</div><div class="empty-text">No change history yet</div></div>';
  }catch(e){$('changeHistoryList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}

/* ═══ LEARNING & SKILLS ═══ */
async function renderLearning(){
  try{const r=await api('/api/learning/stats',{auth:true});const s=r.stats||r||{};
    if($('learn-tasks'))$('learn-tasks').textContent=s.tasksLearned||s.totalTasks||0;
    if($('learn-patterns'))$('learn-patterns').textContent=s.patternsFound||s.patterns||0;
    if($('learn-skills'))$('learn-skills').textContent=s.skillsTracked||s.skills||0;
    let html='';
    const stats=s.categoryStats||s.categories||s;
    for(const [k,v] of Object.entries(stats||{})){
      if(typeof v==='object'&&v!==null){
        html+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">'+esc(k)+'</strong><span class="badge badge-accent">'+(v.count||v.tasks||0)+'</span></div></div>';
      }
    }
    $('learningStatsList').innerHTML=html||'<div class="empty"><div class="empty-text">No learning data yet</div></div>';
  }catch(e){$('learningStatsList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
  try{const r=await api('/api/learning/skill-tree',{auth:true});const tree=r.skillTree||r||{};
    let html='';
    for(const [agent,skills] of Object.entries(tree)){
      html+='<div style="padding:12px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="font-weight:600;font-size:13px;margin-bottom:6px">🤖 '+esc(agent)+'</div>';
      for(const [skill,level] of Object.entries(skills||{})){
        const pct=Math.min(100,(typeof level==='number'?level:level?.level||level?.xp||0));
        html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span style="font-size:11px;color:var(--text-muted);min-width:100px">'+esc(skill)+'</span><div class="agent-skill-bar" style="flex:1"><div class="agent-skill-fill" style="width:'+pct+'%"></div></div><span style="font-size:10px;color:var(--accent)">'+pct+'%</span></div>';
      }
      html+='</div>';
    }
    $('skillTreeList').innerHTML=html||'<div class="empty"><div class="empty-text">No skills tracked yet</div></div>';
  }catch(e){$('skillTreeList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}

/* ═══ BUILD MANAGER ═══ */
async function loadBuildStatus(){
  try{let html='';
    for(const p of STATE.projects){
      const hasCode=STATE.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace');
      html+='<div style="padding:12px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:13px">'+esc(p.name||p.objective||p.id)+'</strong><div style="font-size:11px;color:var(--text-muted)">'+esc(p.state)+'</div></div><div style="display:flex;gap:6px">';
      if(hasCode){
        html+='<button class="btn btn-sm btn-green build-btn" data-project="'+p.id+'" data-platform="android">📱 APK</button>';
        html+='<button class="btn btn-sm btn-accent build-btn" data-project="'+p.id+'" data-platform="desktop">🖥️ EXE</button>';
      }else{
        html+='<span class="badge badge-yellow" style="font-size:10px">No code artifacts</span>';
      }
      html+='</div></div></div>';
    }
    $('buildManagerList').innerHTML=html||'<div class="empty"><div class="empty-icon">🔨</div><div class="empty-text">No projects to build</div></div>';
  }catch(e){$('buildManagerList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}

/* ═══ SUB-AGENTS ═══ */
async function loadSubAgents(){
  try{const r=await api('/api/sub-agents',{auth:true});
    const subs=r.subAgents||r.agents||r||[];let html='';
    for(const a of (Array.isArray(subs)?subs:[])){
      html+='<div class="card agent-card" style="margin-bottom:0"><div style="display:flex;gap:12px;align-items:flex-start"><div class="agent-avatar" style="background:var(--bg-3)">🤖</div><div style="flex:1"><div class="agent-name">'+esc(a.name||a.id||'Sub-Agent')+'</div><div class="agent-role">'+esc(a.parentAgent||a.parent||'—')+'</div><div class="agent-status"><span class="badge badge-green">Active</span></div><div style="margin-top:8px;font-size:11px;color:var(--text-muted)">'+esc(a.task||a.description||'')+'</div></div></div></div>';
    }
    $('subAgentsList').innerHTML=html||'<div class="empty"><div class="empty-icon">🤖</div><div class="empty-text">No sub-agents active. Agents create helpers automatically for complex tasks.</div></div>';
  }catch(e){$('subAgentsList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}

/* ═══ MESSAGING ═══ */
async function loadMessages(){
  try{const r=await api('/api/messages',{auth:true});
    const msgs=r.messages||r||[];let html='';
    for(const m of (Array.isArray(msgs)?msgs:[]).slice(-30).reverse()){
      const color=m.type==='alert'?'red':m.type==='review'?'yellow':'accent';
      html+='<div class="activity-item"><div class="activity-dot" style="background:var(--'+color+')"></div><div style="flex:1"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">'+esc(m.from||'—')+' → '+esc(m.to||'—')+'</strong><span class="badge badge-'+color+'" style="font-size:10px">'+esc(m.type||'info')+'</span></div><div style="font-size:12px;margin-top:4px">'+esc(m.content||m.message||'')+'</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px">'+fmtDate(m.at||m.timestamp)+'</div></div></div>';
    }
    $('messagesList').innerHTML=html||'<div class="empty"><div class="empty-icon">💌</div><div class="empty-text">No messages yet</div></div>';
    // Populate agent dropdowns
    const opts=STATE.agents.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name||a.id)+'</option>').join('');
    if($('msgFrom'))$('msgFrom').innerHTML='<option value="">From agent...</option>'+opts;
    if($('msgTo'))$('msgTo').innerHTML='<option value="">To agent...</option>'+opts;
  }catch(e){$('messagesList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
async function sendAgentMessage(){
  const from=$('msgFrom').value,to=$('msgTo').value,content=$('msgContent').value.trim();
  if(!from||!to||!content){toast('Fill all fields','error');return}
  try{await api('/api/messages/send',{method:'POST',auth:true,body:JSON.stringify({from,to,content,type:'info'})});
    toast('Message sent!','success');$('msgContent').value='';loadMessages();
  }catch(e){toast('Send failed: '+e.message,'error');}
}
async function broadcastMessage(){
  const content=$('msgContent').value.trim();if(!content){toast('Enter a message','error');return}
  try{await api('/api/messages/broadcast',{method:'POST',auth:true,body:JSON.stringify({content,type:'alert'})});
    toast('Broadcast sent!','success');$('msgContent').value='';loadMessages();
  }catch(e){toast('Broadcast failed: '+e.message,'error');}
}

/* ═══ API EXPLORER ═══ */
async function searchAPIs(){
  const q=$('apiSearchQ').value.trim();if(!q){toast('Enter a search term','error');return}
  try{const r=await api('/api/apis/search?q='+encodeURIComponent(q),{auth:true});
    const apis=r.apis||r.results||r||[];let html='';
    for(const a of (Array.isArray(apis)?apis:[])){
      html+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">'+esc(a.name||a.title||'—')+'</strong><span class="badge badge-green" style="font-size:10px">'+esc(a.category||'API')+'</span></div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">'+esc(a.description||a.desc||'')+'</div>'+(a.url?'<a href="'+esc(a.url)+'" target="_blank" style="font-size:11px;margin-top:4px;display:inline-block">🔗 Docs</a>':'')+'</div>';
    }
    $('apiSearchResults').innerHTML=html||'<div class="empty"><div class="empty-text">No APIs found for "'+esc(q)+'"</div></div>';
  }catch(e){$('apiSearchResults').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
async function loadMCPServers(){
  try{const r=await api('/api/mcp/servers',{auth:true});
    const servers=r.servers||r||[];let html='';
    for(const s of (Array.isArray(servers)?servers:[])){
      html+='<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="display:flex;justify-content:space-between"><strong style="font-size:13px">🔌 '+esc(s.name||s.id||'—')+'</strong><span class="badge badge-accent" style="font-size:10px">'+esc(s.category||'MCP')+'</span></div><div style="font-size:11px;color:var(--text-muted);margin-top:4px">'+esc(s.description||s.desc||'')+'</div></div>';
    }
    $('mcpServersList').innerHTML=html||'<div class="empty"><div class="empty-text">No MCP servers available</div></div>';
  }catch(e){$('mcpServersList').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}

  const input=$('cmdInput');const cmd=input.value.trim();
  if(!cmd){toast('Enter a founder command first','error');return}
  $('sendCmd').disabled=true;$('cmdLoading').classList.add('show');$('cmdResult').style.display='none';
  try{const result=await api('/api/command',{method:'POST',auth:true,body:JSON.stringify({command:cmd})});
    $('cmdResult').style.display='block';$('cmdResult').textContent=JSON.stringify(result.result||result,null,2);
    toast('Command executed!','success');input.value='';await loadState();
  }catch(e){$('cmdResult').style.display='block';$('cmdResult').textContent='Error: '+e.message;toast('Failed: '+e.message,'error');
    if(e.message.includes('authorization')||e.message.includes('401')){clearKey();toast('Key cleared','info')}
  }finally{$('sendCmd').disabled=false;$('cmdLoading').classList.remove('show')}
}
function quickCmd(cmd){$('cmdInput').value=cmd;sendCommand()}
async function sendChat(){
  const input=$('chatInput');const msg=input.value.trim();if(!msg)return;
  const container=$('chatMessages');
  container.innerHTML+='<div class="chat-msg user"><div class="msg-role">You</div>'+esc(msg)+'</div>';
  input.value='';container.scrollTop=container.scrollHeight;
  try{const result=await api('/api/chat',{method:'POST',auth:true,body:JSON.stringify({message:msg})});
    container.innerHTML+='<div class="chat-msg mauli"><div class="msg-role">MAULI</div>'+esc(result.reply||result.message||JSON.stringify(result,null,2))+'</div>';
    container.scrollTop=container.scrollHeight;
  }catch(e){container.innerHTML+='<div class="chat-msg mauli" style="border-color:var(--red)"><div class="msg-role">Error</div>'+esc(e.message)+'</div>';container.scrollTop=container.scrollHeight}
}
async function runSelfTest(){
  try{const result=await api('/api/self-test',{auth:true});const r=result.result||result;
    let html='<div style="margin-bottom:8px"><span class="badge badge-'+(r.status==='ready'?'green':r.status==='degraded'?'yellow':'red')+'">'+r.status.toUpperCase()+' — '+r.score+'%</span></div>';
    for(const c of (r.checks||[])){html+='<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(30,45,74,.3)"><span style="color:'+(c.passed?'var(--green)':'var(--red)')+'">'+(c.passed?'✅':'❌')+'</span><span style="font-size:13px">'+esc(c.name)+'</span><span style="font-size:11px;color:var(--text-dim);margin-left:auto">'+esc(c.details||'')+'</span></div>'}
    $('selfTestResult').innerHTML=html;toast('Self-test: '+r.status,r.status==='ready'?'success':'info');
  }catch(e){$('selfTestResult').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
async function runDiagnostic(){
  try{const result=await api('/api/result-diagnostic',{auth:true});const r=result.result||result;
    let html=healthRow('Token',r.tokenConfigured?'<span style="color:var(--green)">Yes</span>':'<span style="color:var(--red)">No</span>');
    if(r.repo)html+=healthRow('Repository',r.repo);if(r.path)html+=healthRow('Path',r.path);
    html+=healthRow('Status',r.ok?'<span style="color:var(--green)">OK</span>':'<span style="color:var(--red)">Issue</span>');
    $('diagResult').innerHTML=html;toast('Diagnostics complete','success');
  }catch(e){$('diagResult').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
async function generateDocs(){
  toast('Generating docs...','info');
  try{const result=await api('/api/docs/generate',{method:'POST',auth:true,body:JSON.stringify({})});
    $('docsContent').innerHTML='<pre style="font-size:12px;white-space:pre-wrap;font-family:\'JetBrains Mono\',monospace;background:var(--bg-1);padding:16px;border-radius:8px;max-height:600px;overflow:auto">'+esc(JSON.stringify(result.docs||result,null,2))+'</pre>';
    toast('Docs generated!','success');
  }catch(e){$('docsContent').innerHTML='<div style="color:var(--red)">'+esc(e.message)+'</div>';}
}
async function downloadZip(path){
  try{toast('Downloading...','info');const k=await getKey();const r=await fetch(path,{headers:{'Authorization':'Bearer '+k}});
    if(!r.ok){toast('Failed: '+r.status,'error');return}const blob=await r.blob();const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='mauli-project.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Downloaded!','success');
  }catch(e){toast('Error: '+e.message,'error');}
}
let activeBuilds={};
async function startBuild(projectId,platform,btn){
  const buildKey=projectId+'_'+platform;if(activeBuilds[buildKey]){toast('Build in progress','info');return}
  btn.disabled=true;btn.textContent='Starting...';
  try{const result=await api('/api/build-app',{method:'POST',auth:true,body:JSON.stringify({projectId,platform})});
    activeBuilds[buildKey]={buildId:result.buildId,startedAt:Date.now()};toast('Build started!','success');btn.textContent='Building...';
    let attempts=0;const poll=async()=>{attempts++;try{const status=await api('/api/build-status/'+result.buildId,{auth:true});
      if(status.downloadUrl){btn.textContent='Download '+platform.toUpperCase();btn.disabled=false;btn.onclick=()=>window.open(status.downloadUrl,'_blank');delete activeBuilds[buildKey];toast('Ready!','success');return}
      if(status.status==='failure'||status.status==='error'){btn.textContent='Failed';btn.disabled=false;delete activeBuilds[buildKey];toast('Build failed','error');return}
      if(attempts<60)setTimeout(poll,10000);else{btn.textContent='Check GitHub';btn.disabled=false;delete activeBuilds[buildKey]}
    }catch(e){if(attempts<60)setTimeout(poll,10000)}};setTimeout(poll,5000);
  }catch(e){btn.textContent='Build '+platform.toUpperCase();btn.disabled=false;delete activeBuilds[buildKey];toast('Failed: '+e.message,'error')}
}
const buildCache={};
async function checkExistingBuilds(){
  const projectsWithCode=STATE.projects.filter(p=>STATE.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace'));
  for(const p of projectsWithCode){
    try{const result=await api("/api/project-builds/"+p.id,{auth:true});
      if(result.bestAPK){buildCache[p.id]={apk:result.bestAPK,exe:result.bestEXE||null};
        document.querySelectorAll('.build-btn[data-project="'+p.id+'"][data-platform="android"]').forEach(btn=>{btn.textContent='📱 Download APK';btn.classList.remove('btn-green');btn.classList.add('btn-primary');btn.onclick=()=>window.open(result.bestAPK,'_blank')});
        if(result.bestEXE){document.querySelectorAll('.build-btn[data-project="'+p.id+'"][data-platform="desktop"]').forEach(btn=>{btn.textContent='🖥️ Download EXE';btn.classList.remove('btn-accent');btn.classList.add('btn-primary');btn.onclick=()=>window.open(result.bestEXE,'_blank')})}
      }
    }catch(e){}
  }
}
document.addEventListener('click',e=>{const dlBtn=e.target.closest('.download-btn');if(dlBtn)downloadZip(dlBtn.dataset.path);const buildBtn=e.target.closest('.build-btn');if(buildBtn)startBuild(buildBtn.dataset.project,buildBtn.dataset.platform,buildBtn)});
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function stateBadge(s){return s==='completed'?'green':s==='active'?'blue':s==='planning'?'accent':s==='escalated'?'red':'yellow';}
function taskBadge(s){return s==='completed'?'green':s==='working'?'accent':s==='failed'?'red':s==='blocked'?'red':s==='verifying'?'blue':'yellow';}
function progressPct(s){return s==='completed'?'100':s==='working'?'60':s==='failed'?'100':'20';}
function fmtDate(d){if(!d)return '—';try{return new Date(d).toLocaleString()}catch(e){return String(d)}}
function updateClock(){if($('topbarTime'))$('topbarTime').textContent=new Date().toLocaleTimeString()}
setInterval(updateClock,1000);updateClock();
let lastHeartbeat=0,heartbeatFailures=0;
async function checkHeartbeat(){
  try{const r=await fetch('/api/heartbeat',{cache:'no-store'});const j=await r.json();
    if(j.ok){lastHeartbeat=Date.now();heartbeatFailures=0;$('heartbeatDot')?.classList.remove('dead');if($('heartbeatText'))$('heartbeatText').textContent='System Online';}
  }catch(e){heartbeatFailures++;if(heartbeatFailures>=3){$('heartbeatDot')?.classList.add('dead');if($('heartbeatText'))$('heartbeatText').textContent='System Offline';}}
}
setInterval(checkHeartbeat,5000);checkHeartbeat();
loadState().then(()=>checkExistingBuilds());setInterval(()=>{loadState().then(()=>checkExistingBuilds())},8000);
</script>
</body>
</html>`;
}
