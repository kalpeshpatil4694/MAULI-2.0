export function dashboardHTML() {
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MAULI 2.0 — AI Command Center</title>    <style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg-0:#060a14;--bg-1:#0b1120;--bg-2:#111a2e;--bg-3:#182240;
  --border:#1e2d4a;--border-light:#293b64;
  --text:#e8ecf4;--text-muted:#8899bb;--text-dim:#556688;
  --accent:#00d4ff;--accent-2:#7c5cff;--accent-3:#ff6b9d;
  --green:#22c55e;--green-bg:rgba(34,197,94,.12);
  --yellow:#eab308;--yellow-bg:rgba(234,179,8,.12);
  --red:#ef4444;--red-bg:rgba(239,68,68,.12);
  --blue:#3b82f6;--blue-bg:rgba(59,130,246,.12);
  --cyan-bg:rgba(0,212,255,.08);
  --radius:12px;--radius-sm:8px;
  --shadow:0 4px 24px rgba(0,0,0,.4);
  --transition:all .2s ease;
}
html{font-size:15px}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg-0);color:var(--text);line-height:1.6;min-height:100vh;overflow-x:hidden}
a{color:var(--accent);text-decoration:none}
::selection{background:var(--accent);color:var(--bg-0)}

/* SCROLLBAR */
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:var(--bg-1)}
::-webkit-scrollbar-thumb{background:var(--border-light);border-radius:3px}

/* LAYOUT */
.layout{display:flex;min-height:100vh}
.sidebar{width:240px;background:var(--bg-1);border-right:1px solid var(--border);position:fixed;top:0;left:0;bottom:0;z-index:100;display:flex;flex-direction:column;transition:transform .3s ease}
.sidebar-header{padding:20px;border-bottom:1px solid var(--border)}
.sidebar-brand{display:flex;align-items:center;gap:10px}
.sidebar-logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;color:var(--bg-0)}
.sidebar-title{font-size:14px;font-weight:700;letter-spacing:.5px}
.sidebar-sub{font-size:11px;color:var(--text-muted);margin-top:2px}
.sidebar-nav{flex:1;padding:12px 8px;overflow-y:auto}
.nav-section{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-dim);padding:12px 12px 6px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:var(--radius-sm);cursor:pointer;transition:var(--transition);font-size:13px;color:var(--text-muted);position:relative}
.nav-item:hover{background:var(--bg-2);color:var(--text)}
.nav-item.active{background:var(--cyan-bg);color:var(--accent);font-weight:600}
.nav-item.active::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:3px;height:20px;background:var(--accent);border-radius:0 3px 3px 0}
.nav-icon{width:18px;text-align:center;font-size:14px;flex-shrink:0}
.nav-badge{margin-left:auto;background:var(--accent-2);color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600}

.main{flex:1;margin-left:240px;min-height:100vh}
.topbar{position:sticky;top:0;z-index:50;background:rgba(6,10,20,.85);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between}
.topbar-left{display:flex;align-items:center;gap:12px}
.topbar-title{font-size:15px;font-weight:600}
.topbar-right{display:flex;align-items:center;gap:12px}
.topbar-status{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-muted)}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.status-dot.dead{background:var(--red);animation:pulse-fast 0.5s infinite}
@keyframes pulse-fast{0%,100%{opacity:1}50%{opacity:.2}}
.topbar-time{font-size:12px;color:var(--text-dim);font-variant-numeric:tabular-nums}

/* BUILD PROGRESS */
.build-progress{background:var(--bg-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;margin-top:12px}
.build-progress-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.build-progress-label{font-size:12px;font-weight:600;color:var(--accent)}
.build-progress-status{font-size:11px;color:var(--text-muted)}
.build-progress-bar{height:4px;background:var(--bg-3);border-radius:2px;overflow:hidden}
.build-progress-fill{height:100%;border-radius:2px;transition:width 1s ease;background:linear-gradient(90deg,var(--accent),var(--accent-2));animation:progressPulse 1.5s ease-in-out infinite}
@keyframes progressPulse{0%,100%{opacity:1}50%{opacity:.7}}
.build-progress-fill.done{background:var(--green);animation:none}
.build-progress-fill.error{background:var(--red);animation:none}

.content{padding:24px 28px 40px}
.page{display:none}
.page.active{display:block}

/* CARDS */
.card{background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px;transition:var(--transition)}
.card:hover{border-color:var(--border-light)}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.card-title{font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px}
.card-subtitle{font-size:12px;color:var(--text-muted)}
.card-body{position:relative}

/* GRID */
.grid{display:grid;gap:16px}
.grid-2{grid-template-columns:repeat(2,1fr)}
.grid-3{grid-template-columns:repeat(3,1fr)}
.grid-4{grid-template-columns:repeat(4,1fr)}
.grid-auto{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
@media(max-width:900px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}}

/* STAT CARDS */
.stat{text-align:center;padding:20px}
.stat-value{font-size:32px;font-weight:700;background:linear-gradient(135deg,var(--accent),var(--accent-2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.2}
.stat-label{font-size:12px;color:var(--text-muted);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
.stat-icon{font-size:24px;margin-bottom:8px;opacity:.7}

/* AGENT CARDS */
.agent-card{position:relative;overflow:hidden}
.agent-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.agent-card[data-state="available"]::before{background:var(--green)}
.agent-card[data-state="working"]::before{background:var(--accent)}
.agent-card[data-state="blocked"],.agent-card[data-state="escalated"]::before{background:var(--red)}
.agent-card[data-state="assigned"]::before{background:var(--yellow)}
.agent-name{font-weight:600;font-size:14px;margin-bottom:2px}
.agent-role{font-size:12px;color:var(--text-muted);margin-bottom:10px}
.agent-meta{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.agent-dept{font-size:11px;padding:3px 8px;border-radius:6px;background:var(--bg-3);color:var(--text-muted)}
.agent-state{font-size:11px;padding:3px 8px;border-radius:6px;font-weight:600}
.state-available{background:var(--green-bg);color:var(--green)}
.state-working{background:var(--cyan-bg);color:var(--accent)}
.state-assigned{background:var(--yellow-bg);color:var(--yellow)}
.state-blocked,.state-escalated{background:var(--red-bg);color:var(--red)}
.state-offline{background:var(--bg-3);color:var(--text-dim)}
.agent-caps{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.cap-tag{font-size:10px;padding:2px 6px;border-radius:4px;background:var(--bg-3);color:var(--text-dim)}
.agent-score{position:absolute;top:12px;right:12px;font-size:11px;font-weight:700;color:var(--accent);background:var(--bg-0);padding:3px 8px;border-radius:6px}

/* PROGRESS BAR */
.progress-bar{height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden;margin-top:8px}
.progress-fill{height:100%;border-radius:3px;transition:width .6s ease}
.progress-green{background:linear-gradient(90deg,var(--green),#4ade80)}
.progress-blue{background:linear-gradient(90deg,var(--blue),var(--accent))}
.progress-yellow{background:linear-gradient(90deg,var(--yellow),#facc15)}
.progress-red{background:linear-gradient(90deg,var(--red),#f87171)}

/* BUTTONS */
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-2);color:var(--text);font-size:13px;cursor:pointer;transition:var(--transition);font-family:inherit}
.btn:hover{border-color:var(--accent);background:var(--bg-3)}
.btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:var(--bg-0);border:none;font-weight:600}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-green{background:var(--green);color:var(--bg-0);border:none;font-weight:600}
.btn-red{background:var(--red);color:#fff;border:none}
.btn-sm{padding:5px 10px;font-size:11px}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none}

/* INPUTS */
.input,.textarea{width:100%;background:var(--bg-0);border:1px solid var(--border);color:var(--text);border-radius:var(--radius-sm);padding:10px 14px;font-size:13px;font-family:inherit;transition:var(--transition);outline:none}
.input:focus,.textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,212,255,.1)}
.textarea{min-height:100px;resize:vertical;line-height:1.5}

/* BADGES */
.badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:6px;font-weight:600}
.badge-green{background:var(--green-bg);color:var(--green)}
.badge-yellow{background:var(--yellow-bg);color:var(--yellow)}
.badge-red{background:var(--red-bg);color:var(--red)}
.badge-blue{background:var(--blue-bg);color:var(--blue)}
.badge-accent{background:var(--cyan-bg);color:var(--accent)}

/* TASK LIST */
.task-row{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);transition:var(--transition)}
.task-row:last-child{border-bottom:none}
.task-row:hover{background:var(--bg-3)}
.task-title{font-size:13px;font-weight:500;flex:1}
.task-meta{font-size:11px;color:var(--text-dim);display:flex;gap:10px;align-items:center}

/* ACTIVITY FEED */
.event-row{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(30,45,74,.4);font-size:13px}
.event-row:last-child{border-bottom:none}
.event-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0}
.event-content{flex:1}
.event-type{font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
.event-detail{color:var(--text-muted);font-size:12px}
.event-time{font-size:11px;color:var(--text-dim);white-space:nowrap;margin-top:2px}

/* COMMAND CENTER */
.cmd-area{position:relative}
.cmd-result{background:var(--bg-0);border:1px solid var(--border);border-radius:var(--radius-sm);padding:16px;margin-top:12px;font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;line-height:1.6;max-height:400px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;color:var(--text-muted)}
.cmd-loading{display:none;align-items:center;gap:8px;padding:16px;color:var(--accent);font-size:13px}
.cmd-loading.show{display:flex}
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* PROJECT CARD */
.project-card{border-left:3px solid var(--accent-2);position:relative}
.project-name{font-weight:600;font-size:14px;margin-bottom:4px}
.project-obj{font-size:12px;color:var(--text-muted);margin-bottom:12px}
.project-stats{display:flex;gap:16px;font-size:12px;color:var(--text-dim)}
.project-stat{display:flex;align-items:center;gap:4px}

/* APPROVAL CARD */
.approval-card{border-left:3px solid var(--yellow)}
.approval-action{font-size:13px;font-weight:500;margin-bottom:4px}
.approval-meta{font-size:11px;color:var(--text-dim);margin-bottom:10px;display:flex;gap:10px}
.approval-actions{display:flex;gap:8px}

/* HEALTH */
.health-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3);font-size:13px}
.health-row:last-child{border-bottom:none}
.health-label{flex:1;color:var(--text-muted)}
.health-value{font-weight:600}

/* EMPTY STATE */
.empty{text-align:center;padding:40px 20px;color:var(--text-dim)}
.empty-icon{font-size:40px;margin-bottom:12px;opacity:.3}
.empty-text{font-size:14px}

/* TOAST */
.toast-container{position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px}
.toast{padding:12px 20px;border-radius:var(--radius-sm);font-size:13px;font-weight:500;animation:slideIn .3s ease;box-shadow:var(--shadow);max-width:400px}
.toast-success{background:var(--green);color:var(--bg-0)}
.toast-error{background:var(--red);color:#fff}
.toast-info{background:var(--accent);color:var(--bg-0)}
@keyframes slideIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}

/* RESPONSIVE */
@media(max-width:768px){
  .sidebar{transform:translateX(-100%)}
  .sidebar.open{transform:translateX(0)}
  .main{margin-left:0}
  .content{padding:16px}
  .topbar{padding:0 16px}
  .grid-4,.grid-3{grid-template-columns:repeat(2,1fr)}
  .mobile-menu{display:flex!important}
}
.mobile-menu{display:none;align-items:center;justify-content:center;width:36px;height:36px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-2);cursor:pointer;font-size:18px}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99}
.sidebar-overlay.open{display:block}

/* FADE IN */
.fade-in{animation:fadeIn .4s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
</style>
</head>
<body>
<div class="layout">
  <!-- SIDEBAR -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <div class="sidebar-logo">M</div>
        <div>
          <div class="sidebar-title">MAULI 2.0</div>
          <div class="sidebar-sub">AI Command Center</div>
        </div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section">Command</div>
      <div class="nav-item active" data-page="command"><span class="nav-icon">⚡</span>Command Center</div>
      <div class="nav-section">Company</div>
      <div class="nav-item" data-page="overview"><span class="nav-icon">📊</span>Overview</div>
      <div class="nav-item" data-page="agents"><span class="nav-icon">🤖</span>Agent Hive<span class="nav-badge" id="nav-agent-count">0</span></div>
      <div class="nav-item" data-page="projects"><span class="nav-icon">📁</span>Projects<span class="nav-badge" id="nav-project-count">0</span></div>
      <div class="nav-item" data-page="tasks"><span class="nav-icon">📋</span>Tasks<span class="nav-badge" id="nav-task-count">0</span></div>
      <div class="nav-section">Governance</div>
      <div class="nav-item" data-page="approvals"><span class="nav-icon">🛡️</span>Approvals<span class="nav-badge" id="nav-approval-count" style="background:var(--yellow)">0</span></div>
      <div class="nav-section">System</div>
      <div class="nav-item" data-page="activity"><span class="nav-icon">📡</span>Activity</div>
      <div class="nav-item" data-page="health"><span class="nav-icon">💚</span>Health</div>
      <div class="nav-item" data-page="memory"><span class="nav-icon">🧠</span>Memory</div>
      <div class="nav-section">Settings</div>
      <div class="nav-item" onclick="clearKey()"><span class="nav-icon">🔑</span>Reset API Key</div>
    </nav>
  </aside>
  <div class="sidebar-overlay" id="sidebarOverlay"></div>

  <!-- MAIN -->
  <div class="main">
    <div class="topbar">
      <div class="topbar-left">
        <div class="mobile-menu" id="mobileMenuBtn">☰</div>
        <div class="topbar-title" id="pageTitle">Command Center</div>
      </div>
      <div class="topbar-right">
        <div class="topbar-status"><span class="status-dot" id="heartbeatDot"></span><span id="heartbeatText">System Online</span></div>
        <div class="topbar-time" id="topbarTime"></div>
      </div>
    </div>

    <div class="content">
      <!-- COMMAND CENTER PAGE -->
      <div class="page active" id="page-command">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">⚡ Founder Command</div>
            <div class="card-subtitle">Send instructions to the MAULI autonomous company</div>
          </div>
          <div class="card-body">
            <div class="cmd-area">
              <textarea class="textarea" id="cmdInput" placeholder="Enter a founder command...&#10;Example: Create a full-stack e-commerce platform with product catalog, shopping cart, checkout, and admin dashboard"></textarea>
              <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
                <button class="btn btn-primary" id="sendCmd" onclick="sendCommand()">🚀 Execute Command</button>
                <button class="btn" onclick="runSelfTest()">🧪 Self-Test</button>
                <button class="btn" onclick="runDiagnostic()">🔍 Diagnostics</button>
              </div>
            </div>
            <div class="cmd-loading" id="cmdLoading">
              <div class="spinner"></div>
              <span>Executing founder command...</span>
            </div>
            <div class="cmd-result" id="cmdResult" style="display:none"></div>
          </div>
        </div>

        <div class="card fade-in" style="animation-delay:.1s">
          <div class="card-header">
            <div class="card-title">📊 Quick Stats</div>
          </div>
          <div class="card-body">
            <div class="grid grid-4" id="quickStats">
              <div class="stat"><div class="stat-icon">🤖</div><div class="stat-value" id="stat-agents">0</div><div class="stat-label">Agents</div></div>
              <div class="stat"><div class="stat-icon">📁</div><div class="stat-value" id="stat-projects">0</div><div class="stat-label">Projects</div></div>
              <div class="stat"><div class="stat-icon">📋</div><div class="stat-value" id="stat-tasks">0</div><div class="stat-label">Tasks</div></div>
              <div class="stat"><div class="stat-icon">🛡️</div><div class="stat-value" id="stat-approvals">0</div><div class="stat-label">Approvals</div></div>
            </div>
          </div>
        </div>

        <div class="card fade-in" style="animation-delay:.2s">
          <div class="card-header">
            <div class="card-title">📡 Recent Activity</div>
            <button class="btn btn-sm" onclick="navigateTo('activity')">View All</button>
          </div>
          <div class="card-body" id="cmdActivity"></div>
        </div>
      </div>

      <!-- OVERVIEW PAGE -->
      <div class="page" id="page-overview">
        <div class="grid grid-4 fade-in">
          <div class="card stat"><div class="stat-icon">🤖</div><div class="stat-value" id="ov-agents">0</div><div class="stat-label">Total Agents</div></div>
          <div class="card stat"><div class="stat-icon">✅</div><div class="stat-value" id="ov-available">0</div><div class="stat-label">Available</div></div>
          <div class="card stat"><div class="stat-icon">⚙️</div><div class="stat-value" id="ov-working">0</div><div class="stat-label">Working</div></div>
          <div class="card stat"><div class="stat-icon">🚨</div><div class="stat-value" id="ov-issues">0</div><div class="stat-label">Escalated</div></div>
        </div>
        <div class="grid grid-2 fade-in" style="margin-top:16px">
          <div class="card">
            <div class="card-header"><div class="card-title">📊 Agent Distribution</div></div>
            <div class="card-body" id="ov-agentDist"></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">📋 Task Pipeline</div></div>
            <div class="card-body" id="ov-taskPipeline"></div>
          </div>
        </div>
        <div class="card fade-in" style="margin-top:16px">
          <div class="card-header"><div class="card-title">📁 Recent Projects</div></div>
          <div class="card-body" id="ov-projects"></div>
        </div>
      </div>

      <!-- AGENTS PAGE -->
      <div class="page" id="page-agents">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">🤖 Agent Hive</div>
            <div style="display:flex;gap:8px">
              <select class="input" style="width:auto;padding:6px 10px;font-size:12px" id="agentFilter" onchange="renderAgents()">
                <option value="all">All Agents</option>
                <option value="available">Available</option>
                <option value="working">Working</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
          <div class="card-body">
            <div class="grid grid-auto" id="agentGrid"></div>
          </div>
        </div>
      </div>

      <!-- PROJECTS PAGE -->
      <div class="page" id="page-projects">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">📁 Projects</div>
          </div>
          <div class="card-body" id="projectList"></div>
        </div>
      </div>

      <!-- TASKS PAGE -->
      <div class="page" id="page-tasks">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">📋 All Tasks</div>
            <select class="input" style="width:auto;padding:6px 10px;font-size:12px" id="taskFilter" onchange="renderTasks()">
              <option value="all">All States</option>
              <option value="working">Working</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>
          <div class="card-body" id="taskList"></div>
        </div>
      </div>

      <!-- APPROVALS PAGE -->
      <div class="page" id="page-approvals">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">🛡️ Approvals</div>
            <div class="card-subtitle">Founder approval required for high-risk actions</div>
          </div>
          <div class="card-body" id="approvalList"></div>
        </div>
      </div>

      <!-- ACTIVITY PAGE -->
      <div class="page" id="page-activity">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">📡 Activity Feed</div>
            <div class="card-subtitle">Live system event stream</div>
          </div>
          <div class="card-body" id="activityFeed" style="max-height:600px;overflow-y:auto"></div>
        </div>
      </div>

      <!-- HEALTH PAGE -->
      <div class="page" id="page-health">
        <div class="grid grid-2 fade-in">
          <div class="card">
            <div class="card-header">
              <div class="card-title">💚 System Health</div>
              <button class="btn btn-sm" onclick="loadHealth()">Refresh</button>
            </div>
            <div class="card-body" id="healthInfo"></div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">🧪 Self-Test</div>
              <button class="btn btn-sm" onclick="runSelfTest()">Run Test</button>
            </div>
            <div class="card-body" id="selfTestResult"></div>
          </div>
        </div>
        <div class="card fade-in" style="margin-top:16px">
          <div class="card-header">
            <div class="card-title">🔍 Result Persistence Diagnostic</div>
            <button class="btn btn-sm" onclick="runDiagnostic()">Check</button>
          </div>
          <div class="card-body" id="diagResult"></div>
        </div>
        <div class="card fade-in" style="margin-top:16px">
          <div class="card-header"><div class="card-title">🔧 Tools Registry</div></div>
          <div class="card-body" id="toolsList"></div>
        </div>
      </div>

      <!-- MEMORY PAGE -->
      <div class="page" id="page-memory">
        <div class="card fade-in">
          <div class="card-header">
            <div class="card-title">🧠 Company Memory</div>
            <div class="card-subtitle">Persistent knowledge and decision history</div>
          </div>
          <div class="card-body" id="memoryList"></div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="toast-container" id="toastContainer"></div>

<script>
/* ───── STATE ───── */
let STATE = { agents:[], projects:[], tasks:[], approvals:[], tools:[], artifacts:[], events:[] };
let authKey = sanitizeKey(localStorage.getItem('mauli_key') || '');
if(authKey) localStorage.setItem('mauli_key', authKey);

/* ───── UTILS ───── */
function $(id){ return document.getElementById(id); }
function fmtDate(s){ if(!s) return '—'; try{return new Date(s).toLocaleString()}catch{return s} }
function fmtShort(s){ if(!s) return ''; try{const d=new Date(s);return d.toLocaleTimeString()}catch{return ''} }
function toast(msg, type='info'){
  const el=document.createElement('div'); el.className='toast toast-'+type; el.textContent=msg;
  $('toastContainer').appendChild(el); setTimeout(()=>el.remove(), 4000);
}
function eventColor(type){
  if(!type) return 'var(--text-dim)';
  if(type.includes('completed')||type.includes('success')) return 'var(--green)';
  if(type.includes('failed')||type.includes('error')||type.includes('rejected')) return 'var(--red)';
  if(type.includes('started')||type.includes('working')||type.includes('command')) return 'var(--accent)';
  if(type.includes('created')||type.includes('registered')) return 'var(--blue)';
  if(type.includes('approval')) return 'var(--yellow)';
  return 'var(--text-dim)';
}

/* ───── AUTH ───── */
function sanitizeKey(k) {
  // Keep ONLY safe ASCII printable chars — anything else breaks fetch headers
  return String(k || '').replace(/[^a-zA-Z0-9\-_. ]/g, '').trim();
}

async function getKey(){
  const key = 'mauli-founder-key-2026';
  authKey = key;
  localStorage.setItem('mauli_key', key);
  return key;
}

function clearKey(){
  authKey = '';
  localStorage.removeItem('mauli_key');
  toast('API key cleared. Refresh the page.', 'info');
}

/* ───── API ───── */
async function api(path, opts={}){
  const headers = {'content-type':'application/json', ...opts.headers};
  if(opts.auth){
    const k = await getKey();
    if(!k) throw new Error('Auth cancelled');
    headers.authorization = 'Bearer ' + k;
  }
  const r = await fetch(path, { cache:'no-store', ...opts, headers });
  const j = await r.json();
  if(!r.ok || !j.ok){
    const msg = j?.error?.message || 'Request failed';
    if(msg.includes('authorization') || msg.includes('401')) clearKey();
    throw new Error(msg);
  }
  return j.data || j;
}

/* ───── NAVIGATION ───── */
function navigateTo(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const pageEl = $('page-'+page);
  const navEl = document.querySelector('.nav-item[data-page="'+page+'"]');
  if(pageEl) pageEl.classList.add('active');
  if(navEl) navEl.classList.add('active');
  const titles = {command:'Command Center',overview:'Company Overview',agents:'Agent Hive',projects:'Projects',tasks:'Tasks',approvals:'Approvals',activity:'Activity Feed',health:'System Health',memory:'Company Memory'};
  $('pageTitle').textContent = titles[page] || page;
  // Close mobile sidebar
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}
document.querySelectorAll('.nav-item[data-page]').forEach(el=>{
  el.addEventListener('click',()=>navigateTo(el.dataset.page));
});

/* ───── MOBILE ───── */
$('mobileMenuBtn').addEventListener('click',()=>{
  $('sidebar').classList.toggle('open');
  $('sidebarOverlay').classList.toggle('open');
});
$('sidebarOverlay').addEventListener('click',()=>{
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
});

/* ───── LOAD STATE ───── */
async function loadState(){
  try {
    const data = await api('/api/state');
    STATE = { agents:data.agents||[], projects:data.projects||[], tasks:data.tasks||[], approvals:data.approvals||[], tools:data.tools||[], artifacts:data.artifacts||[], events:data.events||[] };
    renderAll();
  } catch(e){
    console.error('State load failed:', e);
  }
}

/* ───── RENDER ALL ───── */
function renderAll(){
  const agents = STATE.agents;
  const tasks = STATE.tasks;
  const projects = STATE.projects;
  const approvals = STATE.approvals;
  const events = STATE.events;

  // Nav badges
  $('nav-agent-count').textContent = agents.length;
  $('nav-project-count').textContent = projects.length;
  $('nav-task-count').textContent = tasks.length;
  const pending = approvals.filter(a=>a.state==='pending').length;
  $('nav-approval-count').textContent = pending;
  $('nav-approval-count').style.display = pending > 0 ? '' : 'none';

  // Quick stats
  $('stat-agents').textContent = agents.length;
  $('stat-projects').textContent = projects.length;
  $('stat-tasks').textContent = tasks.length;
  $('stat-approvals').textContent = approvals.length;

  // Overview
  renderOverview();
  renderAgents();
  renderProjects();
  renderTasks();
  renderApprovals();
  renderActivity();
  renderHealth();
  renderMemory();
}

/* ───── OVERVIEW ───── */
function renderOverview(){
  const a = STATE.agents;
  const t = STATE.tasks;
  const states = {};
  a.forEach(ag=>{ states[ag.state] = (states[ag.state]||0)+1; });
  $('ov-agents').textContent = a.length;
  $('ov-available').textContent = states.available||0;
  $('ov-working').textContent = (states.working||0)+(states.assigned||0);
  $('ov-issues').textContent = (states.blocked||0)+(states.escalated||0);

  // Agent distribution by department
  const depts = {};
  a.forEach(ag=>{ depts[ag.department||'General'] = (depts[ag.department||'General']||0)+1; });
  let distHTML = '';
  const colors = ['var(--accent)','var(--accent-2)','var(--green)','var(--yellow)','var(--accent-3)','var(--blue)'];
  let ci = 0;
  for(const [dept, count] of Object.entries(depts)){
    const pct = Math.round(count / a.length * 100);
    distHTML += '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>'+dept+'</span><span style="color:var(--text-muted)">'+count+' agents ('+pct+'%)</span></div><div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%;background:'+colors[ci%colors.length]+'"></div></div></div>';
    ci++;
  }
  $('ov-agentDist').innerHTML = distHTML || '<div class="empty"><div class="empty-text">No agents registered</div></div>';

  // Task pipeline
  const taskStates = {};
  t.forEach(tk=>{ taskStates[tk.state] = (taskStates[tk.state]||0)+1; });
  let pipeHTML = '';
  const stateOrder = ['queued','assigned','working','verifying','completed','failed','blocked'];
  const stateColors = {queued:'var(--text-dim)',assigned:'var(--yellow)',working:'var(--accent)',verifying:'var(--accent-2)',completed:'var(--green)',failed:'var(--red)',blocked:'var(--red)'};
  for(const s of stateOrder){
    const count = taskStates[s]||0;
    if(!count) continue;
    const pct = Math.round(count / t.length * 100);
    pipeHTML += '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="text-transform:capitalize">'+s+'</span><span style="color:var(--text-muted)">'+count+' ('+pct+'%)</span></div><div class="progress-bar"><div class="progress-fill" style="width:'+pct+'%;background:'+stateColors[s]+'"></div></div></div>';
  }
  $('ov-taskPipeline').innerHTML = pipeHTML || '<div class="empty"><div class="empty-text">No tasks yet</div></div>';

  // Recent projects
  const sorted = [...STATE.projects].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  let projHTML = '';
  for(const p of sorted.slice(0,5)){
    const tasks = STATE.tasks.filter(t=>t.projectId===p.id);
    const done = tasks.filter(t=>t.state==='completed').length;
    projHTML += '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3)"><div style="flex:1"><div style="font-weight:600;font-size:13px">'+esc(p.name||p.id)+'</div><div style="font-size:11px;color:var(--text-dim)">'+esc(p.objective||'').slice(0,80)+'</div></div><span class="badge badge-'+stateBadge(p.state)+'">'+p.state+'</span><span style="font-size:11px;color:var(--text-dim)">'+done+'/'+tasks.length+' tasks</span></div>';
  }
  $('ov-projects').innerHTML = projHTML || '<div class="empty"><div class="empty-icon">📁</div><div class="empty-text">No projects yet. Send a founder command to begin.</div></div>';
}

/* ───── AGENTS ───── */
function renderAgents(){
  const filter = $('agentFilter')?.value || 'all';
  let agents = STATE.agents;
  if(filter !== 'all') agents = agents.filter(a=>a.state===filter);

  let html = '';
  for(const ag of agents){
    const caps = (ag.capabilities||[]).map(c=>'<span class="cap-tag">'+esc(c)+'</span>').join('');
    const meta = ag.metadata||{};
    const score = meta.reliabilityScore != null ? meta.reliabilityScore+'%' : (meta.successRate != null ? Math.round(meta.successRate*100)+'%' : '—');
    const tasks = meta.outcomeCount != null ? meta.outcomeCount : 0;
    html += '<div class="card agent-card" data-state="'+ag.state+'">';
    html += '<div class="agent-score">Score: '+score+'</div>';
    html += '<div class="agent-name">'+esc(ag.name)+'</div>';
    html += '<div class="agent-role">'+esc(ag.role)+'</div>';
    html += '<div class="agent-meta">';
    html += '<span class="agent-dept">'+esc(ag.department)+'</span>';
    html += '<span class="agent-state state-'+ag.state+'">'+ag.state+'</span>';
    html += '</div>';
    html += '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">'+tasks+' tasks completed</div>';
    html += '<div class="agent-caps">'+caps+'</div>';
    html += '</div>';
  }
  $('agentGrid').innerHTML = html || '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🤖</div><div class="empty-text">No agents found</div></div>';
}

/* ───── PROJECTS ───── */
function renderProjects(){
  const sorted = [...STATE.projects].sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
  let html = '';
  for(const p of sorted){
    const tasks = STATE.tasks.filter(t=>t.projectId===p.id);
    const done = tasks.filter(t=>t.state==='completed').length;
    const failed = tasks.filter(t=>t.state==='failed').length;
    const total = tasks.length;
    const pct = total ? Math.round(done/total*100) : 0;
    const reqs = (p.requirements||[]).map(r=>'<div style="font-size:12px;color:var(--text-muted);padding:3px 0">• '+esc(r)+'</div>').join('');

    html += '<div class="card project-card fade-in">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start">';
    html += '<div><div class="project-name">'+esc(p.name||p.id)+'</div><div class="project-obj">'+esc(p.objective||'')+'</div></div>';
    html += '<span class="badge badge-'+stateBadge(p.state)+'">'+p.state+'</span>';
    html += '</div>';
    html += '<div class="progress-bar" style="margin:12px 0"><div class="progress-fill progress-blue" style="width:'+pct+'%"></div></div>';
    html += '<div class="project-stats">';
    html += '<div class="project-stat">📋 '+done+'/'+total+' tasks</div>';
    if(failed) html += '<div class="project-stat" style="color:var(--red)">❌ '+failed+' failed</div>';
    html += '<div class="project-stat">📁 '+(STATE.artifacts.filter(a=>a.projectId===p.id).length)+' artifacts</div>';
    html += '<div class="project-stat">🕐 '+fmtDate(p.updatedAt||p.createdAt)+'</div>';
    html += '</div>';
    if(reqs) html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px">REQUIREMENTS</div>'+reqs+'</div>';
    if(p.state==='completed' || STATE.artifacts.some(a=>a.projectId===p.id&&a.type==='final-delivery'&&a.metadata?.downloadPath) || STATE.artifacts.some(a=>a.projectId===p.id&&a.type==='code-workspace')){
      const delivery=STATE.artifacts.find(a=>a.projectId===p.id&&a.type==='final-delivery');
      const dlPath=delivery?.metadata?.downloadPath;
      if(dlPath) html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"><button class="btn btn-primary btn-sm download-btn" data-path="'+dlPath+'">📥 Download ZIP</button>';
      const hasCodeArtifact = STATE.artifacts.some(a => a.projectId === p.id && a.type === 'code-workspace');
      if (hasCodeArtifact) html += '<button class="btn btn-green btn-sm build-btn" data-project="'+p.id+'" data-platform="android">Build APK</button><button class="btn btn-accent btn-sm build-btn" data-project="'+p.id+'" data-platform="desktop">Build EXE</button>';
      html += '</div>';
    }

    // Project tasks
    if(tasks.length){
      html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">';
      for(const tk of tasks){
        html += '<div class="task-row"><div class="task-title">'+esc(tk.title||tk.id)+'</div><div class="task-meta"><span class="badge badge-'+taskBadge(tk.state)+'">'+tk.state+'</span></div></div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  $('projectList').innerHTML = html || '<div class="empty"><div class="empty-icon">📁</div><div class="empty-text">No projects yet. Send a founder command to create one.</div></div>';
}

/* ───── TASKS ───── */
function renderTasks(){
  const filter = $('taskFilter')?.value || 'all';
  let tasks = STATE.tasks;
  if(filter !== 'all') tasks = tasks.filter(t=>t.state===filter);
  tasks = [...tasks].sort((a,b)=>(a.sequence||0)-(b.sequence||0));

  let html = '';
  for(const tk of tasks){
    const agent = tk.assignedAgentId ? STATE.agents.find(a=>a.id===tk.assignedAgentId) : null;
    const caps = (tk.requiredCapabilities||[]).map(c=>'<span class="cap-tag">'+esc(c)+'</span>').join(' ');
    html += '<div class="task-row">';
    html += '<div style="flex:1"><div class="task-title">'+esc(tk.title||tk.id)+'</div>';
    html += '<div style="font-size:11px;color:var(--text-dim);margin-top:2px">'+caps+'</div></div>';
    html += '<div class="task-meta">';
    if(agent) html += '<span style="color:var(--text-muted)">🤖 '+esc(agent.name)+'</span>';
    html += '<span class="badge badge-'+taskBadge(tk.state)+'">'+tk.state+'</span>';
    if(tk.attempts) html += '<span style="color:var(--text-dim)">Attempt '+tk.attempts+'</span>';
    html += '</div></div>';
  }
  $('taskList').innerHTML = html || '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">No tasks found</div></div>';
}

/* ───── APPROVALS ───── */
function renderApprovals(){
  const sorted = [...STATE.approvals].sort((a,b)=>String(b.requestedAt||'').localeCompare(String(a.requestedAt||'')));
  let html = '';
  for(const ap of sorted){
    const badgeClass = ap.state==='approved'?'badge-green':ap.state==='rejected'?'badge-red':'badge-yellow';
    html += '<div class="card approval-card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:start">';
    html += '<div><div class="approval-action">'+esc(ap.action||'Unknown action')+'</div>';
    html += '<div class="approval-meta"><span>Risk: <strong>'+esc(ap.risk)+'</strong></span><span>'+fmtDate(ap.requestedAt)+'</span></div></div>';
    html += '<span class="badge '+badgeClass+'">'+ap.state+'</span>';
    html += '</div>';
    if(ap.state==='pending'){
      html += '<div class="approval-actions">';
      html += '<button class="btn btn-green btn-sm" onclick="decideApproval(\\''+ap.id+'\\', true)">✅ Approve</button>';
      html += '<button class="btn btn-red btn-sm" onclick="decideApproval(\\''+ap.id+'\\', false)">❌ Reject</button>';
      html += '</div>';
    }
    if(ap.note) html += '<div style="margin-top:8px;font-size:12px;color:var(--text-dim)">Note: '+esc(ap.note)+'</div>';
    html += '</div>';
  }
  $('approvalList').innerHTML = html || '<div class="empty"><div class="empty-icon">🛡️</div><div class="empty-text">No approvals pending</div></div>';
}

/* ───── ACTIVITY ───── */
function renderActivity(){
  const events = [...STATE.events].slice(-50).reverse();
  let html = '';
  for(const ev of events){
    const detail = typeof ev.payload === 'object' ? Object.entries(ev.payload).slice(0,3).map(([k,v])=>k+': '+String(v).slice(0,40)).join(', ') : String(ev.payload||'').slice(0,80);
    html += '<div class="event-row">';
    html += '<div class="event-dot" style="background:'+eventColor(ev.type)+'"></div>';
    html += '<div class="event-content"><div class="event-type" style="color:'+eventColor(ev.type)+'">'+esc(ev.type||'unknown')+'</div><div class="event-detail">'+esc(detail)+'</div></div>';
    html += '<div class="event-time">'+fmtShort(ev.at)+'</div>';
    html += '</div>';
  }
  $('activityFeed').innerHTML = html || '<div class="empty"><div class="empty-icon">📡</div><div class="empty-text">No events yet</div></div>';
  // Also render mini version on command page
  $('cmdActivity').innerHTML = events.slice(0,8).map(ev=>{
    const detail = typeof ev.payload==='object' ? Object.keys(ev.payload||{}).slice(0,2).join(', ') : '';
    return '<div class="event-row"><div class="event-dot" style="background:'+eventColor(ev.type)+'"></div><div class="event-content"><div class="event-type" style="color:'+eventColor(ev.type)+'">'+esc(ev.type||'')+'</div></div><div class="event-time">'+fmtShort(ev.at)+'</div></div>';
  }).join('') || '<div class="empty"><div class="empty-text">No recent activity</div></div>';
}

/* ───── HEALTH ───── */
async function loadHealth(){
  try {
    const h = await api('/api/health');
    let html = '';
    html += healthRow('Service', h.service || '—');
    html += healthRow('Status', '<span style="color:var(--green)">'+h.status+'</span>');
    html += healthRow('D1 Persistence', h.persistence ? '<span style="color:var(--green)">Connected</span>' : '<span style="color:var(--yellow)">Memory Only</span>');
    html += healthRow('Hydrated', h.hydrated ? '<span style="color:var(--green)">Yes</span>' : '<span style="color:var(--text-dim)">No</span>');
    html += healthRow('AI Binding', h.ai ? '<span style="color:var(--green)">Available</span>' : '<span style="color:var(--yellow)">Unavailable</span>');
    html += healthRow('Recovered Runs', h.recoveredRuns || 0);
    html += healthRow('Time', fmtDate(h.time));
    $('healthInfo').innerHTML = html;
  } catch(e){
    $('healthInfo').innerHTML = '<div style="color:var(--red)">Failed to load health: '+esc(e.message)+'</div>';
  }
}
function healthRow(label, value){
  return '<div class="health-row"><span class="health-label">'+label+'</span><span class="health-value">'+value+'</span></div>';
}
function renderHealth(){
  loadHealth();
  renderTools();
}

function renderTools(){
  let html = '';
  for(const tool of STATE.tools){
    html += '<div class="health-row">';
    html += '<span style="font-size:14px">🔧</span>';
    html += '<span class="health-label"><strong>'+esc(tool.name)+'</strong><br><span style="font-size:11px;color:var(--text-dim)">'+esc(tool.description||'')+'</span></span>';
    html += '<span class="badge badge-'+(tool.risk==='read'?'green':tool.risk==='write'?'yellow':'red')+'">'+esc(tool.risk)+'</span>';
    html += '</div>';
  }
  $('toolsList').innerHTML = html || '<div class="empty"><div class="empty-text">No tools registered</div></div>';
}

/* ───── MEMORY ───── */
function renderMemory(){
  const events = STATE.events.filter(e=>e.type&&e.type.includes('memory')).slice(-20).reverse();
  const memEvents = STATE.events.filter(e=>e.type&&(e.type.includes('task_result')||e.type.includes('solution')||e.type.includes('error')||e.type.includes('project_requirement')||e.type.includes('command'))).slice(-20).reverse();
  const all = [...events,...memEvents].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,30);

  let html = '';
  for(const ev of all){
    const payload = typeof ev.payload==='object' ? JSON.stringify(ev.payload,null,2) : String(ev.payload||'');
    html += '<div style="padding:10px 0;border-bottom:1px solid rgba(30,45,74,.3)">';
    html += '<div style="display:flex;justify-content:space-between"><span class="badge badge-accent" style="font-size:10px">'+esc(ev.type)+'</span><span style="font-size:11px;color:var(--text-dim)">'+fmtDate(ev.at)+'</span></div>';
    html += '<pre style="font-size:11px;color:var(--text-muted);margin-top:6px;white-space:pre-wrap;word-break:break-all;max-height:100px;overflow:hidden">'+esc(payload)+'</pre>';
    html += '</div>';
  }
  $('memoryList').innerHTML = html || '<div class="empty"><div class="empty-icon">🧠</div><div class="empty-text">No memory entries yet. Execute a founder command to build company memory.</div></div>';
}

/* ───── DOWNLOAD ───── */
async function downloadZip(path){
  try {
    toast('Downloading...', 'info');
    const k = await getKey();
    const r = await fetch(path, { headers:{'Authorization':'Bearer '+k} });
    if(!r.ok){ toast('Download failed: '+r.status, 'error'); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mauli-project.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
    toast('Download started!', 'success');
  } catch(e){ toast('Download error: '+e.message, 'error'); }
}

/* ───── ACTIONS ───── */
async function sendCommand(){
  const input = $('cmdInput');
  const cmd = input.value.trim();
  if(!cmd){ toast('Enter a founder command first', 'error'); return; }
  $('sendCmd').disabled = true;
  $('cmdLoading').classList.add('show');
  $('cmdResult').style.display = 'none';
  try {
    const result = await api('/api/command', {
      method:'POST', auth:true,
      body: JSON.stringify({command:cmd})
    });
    $('cmdResult').style.display = 'block';
    $('cmdResult').textContent = JSON.stringify(result.result || result, null, 2);
    toast('Command executed successfully!', 'success');
    input.value = '';
    await loadState();
  } catch(e){
    $('cmdResult').style.display = 'block';
    $('cmdResult').textContent = 'Error: ' + e.message;
    toast('Command failed: ' + e.message, 'error');
    if(e.message.includes('authorization') || e.message.includes('401')){
      clearKey();
      toast('Key cleared. Please re-enter the correct API key.', 'info');
    }
  } finally {
    $('sendCmd').disabled = false;
    $('cmdLoading').classList.remove('show');
  }
}

async function decideApproval(approvalId, approved){
  try {
    await api('/api/approvals/'+approvalId, {
      method:'POST', auth:true,
      body: JSON.stringify({approved})
    });
    toast(approved ? 'Approval granted' : 'Approval rejected', approved ? 'success' : 'info');
    await loadState();
  } catch(e){
    toast('Failed: ' + e.message, 'error');
  }
}

async function runSelfTest(){
  try {
    const result = await api('/api/self-test', {auth:true});
    const r = result.result || result;
    let html = '<div style="margin-bottom:8px"><span class="badge badge-'+(r.status==='ready'?'green':r.status==='degraded'?'yellow':'red')+'">'+r.status.toUpperCase()+' — '+r.score+'%</span></div>';
    for(const c of (r.checks||[])){
      html += '<div class="health-row"><span style="color:'+(c.passed?'var(--green)':'var(--red)')+'">'+(c.passed?'✅':'❌')+'</span><span class="health-label">'+esc(c.name)+'</span><span style="font-size:11px;color:var(--text-dim)">'+esc(c.details||'')+'</span></div>';
    }
    $('selfTestResult').innerHTML = html;
    toast('Self-test: '+r.status+' ('+r.score+'%)', r.status==='ready'?'success':'info');
  } catch(e){
    $('selfTestResult').innerHTML = '<div style="color:var(--red)">'+esc(e.message)+'</div>';
  }
}

async function runDiagnostic(){
  try {
    const result = await api('/api/result-diagnostic', {auth:true});
    const r = result.result || result;
    let html = '';
    html += healthRow('Token Configured', r.tokenConfigured ? '<span style="color:var(--green)">Yes</span>' : '<span style="color:var(--red)">No</span>');
    if(r.tokenSource) html += healthRow('Token Source', r.tokenSource);
    if(r.repo) html += healthRow('Repository', r.repo);
    if(r.path) html += healthRow('Result Path', r.path);
    if(r.branch) html += healthRow('Branch', r.branch);
    if(r.reason) html += healthRow('Reason', '<span style="color:var(--yellow)">'+esc(r.reason)+'</span>');
    html += healthRow('Status', r.ok ? '<span style="color:var(--green)">OK</span>' : '<span style="color:var(--red)">Issue Detected</span>');
    $('diagResult').innerHTML = html;
    toast('Diagnostics complete', 'success');
  } catch(e){
    $('diagResult').innerHTML = '<div style="color:var(--red)">'+esc(e.message)+'</div>';
  }
}

/* ───── HELPERS ───── */
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function stateBadge(s){ return s==='completed'?'green':s==='active'?'blue':s==='planning'?'accent':s==='escalated'?'red':'yellow'; }
function taskBadge(s){ return s==='completed'?'green':s==='working'?'accent':s==='failed'?'red':s==='blocked'?'red':s==='verifying'?'blue':'yellow'; }

/* ───── CLOCK ───── */
function updateClock(){ $('topbarTime').textContent = new Date().toLocaleTimeString(); }
setInterval(updateClock, 1000);
updateClock();

/* ───── KEYBOARD SHORTCUTS ───── */
document.addEventListener('keydown', e=>{
  if((e.ctrlKey||e.metaKey) && e.key==='Enter'){
    const page = document.querySelector('.page.active');
    if(page?.id==='page-command') sendCommand();
  }
});

/* ───── HEARTBEAT ───── */
let lastHeartbeat = 0;
let heartbeatFailures = 0;
async function checkHeartbeat() {
  try {
    const r = await fetch('/api/heartbeat', { cache: 'no-store' });
    const j = await r.json();
    if (j.ok) {
      lastHeartbeat = Date.now();
      heartbeatFailures = 0;
      const dot = $('heartbeatDot');
      const txt = $('heartbeatText');
      if (dot) dot.classList.remove('dead');
      if (txt) txt.textContent = 'System Online';
    }
  } catch(e) {
    heartbeatFailures++;
    if (heartbeatFailures >= 3) {
      const dot = $('heartbeatDot');
      const txt = $('heartbeatText');
      if (dot) dot.classList.add('dead');
      if (txt) txt.textContent = 'System Offline';
    }
  }
}
setInterval(checkHeartbeat, 5000);
checkHeartbeat();

/* ───── BUILD APP ───── */
let activeBuilds = {};

function renderBuildProgress(projectId, platform, buildId, status, startedAt) {
  const el = document.querySelector('.build-progress[data-build="'+buildId+'"]');
  if (!el) return;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';

  let pct = 0;
  let label = '';
  let fillClass = '';
  let statusText = '';

  if (status === 'completed' || status === 'success') {
    pct = 100; fillClass = 'done'; label = '✅ Build Complete!'; statusText = 'Download ready';
  } else if (status === 'failure' || status === 'error') {
    pct = 100; fillClass = 'error'; label = '❌ Build Failed'; statusText = 'Check GitHub Actions';
  } else if (status === 'pushed') {
    pct = 15; label = '📤 Files Pushed to GitHub'; statusText = 'Waiting for GitHub Actions to start... ' + timeStr;
  } else if (status === 'in_progress' || status === 'queued') {
    pct = 50; label = '🔨 Building ' + platform.toUpperCase() + '...'; statusText = 'GitHub Actions is building... ' + timeStr;
  } else {
    pct = 25; label = '⏳ Build in progress...'; statusText = 'Elapsed: ' + timeStr;
  }

  el.innerHTML = '<div class="build-progress-header"><span class="build-progress-label">' + label + '</span><span class="build-progress-status">' + statusText + '</span></div><div class="build-progress-bar"><div class="build-progress-fill ' + fillClass + '" style="width:' + pct + '%"></div></div>';
}

async function startBuild(projectId, platform, btn) {
  const buildKey = projectId + '_' + platform;
  if (activeBuilds[buildKey]) {
    toast('Build already in progress for ' + platform.toUpperCase(), 'info');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Starting...';

  // Insert progress bar after the button
  const progressDiv = document.createElement('div');
  progressDiv.className = 'build-progress';
  progressDiv.dataset.build = 'pending';
  btn.closest('div').appendChild(progressDiv);

  try {
    const result = await api('/api/build-app', {
      method: 'POST', auth: true,
      body: JSON.stringify({ projectId, platform })
    });

    const buildId = result.buildId;
    progressDiv.dataset.build = buildId;
    activeBuilds[buildKey] = { buildId, startedAt: Date.now() };
    toast('Build started! ' + result.pushed + ' files pushed to GitHub.', 'success');

    btn.textContent = 'Building...';
    let attempts = 0;
    const maxAttempts = 60;

    const poll = async () => {
      attempts++;
      try {
        const status = await api('/api/build-status/' + buildId, { auth: true });
        renderBuildProgress(projectId, platform, buildId, status.status, activeBuilds[buildKey].startedAt);

        if (status.downloadUrl) {
          btn.textContent = 'Download ' + platform.toUpperCase();
          btn.disabled = false;
          btn.classList.remove('btn-green');
          btn.classList.add('btn-primary');
          btn.onclick = () => window.open(status.downloadUrl, '_blank');
          delete activeBuilds[buildKey];
          toast(platform.toUpperCase() + ' ready for download!', 'success');
          renderBuildProgress(projectId, platform, buildId, 'completed', activeBuilds[buildKey]?.startedAt || Date.now());
          return;
        }
        if (status.status === 'failure' || status.status === 'error') {
          btn.textContent = 'Build Failed';
          btn.disabled = false;
          btn.classList.remove('btn-green');
          btn.classList.add('btn-red');
          delete activeBuilds[buildKey];
          toast('Build failed. Check GitHub Actions.', 'error');
          renderBuildProgress(projectId, platform, buildId, 'failure', activeBuilds[buildKey]?.startedAt || Date.now());
          return;
        }
        if (attempts >= maxAttempts) {
          btn.textContent = 'Check GitHub';
          btn.disabled = false;
          btn.onclick = () => window.open('https://github.com/kalpeshpatil4694/MAULI-2.0/actions', '_blank');
          delete activeBuilds[buildKey];
          toast('Build still running. Click to check GitHub Actions.', 'info');
          renderBuildProgress(projectId, platform, buildId, 'in_progress', activeBuilds[buildKey]?.startedAt || Date.now());
          return;
        }
        setTimeout(poll, 10000);
      } catch(e) {
        if (attempts < maxAttempts) {
          setTimeout(poll, 10000);
        } else {
          btn.textContent = 'Check GitHub';
          btn.disabled = false;
          toast('Error checking build: ' + e.message, 'error');
          delete activeBuilds[buildKey];
        }
      }
    };
    setTimeout(poll, 5000);
  } catch(e) {
    btn.textContent = 'Build ' + platform.toUpperCase();
    btn.disabled = false;
    delete activeBuilds[buildKey];
    const errMsg = e.message || 'Unknown error';
    if (errMsg.includes('token') || errMsg.includes('permission') || errMsg.includes('GITHUB_TOKEN')) {
      toast('GitHub token issue: ' + errMsg, 'error');
    } else {
      toast('Build failed: ' + errMsg, 'error');
    }
    if (progressDiv) progressDiv.innerHTML = '<div class="build-progress-header"><span class="build-progress-label" style="color:var(--red)">\u274c ' + esc(errMsg) + '</span></div>';
  }
}

/* ───── EVENT DELEGATION ───── */
document.addEventListener('click', e => {
  const dlBtn = e.target.closest('.download-btn');
  if(dlBtn) downloadZip(dlBtn.dataset.path);
  const buildBtn = e.target.closest('.build-btn');
  if(buildBtn) startBuild(buildBtn.dataset.project, buildBtn.dataset.platform, buildBtn);
});

/* ───── INIT ───── */
/* ── EXISTING BUILDS CHECK ── */
const buildCache = {};
async function checkExistingBuilds() {
  const completedProjects = STATE.projects.filter(p => p.state === "completed");
  for (const p of completedProjects) {
    try {
      const result = await api("/api/project-builds/" + p.id, { auth: true });
      if (result.bestAPK) {
        buildCache[p.id] = { apk: result.bestAPK, exe: result.bestEXE || null };
        const buildBtns = document.querySelectorAll('.build-btn[data-project="' + p.id + '"][data-platform="android"]');
        buildBtns.forEach(btn => {
          const isRunPage = result.bestAPK && result.bestAPK.includes("/actions/runs/");
          btn.textContent = isRunPage ? "📱 Build Ready (GitHub)" : "📱 Download APK";
          btn.classList.remove("btn-green");
          btn.classList.add("btn-primary");
          btn.onclick = () => window.open(result.bestAPK, "_blank");
          btn.style.fontWeight = "700";
        });
        if (result.bestEXE) {
          const exeBtns = document.querySelectorAll('.build-btn[data-project="' + p.id + '"][data-platform="desktop"]');
          exeBtns.forEach(btn => {
            const isExeRunPage = result.bestEXE && result.bestEXE.includes("/actions/runs/");
            btn.textContent = isExeRunPage ? "🖥️ Build Ready (GitHub)" : "🖥️ Download EXE";
            btn.classList.remove("btn-accent");
            btn.classList.add("btn-primary");
            btn.onclick = () => window.open(result.bestEXE, "_blank");
            btn.style.fontWeight = "700";
          });
        }
      }
    } catch(e) {}
  }
}

/* ── INIT ── */
loadState().then(() => checkExistingBuilds());
setInterval(() => { loadState().then(() => checkExistingBuilds()); }, 8000);
</script>
</body>
</html>`;
}
