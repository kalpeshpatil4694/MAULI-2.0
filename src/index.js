import { ok, fail, json, now, validateString, validateId, sanitize, corsHeaders } from './core.js';
import { store } from './store.js';
import { d1QuotaSnapshot, d1ReadQuotaSnapshot, d1WriteSourcesSnapshot, d1WriteBlockedSnapshot } from './d1-quota.js';
import { seedAgents, listAgents, dedupeAgentList } from './agents.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { listApprovals, decideApproval } from './governance.js';
import { planCommand, resumeApprovedCommand } from './orchestrator.js';
import { PLATFORMS, DEFAULT_PLATFORM, normalizePlatform, resolvePlatform, platformLabel, platformIcon, describePlatform } from './platforms.js';
import { listTools, ensureBuiltinTools } from './tools.js';
import { getArtifact, getArtifactDurable, listProjectArtifacts, listTaskArtifacts } from './artifacts.js';
import { collectProjectFiles, createZip } from './zip.js';
import { ensureSchema, hasD1, d1List, d1Get, d1Events, claimBuildVersion, getBuildVersion, getUsageReport, cleanupD1 } from './db.js';
import { recoverStuckProjects } from './maintenance.js';
import { recoverRunningExecutions } from './execution.js';
import { requireFounder, checkRateLimit, checkCommandRateLimit, getRateLimitStats, founderAuthStatus } from './auth.js';
import { runL1SelfTest } from './self-test.js';
import { diagnoseResultPersistence, saveCommandResult, listCommandResults, getCommandResult } from './result-recorder.js';
import { dashboardHTML } from './dashboard.js';
import { sendMessage, getMessages, acknowledgeMessage, respondToMessage, requestReview, handoffTask, broadcastAlert, getCollaborationStats } from './agent-communication.js';
import { getAgentSkillTree, getAgentCollaborationStats, getSystemLearningStats, getBestAgentForTask } from './agent-learning.js';
import { processChatMessage, getChatHistory, getActiveConversations, cloneProject } from './chat-engine.js';
import { editFile, getEditHistory, getRecentEdits, undoEdit, getFileChangeSummary, parseEditCommand } from './file-editor.js';
import { recordActivity, getActivityFeed, getProjectProgress, getLiveStatus, createSubAgent, getSubAgents, requestHelp, getAgentConversation } from './live-monitor.js';
import { enrichProjectTiming, enrichTaskTiming, sanitizeTaskEstimate } from './time-tracking.js';
import { generateProjectDocs } from './docs-generator.js';
import { searchAPIs, recommendAPIs, getAPICatalog, getAPICategories } from './public-apis.js';
import { getMCPForAgent, getMCPByCapability, getAllMCPServers, getMCPCategories, suggestMCPForProject } from './mcp-integration.js';
import { checkOllama, ollamaGenerate, ollamaChat, ollamaCode, getRecommendedModels, getModelForTask } from './ollama-ai.js';
import { registerWebhook, updateWebhook, deleteWebhook, listWebhooks, triggerWebhooks, getWebhookDeliveries, retryDelivery } from './webhooks.js';
import { createNotification, getNotifications, getUnreadCount, markRead, markAllRead, deleteNotification, clearAll, NOTIFICATION_TYPES } from './notifications.js';
import { createVersion, getVersionHistory, getVersion, compareVersions, restoreVersion, getVersionStats } from './version-history.js';
import { scrapePage, researchTopic } from './scraper.js';
import { getFreeServices, getServicesByCategory, getServiceCategories, estimateFreeTierCost } from './free-services.js';
import { generateDesignCSS, getThemes, createDesignSystem } from './design-system.js';
import { getAgentPatterns, getPatternForProject, getPatternCategories } from './agent-patterns.js';
import { getD1UsageFromAPI, getWorkerAnalytics, getKVUsage, getFullUsageReport, checkLimits } from './cloudflare-api.js';
import { recordRuntimeAcceptance, runtimeAcceptanceSummary, ensureRuntimeAcceptance, recordGeneratedDeployment, ensureGeneratedDeployment, sweepRuntimeAcceptance } from './runtime-evidence.js';
import { DEPLOYMENT_STATUS, normalizeDeployment } from './generated-deployment.js';
import { isRuntimeAcceptanceReport, describeStoredRuntimeAcceptance } from './production-runtime.js';

function artifactJson(artifact) { return artifact ? ok({ artifact }) : fail('Artifact not found',404); }
function isIsolatedTestEnv(env) { return env?.SKIP_RESULT_PERSISTENCE === true || env?.SKIP_RESULT_PERSISTENCE === 'true' || env?.MAULI_TEST_MODE === true || env?.MAULI_TEST_MODE === 'true'; }

// store.list() is a hydrated, row-capped cache. On a cold isolate the artifacts
// table is only partially loaded, so a project whose code really exists in D1
// could report "no code artifact" purely because of which rows made it into
// this isolate. When the cache has nothing for the project we ask D1 directly.
async function projectCodeArtifacts(projectId, env) {
  const cached = store.list('artifacts').filter(a => a.projectId === projectId && a.type === 'code-workspace');
  if (cached.length) return cached;
  if (!hasD1(env) || !projectId) return cached;
  try {
    const rows = await env.DB.prepare(
      "SELECT data FROM entities WHERE type = 'artifacts' ORDER BY updated_at DESC LIMIT 3000"
    ).all();
    const all = (rows.results ?? []).map(r => JSON.parse(r.data));
    return all.filter(a => a.projectId === projectId && a.type === 'code-workspace');
  } catch {
    return cached;
  }
}

// Same idea for a single build record: the in-memory list is capped, so a build
// started on a previous isolate could be invisible and report a false 404.
async function findBuild(buildId, env) {
  const cached = store.list('builds').find(b => b.id === buildId);
  if (cached) return cached;
  return hasD1(env) ? d1Get(env, 'builds', buildId) : null;
}

// Lazy initialization — only run once per Worker lifetime
let _initialized = false;
let _toolsReady = false;
async function initOnce(env, ctx) {
  if (_initialized) return;
  _initialized = true;
  try { await ensureSchema(env); } catch(_) {} // DDL may fail if D1 limit exceeded — non-fatal
  store.configure(env);
  // Hydrate before serving. This used to be fire-and-forget through ctx.waitUntil,
  // which left the first requests of every cold isolate running against an empty
  // store: /api/build-status returned a false 404 for a build that existed, and
  // /api/build-app claimed a project had "no code artifact" when its files were
  // already in D1. Reading a row-capped cache while another isolate wrote the row
  // is the whole defect. Cost is unchanged (the same tables were read either way)
  // and hydrateOnce() is single-flight, so only the first request pays for it.
  if (!store.hydrated) {
    await store.hydrateOnce().catch(()=>{});
  }
}
// Bounded, cached snapshot used only until a cold isolate finishes hydrating.
// Match the live dashboard cadence while avoiding repeated D1 reads between polls.
const STATE_SNAPSHOT_TTL = 5000;
let _stateSnapshot = null; let _stateSnapshotTime = 0; let _lastGoodSnapshot = null;
function compactStateItem(item, type) {
  if (!item || typeof item !== 'object') return item;
  const copy = { ...item };
  if (type === 'artifacts') {
    delete copy.content;
    if (copy.metadata) copy.metadata = { ...copy.metadata };
  }
  if (type === 'tasks') {
    delete copy.result; delete copy.output; delete copy.execution; delete copy.context; delete copy.largeResult;
    // completeTask persists enrichTaskTiming into the row, so a poisoned estimate and its
    // "679h 40m 35s" label ride along on every /api/state payload forever. Ship a sane
    // number and drop the stale label; readers that need it re-derive it via enrichTaskTiming.
    const sane = sanitizeTaskEstimate(copy.estimatedDurationMs);
    if (sane === null) delete copy.estimatedDurationMs; else copy.estimatedDurationMs = sane;
    delete copy.estimatedDurationFormatted;
  }
  if (type === 'events') {
    if (copy.payload && typeof copy.payload === 'object') {
      const p = { ...copy.payload };
      delete p.result; delete p.output; delete p.content; delete p.files;
      copy.payload = p;
    }
  }
  if (type === 'projects') {
    delete copy.result; delete copy.largeResult;
    // The acceptance run and its judgement are the size of a small document and are read
    // one project at a time (Project Details, live progress). The list ships the compact
    // founder-facing verdict instead, so a table of 100 projects does not carry 100 runs.
    delete copy.runtimeAcceptance; delete copy.runtimeAcceptanceReport; delete copy.runtimeEvidence;
    copy.productionRuntime = describeStoredRuntimeAcceptance(item);
  }
  return copy;
}
// True row counts per entity type. The state lists are deliberately capped (100/300/100)
// so counting them would report "300 tasks / 100 artifacts" forever while the real numbers
// are 738/429. One index-backed GROUP BY, reached only on a cold isolate and only once per
// 5 s snapshot cache. Returns null when D1 is unavailable so the caller can omit totals.
const STATE_TOTALS_TTL = 15000;
let _stateTotals = null; let _stateTotalsTime = 0;
// Cached so the true counts are identical on every isolate and on both the hydrated and
// cold-isolate paths. Before this, the hydrated path summed the row-capped in-memory lists
// (projects/tasks/artifacts) while the cold path used the D1 COUNT — two isolates answering
// the same dashboard refresh reported different numbers, which is exactly the "values change
// when I refresh" report. The 15s TTL keeps the read budget bounded (one GROUP BY per window).
async function safeTypeCounts(env, fresh = false) {
  if (!hasD1(env)) return _stateTotals;
  const nowMs = Date.now();
  if (!fresh && _stateTotals && (nowMs - _stateTotalsTime) < STATE_TOTALS_TTL) return _stateTotals;
  try {
    const rows = await env.DB.prepare("SELECT type, COUNT(*) AS cnt FROM entities WHERE type IN ('projects','tasks','artifacts') GROUP BY type").all();
    const out = { projects: 0, tasks: 0, artifacts: 0 };
    for (const r of (rows?.results ?? [])) if (r && Object.prototype.hasOwnProperty.call(out, r.type)) out[r.type] = Number(r.cnt) || 0;
    _stateTotals = out; _stateTotalsTime = nowMs;
    return out;
  } catch (_) { return _stateTotals; }
}

// Which projects actually shipped code. /api/state caps the artifact list at 100 (429
// exist), so the browser cannot work this out from the payload — it used to gate the
// download / preview / build buttons on that capped sample and hid them for most finished
// projects. Derive it server side and ship one boolean per project.
function codeProjectIds(artifacts) {
  return new Set((Array.isArray(artifacts) ? artifacts : []).filter(a => a && a.type === 'code-workspace').map(a => a.projectId));
}

// Which of those can actually become an APK. hasCode only says a code-workspace
// artifact exists; Capacitor needs www/index.html (its webDir) on top of that. A
// project can be full of server-side files — server.js, package.json, README.md —
// and still have no web app at all. Offering such a project a 📱 button and then
// refusing it on click is the worst of both answers, so the client is told up front.
function buildableProjectIds(artifacts) {
  const out = new Set();
  for (const a of (Array.isArray(artifacts) ? artifacts : [])) {
    if (!a || a.type !== 'code-workspace' || !a.projectId) continue;
    const files = a.content?.files;
    if (Array.isArray(files) && files.some(f => f?.path === 'www/index.html')) out.add(a.projectId);
  }
  return out;
}

function compactStateList(list, type) { return (Array.isArray(list) ? list : []).map(item => compactStateItem(item, type)); }

// A serving isolate hydrates once and then answers from memory; if it hydrated while a
// command was still being written it can hold the project row without its tasks, and it
// never re-hydrates. That is why the Project Details / live-progress screens flipped
// between the real task list and an empty one across refreshes. These founder-facing
// screens now read tasks from D1 behind a short cache (also merging any missing rows back
// into the store so the scheduler sees work written by other isolates). The cache keeps the
// live card's 5 s poll cheap: at most one bounded tasks read per window.
const D1_TASK_CACHE_TTL = 20000;
const _d1TaskCache = { at: 0, rows: null };
async function d1TasksFresh(env) {
  if (!hasD1(env)) return null;
  if (Array.isArray(_d1TaskCache.rows) && (Date.now() - _d1TaskCache.at) < D1_TASK_CACHE_TTL) return _d1TaskCache.rows;
  try {
    const rows = await d1List(env, 'tasks', { limit: 1500 });
    _d1TaskCache.rows = rows; _d1TaskCache.at = Date.now();
    const bucket = store.data.get('tasks') ?? new Map();
    for (const t of rows) if (t?.id && !bucket.has(t.id)) bucket.set(t.id, t);
    if (bucket.size) store.data.set('tasks', bucket);
    return rows;
  } catch (_) { return _d1TaskCache.rows; }
}
// Test hook: the cache is module-level by design, so tests that swap the D1 double need a
// way to force a cold read.
export function __resetD1TaskCache() { _d1TaskCache.at = 0; _d1TaskCache.rows = null; }

// A single failed D1 read must not discard the whole snapshot. Cold isolates routinely
// race the background hydration, and an all-or-nothing snapshot used to throw and fall
// back to the (empty) in-memory state — which is what made the dashboard counters
// randomly read 0 projects / 0 tasks / 0 artifacts. Read each collection defensively.
// D1 read failures used to be swallowed, which is why the dashboard could blank to zeros
// with nothing in the logs to explain it. Keep a small, permanent record of the last
// failure per collection and surface it on /api/health so the cause is always visible.
const _stateReadFailures = new Map();
const _stateDegradedCount = { count: 0, lastReason: null, lastAt: null };
function noteStateReadFailure(type, error, recovered = false) {
  const reason = (error?.message ?? String(error ?? 'unknown')).slice(0, 200);
  const at = new Date().toISOString();
  _stateReadFailures.set(type, { reason, at, recovered });
  if (recovered) _stateDegradedCount.recovered = ( _stateDegradedCount.recovered ?? 0 ) + 1;
  else _stateDegradedCount.count++;
  _stateDegradedCount.lastReason = `${type}: ${reason}${recovered ? ' (recovered on retry)' : ''}`;
  _stateDegradedCount.lastAt = at;
  console.warn(`state read failed (${type}):`, reason, recovered ? '(recovered on retry)' : '(unrecovered)');
}
function stateDiagnostics() {
  const hydration = Array.isArray(store.hydrateErrors) ? store.hydrateErrors.slice(-5) : [];
  // Hydration failures are the ones that used to vanish: hydrateOnce() swallowed them,
  // so an isolate could stay unhydrated forever with nothing on /api/health to say why.
  const hydrateFailures = Array.isArray(store.hydrateFailures) ? store.hydrateFailures : [];
  return {
    degradedCount: _stateDegradedCount.count,
    recoveredCount: _stateDegradedCount.recovered ?? 0,
    lastReason: _stateDegradedCount.lastReason,
    lastAt: _stateDegradedCount.lastAt,
    readFailures: Object.fromEntries(_stateReadFailures),
    hydrateFailures,
    hydrateErrors: hydration,
    unhydratedSinceHydrateError: hydrateFailures.length > 0,
  };
}
async function safeD1List(env, type, opts) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await d1List(env, type, opts); }
    catch (error) {
      // Record every failure, including one the retry recovers from. A read that only
      // succeeds on the second attempt is still a real D1 problem worth seeing.
      noteStateReadFailure(type, error, attempt === 0);
      if (attempt === 0) { await new Promise(r => setTimeout(r, 120)); }
    }
  }
  return null;
}
async function stateSnapshot(env) {
  const nowMs = Date.now();
  if (_stateSnapshot && (nowMs - _stateSnapshotTime) < STATE_SNAPSHOT_TTL) return _stateSnapshot;
  // Keep the cold-isolate snapshot deliberately small: 5M D1 rows_read/day is an account limit.
  // The limits mirror the warm in-memory caps (100/300/100) so the counters read the same
  // before and after hydration instead of visibly jumping. The 5s cache keeps the cost
  // bounded, and once the isolate is hydrated this path is never taken again.
  const tasks = (await safeD1List(env, 'tasks', { limit: 300 })) ?? _lastGoodSnapshot?.tasks ?? [];
  const [agents, projects, approvals, artifacts, events] = await Promise.all([
    safeD1List(env, 'agents', { limit: 50 }),
    safeD1List(env, 'projects', { existingTasks: tasks, limit: 100 }),
    safeD1List(env, 'approvals', { limit: 50 }),
    safeD1List(env, 'artifacts', { limit: 100 }),
    d1Events(env, 30).catch((error) => { noteStateReadFailure('events', error); return []; })
  ]);
  // A collection that failed to read falls back to the last good copy so a transient D1
  // error can never present the dashboard with less data than we already know about.
  const keep = (fresh, key) => Array.isArray(fresh) ? fresh : (_lastGoodSnapshot?.[key] ?? []);
  const agentList = keep(agents, 'agents');
  const projectList = keep(projects, 'projects');
  const taskList = Array.isArray(tasks) ? tasks : keep(null, 'tasks');
  const approvalList = keep(approvals, 'approvals');
  const artifactList = keep(artifacts, 'artifacts');
  const eventList = Array.isArray(events) ? events : keep(null, 'events');
  const totals = await safeTypeCounts(env);
  const codeProjects = codeProjectIds(artifactList);
  const buildable = buildableProjectIds(artifactList);
  const withCode = p => {
    const hasCode = codeProjects.has(p && p.id);
    return { ...p, hasCode, canBuild: hasCode && buildable.has(p && p.id) };
  };
  const snapshot = {
    agents: compactStateList(dedupeAgentList(agentList).slice(0,50),'agents'),
    projects: compactStateList(projectList,'projects').map(withCode),
    tasks: compactStateList(taskList,'tasks'),
    approvals: compactStateList(approvalList,'approvals'),
    artifacts: compactStateList(artifactList,'artifacts'),
    events: compactStateList(eventList,'events'),
    // True when at least one collection could not be read this time; the client keeps
    // its existing rows instead of blanking the screen.
    degraded: agents === null || projects === null || artifacts === null || !Array.isArray(tasks),
    // Which collection failed, so a blanked dashboard is explainable without log access.
    degradedReason: [
      agents === null ? 'agents' : null,
      projects === null ? 'projects' : null,
      artifacts === null ? 'artifacts' : null,
      !Array.isArray(tasks) ? 'tasks' : null,
    ].filter(Boolean).join(',') || null,
    summary: { projects: projectList.length, tasks: taskList.length, running: taskList.filter(t => ['working','assigned'].includes(t.state)).length, failed: taskList.filter(t => t.state === 'failed').length, artifacts: artifactList.length, ...(totals ? { totals } : {}) }
  };
  // Only promote a snapshot that actually read something into the "last good" slot.
  if (!snapshot.degraded || agentList.length) _lastGoodSnapshot = snapshot;
  _stateSnapshot = snapshot;
  _stateSnapshotTime = Date.now();
  return snapshot;
}
// Assembles the /api/state payload. A cold isolate prefers the D1 snapshot over the
// in-memory store; if D1 reads fail we still serve the last good snapshot and flag the
// response as degraded instead of blanking the dashboard to zeros.
async function statePayload(env, recoveredRuns) {
  const memoryState = async () => {
    const storeArtifacts = store.list('artifacts');
    const codeProjects = codeProjectIds(storeArtifacts);
    const buildable = buildableProjectIds(storeArtifacts);
    const projects = compactStateList(listProjects().slice(-100),'projects').map(p => {
      const hasCode = codeProjects.has(p && p.id);
      return { ...p, hasCode, canBuild: hasCode && buildable.has(p && p.id) };
    });
    const tasks = compactStateList(listTasks().slice(-300),'tasks');
    const artifacts = compactStateList(store.list('artifacts').slice(-100),'artifacts');
    const agents = compactStateList(listAgents().slice(0,50),'agents');
    const approvals = compactStateList(listApprovals().slice(-50),'approvals');
    const events = compactStateList(store.recentEvents(30),'events');
    // Totals come from the same cached D1 COUNT the cold-isolate snapshot uses, so the
    // counters are identical whichever isolate answers a refresh (the capped in-memory
    // lists below them differ by isolate, the numbers must not).
    const totals = await safeTypeCounts(env) ?? { projects: listProjects().length, tasks: listTasks().length, artifacts: store.list('artifacts').length };
    return { agents, projects, tasks, approvals, tools:listTools().slice(0,50), artifacts, events, recoveredRuns, degraded:false, summary:{ projects: totals.projects, tasks: totals.tasks, running: tasks.filter(t => ['working','assigned'].includes(t.state)).length, failed: tasks.filter(t => t.state === 'failed').length, artifacts: totals.artifacts, totals } };
  };
  if (store.hydrated) return memoryState();
  if (hasD1(env)) {
    try {
      const snap = await stateSnapshot(env);
      if (snap && (snap.projects.length || snap.tasks.length || snap.agents.length)) {
        return { ...snap, tools:listTools().slice(0,50), recoveredRuns, snapshot:true };
      }
    } catch (error) { noteStateReadFailure('snapshot', error); }
  }
  // Nothing readable from D1 yet. Returning the bare in-memory state here is what made
  // the counters read 0 — flag it so the client keeps whatever it already rendered.
  const fallback = await memoryState();
  _stateDegradedCount.count++;
  _stateDegradedCount.lastAt = new Date().toISOString();
  return { ...fallback, degraded: true, coldIsolate: true, degradedReason: 'no-readable-state' };
}
function ensureTools() {
  if (_toolsReady) return;
  _toolsReady = true;
  ensureBuiltinTools();
  seedAgents();
}

export default { async fetch(request, env, ctx) { try {
  await initOnce(env, ctx);
  ensureTools();
  const recoveredRuns=recoverRunningExecutions();
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/') return new Response(dashboardHTML(),{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store'}});
  if(request.method==='GET'&&url.pathname==='/api/usage'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const report=await getUsageReport(env);const cfReport=await import('./cloudflare-api.js').then(m=>m.getFullUsageReport(env)).catch(()=>null);if(cfReport&&cfReport.apiConnected){report.d1.cfTotalMB=cfReport.d1.totalMB;report.d1.cfPercent=cfReport.d1.percent;report.d1.cfAvailable=true;}return ok({usage:report});}
  if(request.method==='POST'&&url.pathname==='/api/cleanup'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request).catch(()=>({}));const result=await cleanupD1(env,body);return ok({cleanup:result});}
  // ── SYSTEM STATUS: Full health check with all subsystems ──
  if(request.method==='GET'&&url.pathname==='/api/system-status'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projects=listProjects();const tasks=listTasks();const agents=listAgents();const tools=listTools();
    const running=tasks.filter(t=>['working','assigned'].includes(t.state)).length;
    const completed=tasks.filter(t=>t.state==='completed').length;
    const failed=tasks.filter(t=>t.state==='failed').length;
    const queued=tasks.filter(t=>t.state==='queued').length;
    const approvals=listApprovals().filter(a=>a.state==='pending').length;
    const artifacts=store.list('artifacts').length;
    const executions=store.list('runs').length;
    const rateLimit=getRateLimitStats();
    const learning=getSystemLearningStats();
    return ok({
      service:'mauli2.0',version:'2.0.0',status:'healthy',time:now(),
      persistence:{d1:hasD1(env),hydrated:store.hydrated},
      ai:{cloudflare:Boolean(env?.AI),ollama:false},
      stats:{projects:projects.length,tasks:tasks.length,agents:agents.length,tools:tools.length,artifacts,executions,approvals},
      tasks:{running,completed,failed,queued,total:tasks.length},
      agents:{total:agents.length,available:agents.filter(a=>a.state==='available').length,working:agents.filter(a=>a.state==='working').length},
      rateLimit,learning
    });
  }
  // ── SYSTEM METRICS: Store health and data integrity ──
  if(request.method==='GET'&&url.pathname==='/api/system-metrics'){const founder=requireFounder(request,env);if(!founder.ok)return fail(founder.error,founder.status);
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const metrics=store.metrics();
    const integrity=store.integrity();
    return ok({metrics,integrity});
  }
  // ── PROJECT ANALYTICS: Detailed insights for a project ──
  if(request.method==='GET'&&url.pathname==='/api/project-analytics'){const founder=requireFounder(request,env);if(!founder.ok)return fail(founder.error,founder.status);
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.searchParams.get('projectId');
    const projects=listProjects();const allTasks=listTasks();const allArtifacts=store.list('artifacts');
    const allRuns=store.list('runs');
    if(projectId){
      const project=projects.find(p=>p.id===projectId);
      if(!project)return fail('Project not found',404);
      const tasks=allTasks.filter(t=>t.projectId===projectId);
      const artifacts=allArtifacts.filter(a=>a.projectId===projectId);
      const runs=allRuns.filter(r=>tasks.some(t=>t.id===r.taskId));
      const completed=tasks.filter(t=>t.state==='completed').length;
      const failed=tasks.filter(t=>t.state==='failed').length;
      const avgDuration=runs.filter(r=>r.completedAt&&r.startedAt).map(r=>Date.parse(r.completedAt)-Date.parse(r.startedAt)).reduce((a,b)=>a+b,0)/(runs.length||1);
      return ok({project,tasks:tasks.length,completed,failed,artifacts:artifacts.length,runs:runs.length,avgDurationMs:Math.round(avgDuration),progressPct:tasks.length?Math.round(completed/tasks.length*100):0,createdAt:project.createdAt,updatedAt:project.updatedAt});
    }
    // Global analytics
    const byState={};for(const p of projects){const s=p.state||'unknown';byState[s]=(byState[s]||0)+1;}
    const byAgent={};for(const t of allTasks){const a=t.agentId||t.assignedAgentId||'unassigned';byAgent[a]=(byAgent[a]||0)+1;}
    const completedRuns=allRuns.filter(r=>r.state==='completed');
    const avgRunDuration=completedRuns.filter(r=>r.completedAt&&r.startedAt).map(r=>Date.parse(r.completedAt)-Date.parse(r.startedAt)).reduce((a,b)=>a+b,0)/(completedRuns.length||1);
    return ok({analytics:{projects:projects.length,tasks:allTasks.length,artifacts:allArtifacts.length,runs:allRuns.length,byState,byAgent,avgRunDurationMs:Math.round(avgRunDuration),completionRate:allTasks.length?Math.round(allTasks.filter(t=>t.state==='completed').length/allTasks.length*100):0}});
  }
  if(request.method==='GET'&&url.pathname==='/api/platforms'){return ok({platforms:PLATFORMS.map(({id,label,icon})=>({id,label,icon})),default:DEFAULT_PLATFORM});}
  if(request.method==='GET'&&url.pathname==='/api/health'){const blocked=d1WriteBlockedSnapshot(env);
    // The AI binding being present says nothing about whether generation still works: the
    // free Workers AI allowance is a daily budget, and once it is spent every generation
    // fails while `ai:true` still reports green. Surface the last recorded verdict so a
    // stalled project is explained instead of mysterious.
    const aiStatus=store.get('ai_status','workers-ai')??(await d1Get(env,'ai_status','workers-ai').catch(()=>null));
    const aiAvailable=Boolean(env?.AI)&&aiStatus?.available!==false;
    return ok({service:'mauli2.0',// An account-level D1 write ceiling is not "healthy": every write is being rejected,
    // so nothing can progress and the founder needs to see that rather than a stall.
    status:blocked?'degraded':(env?.AI&&!aiAvailable?'degraded':'healthy'),degraded:Boolean(blocked)||Boolean(env?.AI&&!aiAvailable),degradedReason:blocked?'d1-write-limit':(env?.AI&&!aiAvailable?(aiStatus?.exhausted?'workers-ai-allowance-exhausted':'workers-ai-unavailable'):null),persistence:hasD1(env),durableObjects:Boolean(env?.MAULI_PROJECT_EXECUTOR),hydrated:store.hydrated,ai:Boolean(env?.AI),aiAvailable,aiReason:aiStatus?.reason??null,aiSince:aiStatus?.at??null,recoveredRuns:recoveredRuns.length,d1Quota:d1QuotaSnapshot(env),d1ReadQuota:d1ReadQuotaSnapshot(env),d1WriteSources:d1WriteSourcesSnapshot(env),d1WriteBlocked:blocked,stateReads:stateDiagnostics(),time:now()});}
  if(request.method==='GET'&&url.pathname==='/api/heartbeat') return ok({alive:true,uptime:Date.now(),heartbeat:now(),builds:store.list('builds').length,projects:store.list('projects').length,agents:store.list('agents').length});
  // The Integrations page used to render six hardcoded cards that always said "Configured" /
  // "Connected" / "Bound" / "Deployed" and never asked the Worker anything — so an unset
  // GITHUB_TOKEN and a missing D1 binding looked exactly like a healthy deployment. Every row
  // here is derived from the environment and live store state, and it reports `missing` when
  // the thing is genuinely absent instead of a reassuring label. Only presence is reported;
  // no credential value ever leaves the Worker.
  if(request.method==='GET'&&url.pathname==='/api/integrations'){
    const d1Blocked=d1WriteBlockedSnapshot(env);
    const aiStatus=store.get('ai_status','workers-ai')??(await d1Get(env,'ai_status','workers-ai').catch(()=>null));
    const founder=founderAuthStatus(env);
    // Both catalogs are objects keyed by id / category, not arrays — calling .length on them
    // read "undefined" and the page printed "undefined in catalog".
    const mcpServers=Object.values(getAllMCPServers());
    const mcpCategories=Object.keys(getMCPCategories());
    const apiCatalog=Object.values(getAPICatalog()).flat();
    const apiCategories=getAPICategories();
    const rows=[
      {id:'workers',name:'Cloudflare Workers',icon:'☁️',category:'Hosting',hint:'This dashboard is being served by it.',
        ok:true,status:'connected',statusLabel:'Live',detail:'Serving this dashboard over '+String(env?.ENVIRONMENT??'production')},
      {id:'d1',name:'D1 Database',icon:'💾',category:'Persistence',hint:'Bind a D1 database so projects survive a cold isolate.',
        ok:hasD1(env)&&!d1Blocked,status:!hasD1(env)?'missing':d1Blocked?'warning':'connected',
        statusLabel:!hasD1(env)?'Not bound':d1Blocked?'Writes blocked':'Connected',
        detail:!hasD1(env)?'No D1 binding on this Worker':d1Blocked?'Every D1 write is being refused ('+String(d1Blocked.reason??d1Blocked)+')':'Rows readable and writable'},
      {id:'ai',name:'Cloudflare AI',icon:'🧠',category:'LLM',hint:'Bind AI so product code can be generated.',
        ok:Boolean(env?.AI)&&aiStatus?.available!==false,status:!env?.AI?'missing':aiStatus?.available===false?'warning':'connected',
        statusLabel:!env?.AI?'Not bound':aiStatus?.available===false?'Unavailable':'Bound',
        detail:!env?.AI?'No AI binding on this Worker':aiStatus?.available===false?String(aiStatus?.reason??'generation is failing'):'Generation requests accepted'},
      {id:'do',name:'Durable Objects',icon:'🧱',category:'Runtime',hint:'Used for project execution and live channels.',
        ok:Boolean(env?.MAULI_PROJECT_EXECUTOR),status:env?.MAULI_PROJECT_EXECUTOR?'connected':'missing',
        statusLabel:env?.MAULI_PROJECT_EXECUTOR?'Bound':'Not bound',
        detail:env?.MAULI_PROJECT_EXECUTOR?'Project executor is bound':'MAULI_PROJECT_EXECUTOR binding is absent'},
      {id:'github',name:'GitHub',icon:'🐙',category:'Source control',hint:'Add GITHUB_TOKEN in Settings → Environment to push builds.',
        ok:Boolean(env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT),status:(env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT)?'connected':'missing',
        statusLabel:(env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT)?'Configured':'No token',
        detail:(env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT)?'A token is set':'GITHUB_TOKEN, MAULI_GITHUB_TOKEN and GITHUB_PAT are all unset'},
      {id:'deploy',name:'Deploy Executor',icon:'🚀',category:'Deployment',hint:'Needed for MAULI to deploy a generated project itself.',
        ok:Boolean(env?.MAULI_DEPLOY_EXECUTOR),status:env?.MAULI_DEPLOY_EXECUTOR?'connected':'missing',
        statusLabel:env?.MAULI_DEPLOY_EXECUTOR?'Configured':'Not configured',
        detail:env?.MAULI_DEPLOY_EXECUTOR?'Projects can be deployed automatically':'MAULI_DEPLOY_EXECUTOR is unset, so deploys report NOT_DEPLOYED'},
      {id:'runtime',name:'Runtime Executor',icon:'🧪',category:'Acceptance',hint:'Runs the acceptance suite against a real deployment.',
        ok:Boolean(env?.MAULI_RUNTIME_EXECUTOR),status:env?.MAULI_RUNTIME_EXECUTOR?'connected':'missing',
        statusLabel:env?.MAULI_RUNTIME_EXECUTOR?'Configured':'Not configured',
        detail:env?.MAULI_RUNTIME_EXECUTOR?'Acceptance runs can be produced':'MAULI_RUNTIME_EXECUTOR is unset, so runtime acceptance is BLOCKED'},
      {id:'mcp',name:'MCP Servers',icon:'🔌',category:'Agent tools',hint:'Tool servers MAULI can hand to an agent.',
        ok:mcpServers.length>0,status:mcpServers.length>0?'connected':'warning',
        statusLabel:mcpServers.length+' in catalog',
        detail:mcpServers.length?mcpCategories.length+' categor'+(mcpCategories.length===1?'y':'ies')+' available to agents':'No MCP servers are registered'},
      {id:'apis',name:'Public APIs',icon:'🧾',category:'Agent tools',hint:'MAULI can call these when a project needs them.',
        ok:apiCatalog.length>0,status:apiCatalog.length>0?'connected':'warning',
        statusLabel:apiCatalog.length+' in catalog',
        detail:apiCatalog.length?apiCategories.length+' categor'+(apiCategories.length===1?'y':'ies')+' available':'No public APIs are registered'},
      {id:'founder',name:'Founder Key',icon:'🔑',category:'Access',hint:'Set MAULI_FOUNDER_KEY so chat and protected routes need it.',
        ok:founder.enforced,status:founder.keyless?'warning':founder.keyConfigured?'connected':'missing',
        statusLabel:founder.keyless?'Keyless mode':founder.keyConfigured?'Enforced':'Not configured',
        detail:founder.keyless?'Protected routes are open to anyone who can reach this URL':founder.keyConfigured?'Protected routes require the founder key':'MAULI_FOUNDER_KEY is unset, so this deployment answers 503 on protected routes'},
    ];
    const counts={connected:0,warning:0,missing:0};
    for(const row of rows)counts[row.status]=(counts[row.status]??0)+1;
    return ok({integrations:rows,counts,checkedAt:now()});
  }
  if(request.method==='POST'&&url.pathname==='/api/ai/code-probe'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const body=await json(request).catch(()=>({}));
    const objective=String(body.objective??'Build a simple calculator web app').slice(0,400);
    // Deliberately performs NO store write. The point of this route is to answer "is the
    // AI path working?" in exactly the conditions where it is otherwise untestable — while
    // D1 writes are refused, the command endpoint cannot get far enough to reach the AI.
    const {probeAiGeneration}=await import('./functional-code-executor.js');
    const probe=await probeAiGeneration(objective,{env,acceptance:Array.isArray(body.acceptance)?body.acceptance:[],includeContent:body.includeContent===true||body.download===true}).catch(error=>({available:true,generated:false,error:String(error?.message??error)}));
    // A generated app that cannot be taken away is still not a delivered app. When
    // persistence is refused, the zip is built here and streamed straight out — so the
    // founder can open and run real AI-written code in the same minute it was generated.
    if(body.download===true&&probe?.generated){
      const files=(probe.files??[]).map(f=>({path:f.path,content:f.content??''}));
      if(files.length){
        const zip=createZip(files);
        const safe=objective.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'mauli-app';
        return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="mauli-${safe}.zip"`,'cache-control':'private, no-store'}});
      }
    }
    return ok({probe:{objective,...probe}});
  }
  if(request.method==='POST'&&url.pathname==='/api/maintenance/recover-stuck'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request).catch(()=>({}));const report=await recoverStuckProjects({dryRun:body.dryRun===true});return ok({recoverStuck:report,projects:report.reports});}
  if(request.method==='POST'&&url.pathname==='/api/reset'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request).catch(()=>({}));const keepAgents=body.keepAgents!==false;const before={projects:store.list('projects').length,tasks:store.list('tasks').length,artifacts:store.list('artifacts').length};store.put('projects',[]);store.put('tasks',[]);store.put('artifacts',[]);store.put('builds',[]);store.put('events',[]);store.put('approvals',[]);if(!keepAgents){const agents=store.list('agents');const fresh=agents.filter(a=>a._builtin);store.put('agents',fresh);}await store.flush();if(hasD1(env)){try{await env.DB.prepare('DELETE FROM entities').run();await env.DB.prepare('DELETE FROM events').run();}catch(e){console.warn('D1 reset failed:',e.message);}}store.addEvent('system.reset',{before,keepAgents,time:now()});return ok({reset:true,before,keepAgents});}
  if(request.method==='GET'&&url.pathname==='/api/state'){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});return ok(await statePayload(env, recoveredRuns));}
  if(request.method==='GET'&&url.pathname==='/api/self-test'){const founder=requireFounder(request,env);if(!founder.ok)return fail(founder.error,founder.status);const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const result=runL1SelfTest();store.addEvent('self_test.completed',{score:result.score,status:result.status});return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/result-diagnostic'){const founder=requireFounder(request,env);if(!founder.ok)return fail(founder.error,founder.status);const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});try{const result=await Promise.race([diagnoseResultPersistence(env),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))]);store.addEvent('result_persistence.diagnostic',{ok:result.ok,tokenConfigured:result.tokenConfigured,reason:result.reason||null});return ok({result});}catch(e){return ok({result:{ok:false,tokenConfigured:false,reason:e.message||'Diagnostic failed'}})}}
  // List all command results
  if(request.method==='GET'&&url.pathname==='/api/results'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const results=listCommandResults();return ok({results,count:results.length});}
  // Get specific command result
  if(request.method==='GET'&&url.pathname.startsWith('/api/results/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const rid=url.pathname.split('/api/results/')[1];const r=getCommandResult(rid);if(!r)return fail('Result not found',404);return ok({result:r});}
  // Agent Messages API
  if(request.method==='GET'&&url.pathname==='/api/messages'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const agentId=url.searchParams.get('agentId');const limit=parseInt(url.searchParams.get('limit')||'50');const msgs=getMessages(agentId,{unread:url.searchParams.get('unread')==='true',limit:Number.isFinite(limit)?limit:50});return ok({messages:msgs});}
  if(request.method==='POST'&&url.pathname==='/api/messages/send'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const msg=sendMessage(body);return ok({message:msg});}
  if(request.method==='POST'&&url.pathname.startsWith('/api/messages/')&&url.pathname.endsWith('/acknowledge')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const msgId=parts[parts.length-2];const body=await request.json();const msg=acknowledgeMessage(msgId,body.agentId);return ok({message:msg});}
  if(request.method==='POST'&&url.pathname.startsWith('/api/messages/')&&url.pathname.endsWith('/respond')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const msgId=parts[parts.length-2];const body=await request.json();const msg=respondToMessage(msgId,body.agentId,body.response);return ok({message:msg});}
  if(request.method==='POST'&&url.pathname==='/api/messages/broadcast'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const msgs=broadcastAlert(body);return ok({messages:msgs});}
  // Learning & Skills API
  if(request.method==='GET'&&url.pathname==='/api/learning/stats'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({stats:getSystemLearningStats()});}
  if(request.method==='GET'&&url.pathname==='/api/learning/skill-tree'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const agentId=url.searchParams.get('agentId');if(agentId)return ok({skillTree:getAgentSkillTree(agentId),collaboration:getAgentCollaborationStats(agentId)});const tree={},collaboration={};for(const agent of listAgents()){const skills=agent.metadata?.skillTree??{};if(Object.keys(skills).length)tree[agent.name]=skills;const collab=agent.metadata?.collaboration??{};if(Object.keys(collab).length)collaboration[agent.name]=collab;}return ok({skillTree:tree,collaboration});}
  if(request.method==='GET'&&url.pathname==='/api/collaboration/stats'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({stats:getCollaborationStats()});}
  if(request.method==='GET'&&url.pathname==='/api/agents/best'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const caps=(url.searchParams.get('capabilities')||'').split(',').filter(Boolean);const best=getBestAgentForTask(caps);return ok({agent:best});}
  // ── WEBHOOKS ──
  if(request.method==='GET'&&url.pathname==='/api/webhooks'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({webhooks:listWebhooks()});}
  if(request.method==='POST'&&url.pathname==='/api/webhooks'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request);if(!body.url)return fail('URL is required',400);try{const wh=registerWebhook(body);return ok({webhook:wh},201)}catch(e){return fail(e.message,400)}}
  if(request.method==='PUT'&&url.pathname.startsWith('/api/webhooks/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const whId=url.pathname.split('/').pop();const body=await json(request);const wh=updateWebhook(whId,body);if(!wh)return fail('Webhook not found',404);return ok({webhook:wh})}
  if(request.method==='DELETE'&&url.pathname.startsWith('/api/webhooks/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const whId=url.pathname.split('/').pop();const deleted=deleteWebhook(whId);if(!deleted)return fail('Webhook not found',404);return ok({deleted:true})}
  if(request.method==='GET'&&url.pathname.includes('/deliveries')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const whId=parts[parts.indexOf('webhooks')+1];return ok({deliveries:getWebhookDeliveries(whId)})}
  if(request.method==='POST'&&url.pathname.includes('/retry')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const deliveryId=parts[parts.indexOf('retry')-1];const result=await retryDelivery(deliveryId);if(!result)return fail('Delivery not found',404);return ok({delivery:result})}
  // ── NOTIFICATIONS ──
  if(request.method==='GET'&&url.pathname==='/api/notifications'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const unreadOnly=url.searchParams.get('unread')==='true';const limit=parseInt(url.searchParams.get('limit')||'50');return ok({notifications:getNotifications('founder',{unreadOnly,limit}),unreadCount:getUnreadCount('founder')})}
  if(request.method==='POST'&&url.pathname==='/api/notifications/read'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request);if(body.id){markRead(body.id);return ok({marked:1})}markAllRead('founder');return ok({marked:'all'})}
  if(request.method==='DELETE'&&url.pathname==='/api/notifications'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request).catch(()=>({}));if(body.id){deleteNotification(body.id);return ok({deleted:1})}clearAll('founder');return ok({cleared:'all'})}
  // ── VERSION HISTORY ──
  if(request.method==='GET'&&url.pathname==='/api/versions'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');if(!projectId)return fail('projectId required',400);return ok({versions:getVersionHistory(projectId),stats:getVersionStats(projectId)})}
  if(request.method==='POST'&&url.pathname==='/api/versions'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request);if(!body.projectId)return fail('projectId required',400);const version=createVersion(body.projectId,body);if(!version)return fail('Project not found',404);return ok({version},201)}
  if(request.method==='GET'&&url.pathname.startsWith('/api/versions/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const vId=url.pathname.split('/').pop();const version=getVersion(vId);if(!version)return fail('Version not found',404);return ok({version})}
  if(request.method==='POST'&&url.pathname.includes('/compare')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request);if(!body.version1||!body.version2)return fail('version1 and version2 required',400);const comparison=compareVersions(body.version1,body.version2);if(!comparison)return fail('Versions not found',404);return ok({comparison})}
  if(request.method==='POST'&&url.pathname.includes('/restore')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await json(request);if(!body.versionId)return fail('versionId required',400);const restored=restoreVersion(body.versionId);if(!restored)return fail('Version not found',404);return ok({project:restored})}
  // Chat API
  if(request.method==='POST'&&url.pathname==='/api/chat'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const limit=checkCommandRateLimit(request,'chat');if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});try{const body=await request.json();const msgValidation=validateString(body.message,'message',{minLength:1,maxLength:5000});if(!msgValidation.ok)return fail(msgValidation.error,400);const result=await processChatMessage({message:msgValidation.value,userId:'founder',env});return ok({result});}catch(e){return ok({result:{reply:'I had trouble processing that. Try again!',error:e.message}})}}
  if(request.method==='GET'&&url.pathname==='/api/chat/history'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const limit=parseInt(url.searchParams.get('limit')||'50');return ok({messages:getChatHistory({limit})});}
  if(request.method==='GET'&&url.pathname==='/api/chat/active'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({conversations:getActiveConversations()});}
  // File Edit API — reads and writes the generated project workspace, while retaining
  // the edit history used by the dashboard. The previous UI-only audit records did not
  // update the actual artifact, so Load always 404'd and Save never changed the product.
  if(request.method==='GET'&&url.pathname==='/api/edits'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.searchParams.get('projectId');const filePath=url.searchParams.get('filePath');
    if(!projectId)return fail('projectId required',400);
    // Same authority as /api/app-files, the build path and /api/project-download: every
    // code-workspace artifact D1 holds for the project, de-duplicated by path. The
    // row-capped cache listed the same file once per artifact (www/index.html twice for
    // this project, six times for others) and hid projects whose artifact had not been
    // hydrated into the answering isolate at all.
    const artifacts=await projectCodeArtifacts(projectId,env);
    const files=collectProjectFiles(projectId,null,store,artifacts);
    if(filePath){const file=files.find(f=>f.path===filePath);if(!file)return fail('File not found',404);return ok({file:{projectId,path:file.path,content:file.content},files:files.map(f=>({path:f.path}))});}
    return ok({files:files.map(f=>({path:f.path})),count:files.length});
  }
  if(request.method==='POST'&&url.pathname==='/api/edits'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const body=await json(request);const projectId=String(body.projectId||'').trim();const filePath=String(body.filePath||'').trim();const content=typeof body.content==='string'?body.content:null;
    if(!projectId||!filePath||content===null)return fail('projectId, filePath and content are required',400);
    const workspaceArtifacts=(await projectCodeArtifacts(projectId,env)).filter(a=>Array.isArray(a.content?.files));
    const artifact=workspaceArtifacts.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    if(!artifact)return fail('Project code workspace not found',404);
    const files=[...(artifact.content?.files||[])];const index=files.findIndex(f=>f.path===filePath);
    if(index<0)return fail('File not found',404);
    const oldContent=files[index].content;if(oldContent===content)return ok({file:{projectId,path:filePath,content},unchanged:true});
    files[index]={...files[index],content};store.put('artifacts',{...artifact,content:{...artifact.content,files},updatedAt:now()});
    const edit=editFile({projectId,filePath,operation:body.operation||'update',oldContent,newContent:content,description:body.description||`Update ${filePath}`});
    return ok({edit,file:{projectId,path:filePath,content}});
  }
  if(request.method==='GET'&&url.pathname==='/api/edits/recent'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({edits:getRecentEdits()});}
  if(request.method==='GET'&&url.pathname==='/api/edits/history'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');if(!projectId)return fail('projectId required',400);return ok({edits:getEditHistory(projectId)});}
  if(request.method==='POST'&&url.pathname.startsWith('/api/edits/')&&url.pathname.endsWith('/undo')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const editId=parts[parts.length-2];const result=undoEdit(editId);return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/edits/summary'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');if(!projectId)return fail('projectId required',400);return ok({summary:getFileChangeSummary(projectId)});}
  if(request.method==='POST'&&url.pathname==='/api/edits/parse'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const parsed=parseEditCommand(body.text);return ok({parsed});}
  // Live Monitor API
  if(request.method==='GET'&&url.pathname==='/api/live-status'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({status:getLiveStatus()});}
  if(request.method==='GET'&&url.pathname==='/api/activity'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');const agentId=url.searchParams.get('agentId');const limit=parseInt(url.searchParams.get('limit')||'50');return ok({activities:getActivityFeed({limit,projectId,agentId})});}
  if(request.method==='POST'&&url.pathname==='/api/activity'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const activity=recordActivity(body);return ok({activity});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/project-progress/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const pid=parts[parts.length-1];if(store.hydrated)await d1TasksFresh(env);    return ok({progress:{...getProjectProgress(pid),productionRuntime:runtimeAcceptanceSummary(pid)}});}
  // Sub-Agent API
  if(request.method==='POST'&&url.pathname==='/api/sub-agents'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const sub=createSubAgent(body);return ok({subAgent:sub});}
  if(request.method==='GET'&&url.pathname==='/api/sub-agents'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parentId=url.searchParams.get('parentId');if(!parentId)return fail('parentId required',400);return ok({subAgents:getSubAgents(parentId)});}
  if(request.method==='POST'&&url.pathname==='/api/agent-help'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const msg=requestHelp(body);return ok({message:msg});}
  if(request.method==='GET'&&url.pathname==='/api/agent-conversation'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const a1=url.searchParams.get('agent1');const a2=url.searchParams.get('agent2');if(!a1||!a2)return fail('agent1 and agent2 required',400);return ok({messages:getAgentConversation(a1,a2)});}
  // Clone API
  if(request.method==='POST'&&url.pathname==='/api/clone'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=cloneProject(body.projectId,body.newObjective);return ok({result});}
  // ── PRODUCTION RUNTIME ACCEPTANCE (points 6, 15, 16, 17) ──────────────────
  // The structured run is persisted on the project and read back by the pipeline gate, the
  // delivery and the dashboard, so all three judge the same evidence. Recording requires the
  // founder key, and a body that is not shaped like an acceptance run is refused — a
  // hand-written object must never become the evidence a delivery is approved on.
  if(request.method==='GET'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/runtime-acceptance')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const pid=url.pathname.split('/')[3];const project=store.get('projects',pid);
    if(!project)return fail('Project not found',404);
    return ok({projectId:pid,productionRuntime:runtimeAcceptanceSummary(project),runtimeAcceptance:project.runtimeAcceptance??null,recordedAt:project.runtimeAcceptedAt??null});
  }
  if(request.method==='POST'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/runtime-acceptance')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const pid=url.pathname.split('/')[3];const project=store.get('projects',pid);
    if(!project)return fail('Project not found',404);
    const body=await json(request);
    const acceptance=body?.runtimeAcceptance??body?.acceptance??null;
    if(!isRuntimeAcceptanceReport(acceptance))return fail('runtimeAcceptance is not a valid acceptance run: it needs a status of passed|failed|blocked and a non-empty tests map',400);
    try{recordRuntimeAcceptance(pid,acceptance,{},{env});}catch(error){
      // A run produced for a DIFFERENT project is a conflict, not a bad request: the fix is
      // to run the right project, not to change the payload (point 17).
      const message=String(error?.message??error);
      return fail(message,/produced for project/i.test(message)?409:400);
    }
    const stored=store.get('projects',pid);
    return ok({projectId:pid,productionRuntime:runtimeAcceptanceSummary(stored),runtimeAcceptance:stored.runtimeAcceptance,recordedAt:stored.runtimeAcceptedAt});
  }
  if(request.method==='POST'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/runtime-acceptance/run')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const pid=url.pathname.split('/')[3];const project=store.get('projects',pid);
    if(!project)return fail('Project not found',404);
    if(isRuntimeAcceptanceReport(project.runtimeAcceptance))
      return ok({projectId:pid,recorded:false,alreadyRecorded:true,productionRuntime:runtimeAcceptanceSummary(project)});
    const outcome=await ensureRuntimeAcceptance(pid,env);
    if(!outcome.recorded){
      // 424 Failed Dependency: BLOCKED / DEPENDENCY_REQUIRED, not a fabricated PASS.
      return fail(`Production runtime acceptance could not be produced: ${outcome.reason}. Run node scripts/production-runtime.mjs against this project's code and POST the report to /api/projects/${pid}/runtime-acceptance, or configure MAULI_RUNTIME_EXECUTOR (the Node runner).`,424);
    }
    return ok({projectId:pid,recorded:true,productionRuntime:runtimeAcceptanceSummary(store.get('projects',pid))});
  }
  // ── GENERATED PROJECT DEPLOYMENT (points 2, 3, 14) ─────────────────────────
  // A deployment is a record of something that happened to THIS project: its own URL, the
  // artifact whose bytes were deployed, when, and — when it failed — the category and a
  // secret-free message. It is never inferred from "the build succeeded".
  if(request.method==='GET'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/deployment')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const pid=url.pathname.split('/')[3];const project=store.get('projects',pid);
    if(!project)return fail('Project not found',404);
    return ok({projectId:pid,deployment:normalizeDeployment(project.runtimeDeployment??null),productionRuntime:runtimeAcceptanceSummary(project,{env})});
  }
  if(request.method==='POST'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/deployment')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const pid=url.pathname.split('/')[3];const project=store.get('projects',pid);
    if(!project)return fail('Project not found',404);
    const body=await json(request);
    const incoming=body?.deployment??body??null;
    if(incoming?.projectId&&incoming.projectId!==pid)return fail(`Refusing to record a deployment for project ${incoming.projectId} on project ${pid}`,409);
    try{recordGeneratedDeployment(pid,incoming);}catch(error){return fail(String(error?.message??error),400);}
    return ok({projectId:pid,deployment:normalizeDeployment(store.get('projects',pid).runtimeDeployment??null),productionRuntime:runtimeAcceptanceSummary(store.get('projects',pid),{env})});
  }
  if(request.method==='POST'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/deploy')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const pid=url.pathname.split('/')[3];const project=store.get('projects',pid);
    if(!project)return fail('Project not found',404);
    const outcome=await ensureGeneratedDeployment(pid,env);
    const stored=store.get('projects',pid);
    const deployment=normalizeDeployment(stored.runtimeDeployment??null);
    // Point 14: a failed or impossible deployment is a BLOCKED state with its category and
    // timestamp — never a fake success and never a silent skip.
    if(!outcome.deployed)return fail(`Deployment did not succeed for ${pid}: ${outcome.reason??'unknown reason'}`,deployment.status===DEPLOYMENT_STATUS.FAILED?502:424);
    return ok({projectId:pid,deployment,productionRuntime:runtimeAcceptanceSummary(stored,{env})});
  }
  // ── AUTOMATIC PER-PROJECT RUNTIME SWEEP (point 1, 13, 22) ──────────────────
  // Production acceptance is not pinned to one configured project. This walks every
  // project that has generated code and no passing evidence and asks the runners for one.
  if(request.method==='POST'&&url.pathname==='/api/runtime-acceptance/sweep'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const body=await json(request);
    const only=body?.projectId??url.searchParams.get('projectId');
    const limit=Number(body?.limit??url.searchParams.get('limit')??25);
    if(only){
      const outcome=await ensureRuntimeAcceptance(only,env);
      return ok({projects:[{projectId:only,recorded:outcome.recorded===true,blocked:outcome.recorded!==true,reason:outcome.reason??null,verdict:runtimeAcceptanceSummary(only,{env}).label}],swept:1});
    }
    return ok(await sweepRuntimeAcceptance(env,{limit:Number.isFinite(limit)&&limit>0?Math.min(limit,100):25}));
  }
  // Project Detail: full lifecycle JSON for any project
  if(request.method==='GET'&&url.pathname.startsWith('/api/projects/')&&url.pathname.endsWith('/detail')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const parts=url.pathname.split('/');const pid=parts[3];
    // One bounded tasks read feeds both the project state and this project's task list, so
    // the detail screen can never disagree with /api/project-progress about what exists.
    const d1Tasks=store.hydrated?await d1TasksFresh(env):null;
    const allProjects=hasD1(env)&&store.hydrated?await d1List(env,'projects',{existingTasks:d1Tasks??undefined}):listProjects();
    const project=allProjects.find(p=>p.id===pid)||listProjects().find(p=>p.id===pid)||store.get('projects',pid);if(!project)return fail('Project not found',404);
    const tasks=d1Tasks?d1Tasks.filter(t=>t.projectId===pid):store.list('tasks').filter(t=>t.projectId===pid);
    const artifacts=store.list('artifacts').filter(a=>a.projectId===pid);
    const events=store.recentEvents().filter(e=>e.payload?.projectId===pid);
    const approvals=store.list('approvals').filter(a=>a.projectId===pid);
    const agents=store.list('agents');
    // Tasks carry estimatedDurationFormatted as a *persisted* field (completeTask spreads
    // enrichTaskTiming into the store), so a poisoned estimate stayed visible verbatim in
    // the Project Details dump even after the estimator was bounded. Re-enrich on read.
    const enrichedTasks=tasks.map(t=>{const agent=t.assignedAgentId?agents.find(a=>a.id===t.assignedAgentId):null;return{...enrichTaskTiming(t),agentName:agent?.name||null,agentRole:agent?.role||null};});
    const completedCount=tasks.filter(t=>t.state==='completed').length;
    const failedCount=tasks.filter(t=>t.state==='failed').length;
    const runningCount=tasks.filter(t=>['working','assigned'].includes(t.state)).length;
    const started=project.commandStartedAt||project.startedAt||project.commandReceivedAt||project.createdAt; const end=project.commandCompletedAt||project.completedAt||project.failedAt; const totalTimeMs=started?Math.max(0,Date.parse(end||now())-Date.parse(started)):0; // One source of truth for estimates: enrichProjectTiming clamps them, so this cannot
    // disagree with /api/project-progress or resurrect a poisoned stored estimate.
    const timingSummary=enrichProjectTiming(project,tasks); const estimatedDurationMs=timingSummary.estimatedDurationMs; const remainingDurationMs=timingSummary.remainingMs; const fmt=ms=>{const sec=Math.round(Math.max(0,ms)/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return h?h+'h '+m+'m '+s+'s':m?m+'m '+s+'s':s+'s';};
    const detail={project,tasks:enrichedTasks,artifacts,events,approvals,
    // Point 16: the founder must never see a bare "QA Passed". The runtime verdict, its
    // tested-at stamp, the deployment/API/database/auth/journey statuses, the critical
    // pass/fail counts and the exact blocking reason ride on the detail payload.
    productionRuntime:runtimeAcceptanceSummary(project,{env}),runtimeDeployment:normalizeDeployment(project.runtimeDeployment??null),summary:{totalTasks:tasks.length,completedTasks:completedCount,failedTasks:failedCount,runningTasks:runningCount,pendingTasks:tasks.length-completedCount-failedCount-runningCount,progressPct:tasks.length>0?Math.round((completedCount/tasks.length)*100):0,totalTimeMs,totalTimeFormatted:totalTimeMs>0?fmt(totalTimeMs):'In progress',estimatedDurationMs,estimatedDurationFormatted:fmt(estimatedDurationMs),remainingDurationMs,remainingDurationFormatted:fmt(remainingDurationMs),commandReceivedAt:project.commandReceivedAt||project.createdAt,commandStartedAt:started,commandCompletedAt:end,createdAt:project.createdAt,completedAt:project.completedAt||null,failedAt:project.failedAt||null,state:project.state,errors:tasks.filter(t=>t.error).map(t=>({task:t.title,error:t.error,at:t.updatedAt})),fixes:tasks.filter(t=>t.attempts>1).map(t=>({task:t.title,attempts:t.attempts,at:t.updatedAt}))}};
    return ok({detail});
  }
  // Documentation API
  if(request.method==='GET'&&url.pathname.startsWith('/api/docs/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const pid=parts[parts.length-1];const docs=generateProjectDocs(pid);return ok({docs});}
  // Public APIs Integration
  if(request.method==='GET'&&url.pathname==='/api/apis/search'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const q=url.searchParams.get('q')||'';return ok({apis:searchAPIs(q)});}
  if(request.method==='GET'&&url.pathname==='/api/apis/recommend'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const obj=url.searchParams.get('objective')||'';return ok({recommendations:recommendAPIs(obj)});}
  if(request.method==='GET'&&url.pathname==='/api/apis/catalog'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({catalog:getAPICatalog(),categories:getAPICategories()});}
  // MCP Integration
  if(request.method==='GET'&&url.pathname==='/api/mcp/servers'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({servers:getAllMCPServers(),categories:getMCPCategories()});}
  if(request.method==='GET'&&url.pathname==='/api/mcp/for-agent'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const agent=url.searchParams.get('agent');return ok({servers:getMCPForAgent(agent)});}
  if(request.method==='GET'&&url.pathname==='/api/mcp/suggest'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const obj=url.searchParams.get('objective')||'';return ok({servers:suggestMCPForProject(obj)});}
  // Ollama Integration
  if(request.method==='GET'&&url.pathname==='/api/ollama/status'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const status=await checkOllama();return ok({status,models:getRecommendedModels()});}
  if(request.method==='POST'&&url.pathname==='/api/ollama/generate'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=await ollamaGenerate(body.prompt,body.options);return ok({result});}
  if(request.method==='POST'&&url.pathname==='/api/ollama/chat'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=await ollamaChat(body.messages,body.options);return ok({result});}
  if(request.method==='POST'&&url.pathname==='/api/ollama/code'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const body=await request.json();const result=await ollamaCode(body.prompt,body.options);return ok({result});}
  // Scraper
  if(request.method==='GET'&&url.pathname==='/api/scrape'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const target=url.searchParams.get('url');if(!target)return fail('url required',400);const result=await scrapePage(target);return ok({result});}
  if(request.method==='GET'&&url.pathname==='/api/research'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const q=url.searchParams.get('q')||'';const result=await researchTopic(q);return ok({result});}
  // Free Services
  if(request.method==='GET'&&url.pathname==='/api/free-services'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const type=url.searchParams.get('type')||'web';return ok({services:getFreeServices(type),categories:getServiceCategories(),estimate:estimateFreeTierCost(type)});}
  // Design System
  if(request.method==='GET'&&url.pathname==='/api/design/themes'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({themes:getThemes()});}
  if(request.method==='GET'&&url.pathname==='/api/design/css'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const theme=url.searchParams.get('theme')||'dark';return ok({css:generateDesignCSS(theme)});}
  // Agent Patterns
  if(request.method==='GET'&&url.pathname==='/api/patterns'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return ok({patterns:getPatternCategories()});}
  if(request.method==='GET'&&url.pathname==='/api/patterns/recommend'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const obj=url.searchParams.get('objective')||'';const pattern=getPatternForProject(obj);return ok({pattern});}
  if(request.method==='GET'&&url.pathname==='/api/artifacts'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const projectId=url.searchParams.get('projectId');const taskId=url.searchParams.get('taskId');const artifacts=projectId?listProjectArtifacts(projectId):taskId?listTaskArtifacts(taskId):store.list('artifacts');return ok({artifacts});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')&&url.pathname.endsWith('/download')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const parts=url.pathname.split('/');const artifactId=parts[parts.length-2];const artifact=await getArtifactDurable(artifactId,env);if(!artifact)return fail('Artifact not found',404);const safeName=String(artifact.projectId).replace(/[^a-zA-Z0-9_-]/g,'_');let files=collectProjectFiles(artifact.projectId,artifact,store);if(!files.length){const tasks=store.list('tasks').filter(t=>t.projectId===artifact.projectId);const summary=[];summary.push({path:'README.md',content:`# MAULI 2.0 — Project Delivery\\n\\n## Project\\n- **ID:** ${artifact.projectId}\\n- **Type:** ${artifact.type}\\n- **Delivered:** ${new Date().toISOString()}\\n\\n## Tasks (${tasks.length})\\n${tasks.map(t=>`- [${t.state}] ${t.title}${t.assignedAgentId?' (Agent: '+t.assignedAgentId+')':''}`).join('\\n')}\\n`});summary.push({path:'project-data.json',content:JSON.stringify({projectId:artifact.projectId,type:artifact.type,content:artifact.content,metadata:artifact.metadata},null,2)});files=summary;}const zip=createZip(files);return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':`attachment; filename="mauli-${safeName}.zip"`,'cache-control':'private, max-age=300'}});}
  if(request.method==='GET'&&url.pathname.startsWith('/api/artifacts/')){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);return artifactJson(await getArtifactDurable(url.pathname.split('/').pop(),env));}
  if(request.method==='POST'&&url.pathname==='/api/command'){const limit=checkCommandRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const body=await json(request);const cmdValidation=validateString(body.command,'command',{minLength:1,maxLength:2000});if(!cmdValidation.ok)return fail(cmdValidation.error,400);
  // The founder picks the target platform with the command, so the product is built for it
  // from the start. An unrecognised platform is rejected rather than silently replaced: a
  // founder who asked for Android must never be handed a web build that reports success.
  if(body.platform!==undefined&&body.platform!==null&&body.platform!==''&&!normalizePlatform(body.platform))return fail(`Unsupported platform: ${body.platform}. Supported: ${PLATFORMS.map(p=>p.id).join(', ')}`,400);
  const target=resolvePlatform(body.platform,body.command);
  const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const isolatedTest=isIsolatedTestEnv(env);let result;try{result=await Promise.race([planCommand(body.command,env,{platform:target.platform}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),60000))]);}catch(e){return ok({result:{status:'error',error:e.message,command:body.command}});}const persistedPayload={command:body.command,platform:target.platform,generatedAt:now(),result};const saved=isolatedTest?{saved:true,skipped:true,testMode:true}:await saveCommandResult(persistedPayload,env).catch(()=>({saved:false}));return ok({result,resultFile:saved},201);}
  if(request.method==='POST'&&url.pathname.startsWith('/api/approvals/')){const limit=checkRateLimit(request);if(!limit.ok)return fail(limit.error,limit.status,{retryAfter:limit.retryAfter});const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);const approvalId=url.pathname.split('/').pop();const body=await json(request);const pending=store.get('approvals',approvalId);if(!pending)return fail('Approval not found',404);
    // A proper approval opens two gates at once: the approval row becomes 'approved', AND the
    // project + its live tasks are re-queued so the scheduler actually begins the chain.
    // decideApproval() alone only flipped the row, which left the project parked on
    // 'awaiting_approval' — the scheduler skips that state, so an approved command never ran.
    const result=decideApproval(approvalId,Boolean(body.approved),body.note??'');if(result.state==='rejected')return ok({approval:result,status:'rejected'});
    let project=null;
    if(result.projectId){project=store.get('projects',result.projectId);const approved=await import('./governance.js').then(m=>m.approveProject(pending,project,body.note??'')).catch(()=>null);project=approved?.project??project;}
    return ok({approval:result,status:'approved',project:project?{id:project.id,state:project.state}:null,message:'Project approved. Tasks queued for scheduler.'});}
  // ── BUILD APP: Auto-push to GitHub + trigger .apk/.exe build ──
  if(request.method==='POST'&&url.pathname==='/api/build-app'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const body=await json(request);
    const projectId=body.projectId;
    if(!projectId)return fail('projectId required',400);
    // Default to the platform the project was actually commissioned for. Hard-coding
    // 'android' meant a founder who asked for a desktop app got an APK build unless they
    // happened to know to pass a parameter.
    const commissioned=store.get('projects',projectId)?.platform;
    const platform=normalizePlatform(body.platform)??resolvePlatform(commissioned,'web').platform;
    const codeArtifacts=await projectCodeArtifacts(projectId,env);
    if(!codeArtifacts.length)return fail('No code artifact found for this project. Run the command first.',404);
    const latest=codeArtifacts.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0];
    const files=collectProjectFiles(projectId,latest,store,codeArtifacts);
    if(!files.length)return fail('No buildable files in artifact',404);
    // Capacitor's webDir is www/. Failing here with a clear message beats
    // pushing a branch whose workflow dies on `test -s www/index.html`.
    if(!files.some(f=>f.path==='www/index.html'))return fail('This project has no www/index.html, which is the web app folder an APK is built from. Re-run the command so the app files are generated.',422,{projectId,files:files.map(f=>f.path)});
    if(!files.some(f=>f.path==='package.json'))return fail('This project has no package.json, so an Android build cannot be configured.',422,{projectId,files:files.map(f=>f.path)});
    // Push files to GitHub
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=env?.GITHUB_RESULT_REPO||'kalpeshpatil4694/MAULI-2.0';
    const buildId='build_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const safeProjectId=String(projectId).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'unknown';
    const buildBranch='build/project-'+safeProjectId;
    const startedAt=now();
    const previousBuilds=store.list('builds').filter(b=>b.projectId===projectId&&!['success','failed','cancelled','superseded'].includes(b.status));
    for(const previous of previousBuilds) store.put('builds',{...previous,status:'superseded',supersededBy:buildId,supersededAt:startedAt});
    if(hasD1(env)) await claimBuildVersion(env,projectId,buildId,buildBranch,startedAt); else store.put('build_locks',{id:'project:'+projectId,projectId,buildId,branch:buildBranch,startedAt,status:'active'});
    if(!token)return fail('GitHub token not configured. Add GITHUB_TOKEN env var.',500);
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder','Content-Type':'application/json'};
    // Create the build branch from main first
    const mainRef=await fetch('https://api.github.com/repos/'+repo+'/git/refs/heads/main',{headers:ghHeaders});
    const mainData=await mainRef.json();
    const mainSha=mainData?.object?.sha;
    if(!mainSha)return fail('Unable to resolve main branch',502,{buildId,repo});
    const branchRuns=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?branch='+encodeURIComponent(buildBranch)+'&per_page=20',{headers:ghHeaders}).then(r=>r.ok?r.json():({workflow_runs:[]})).catch(()=>({workflow_runs:[]}));
    for(const run of branchRuns.workflow_runs||[]) if(['queued','in_progress'].includes(run.status)){await fetch('https://api.github.com/repos/'+repo+'/actions/runs/'+run.id+'/cancel',{method:'POST',headers:ghHeaders}).catch(()=>{});}
    await fetch('https://api.github.com/repos/'+repo+'/git/refs/heads/'+encodeURIComponent(buildBranch),{method:'DELETE',headers:ghHeaders}).catch(()=>{});
    const createBranch=await fetch('https://api.github.com/repos/'+repo+'/git/refs',{method:'POST',headers:ghHeaders,body:JSON.stringify({ref:'refs/heads/'+buildBranch,sha:mainSha})});
    if(!createBranch.ok){const text=await createBranch.text().catch(()=>"");return fail('Unable to create clean build branch',502,{buildId,repo,branch:buildBranch,error:text.substring(0,200)});}
    // Push each file to GitHub
    let pushed=0;
    for(const file of files){
      const current=hasD1(env)?await getBuildVersion(env,projectId):store.get('build_locks','project:'+projectId);
      if(current?.buildId!==buildId)return ok({buildId,status:'superseded',supersededBy:current?.buildId||null,pushed});
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
    // The packaging workflow lives in the repository (.github/workflows/build-apps.yml,
    // triggered by a push to build/**). This handler used to generate its own copy and
    // PUT it onto the build branch, but writing files under .github/workflows needs a
    // token scope GITHUB_TOKEN does not have, so that PUT always answered 403 and its
    // response was never checked. It cost two GitHub API calls per build and left a
    // second, staler copy of the pipeline that would silently take over if the token
    // ever gained the workflows scope. The branch already carries the repository
    // workflow because it is created from main.
    const latestBeforeWorkflow=hasD1(env)?await getBuildVersion(env,projectId):store.get('build_locks','project:'+projectId);
    if(latestBeforeWorkflow?.buildId!==buildId)return ok({buildId,status:'superseded',supersededBy:latestBeforeWorkflow?.buildId||null,pushed});
    // Store build info
    store.put('builds',{id:buildId,projectId,platform,repo,branch:buildBranch,pushedAt:now(),startedAt,status:pushed>0?'pushed':'failed',filesPushed:pushed,supersededBy:null});
    store.addEvent('build.started',{buildId,projectId,platform,pushed});
    // store.put() fires its D1 write without awaiting it. The build record is created on
    // the LAST line of this handler, so the response used to return while the INSERT was
    // still in flight and the isolate was torn down before it landed. D1 held only 2 build
    // rows while the dashboard had started several, so /api/build-status answered a
    // permanent 404 for a build that was running on GitHub: the founder was polling a
    // build id that could never appear.
    // Keep the isolate alive until the row is durable.
    await store.flush().catch(()=>{});
    if(pushed===0){return fail('GitHub token does not have push permissions. The token may be expired or missing repo scope. Please check the GITHUB_TOKEN in Settings > Environment.',500,{buildId,pushed,repo,branch:buildBranch});}
    return ok({buildId,platform,pushed,repo,branch:buildBranch,status:'pushed',message:pushed+' files pushed to GitHub. Build will start shortly.'});
  }
  // ── BUILD STATUS: Poll GitHub Actions status ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/build-status/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const buildId=url.pathname.split('/').pop();
    // findBuild() asks D1 when the capped in-memory list does not have the row.
    // Polling the same build id used to answer 404/404/200/404 from different
    // isolates, so a founder's build finished but the Download button never came.
    const build=await findBuild(buildId,env);
    if(!build)return fail('Build not found',404);
    if(build.status==='superseded')return ok({buildId,status:'superseded',supersededBy:build.supersededBy||null,downloadUrl:null,pushedAt:build.pushedAt,platform:build.platform,filesPushed:build.filesPushed});
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=build.repo||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return ok({...build,status:'pushed',message:'GitHub token not configured'});
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder'};
    // Check latest workflow run for this branch/path
    const runsResp=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?branch='+encodeURIComponent(build.branch)+'&per_page=10',{headers:ghHeaders});
    let status='building';let downloadUrl=null;let conclusion=null;let viewUrl=null;
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
          try{
            const artResp=await fetch(r.artifacts_url,{headers:ghHeaders});
            if(artResp.ok){
              const artData=await artResp.json();
              const apk=artData.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('apk')||a.name.toLowerCase().includes('android')));
              if(apk&&!apk.expired)downloadUrl='/api/download-artifact/'+apk.id+'?name='+encodeURIComponent('mauli-android.apk');
            }
            // The artifacts API needs the actions scope and an artifact also expires
            // after 14 days. The run page is a view link, never a download: returning it
            // as downloadUrl made the dashboard save an HTML page as mauli-android.apk.
          }catch(e){ }
        }
        if(bestRun.html_url)viewUrl=bestRun.html_url;
      }
    }
    // Update build status
    store.put('builds',{...build,status:conclusion||status,downloadUrl,checkedAt:now(),id:buildId});
    return ok({buildId,status:conclusion||status,downloadUrl,viewUrl,pushedAt:build.pushedAt,platform:build.platform,filesPushed:build.filesPushed});
  }
  // ── PROJECT BUILDS: List all builds for a project with download URLs ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/project-builds/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.pathname.split('/').pop();
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=env?.GITHUB_RESULT_REPO||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return ok({builds:[]});
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-builder'};
    // Every build for a project is pushed to its own branch (see /api/build-app).
    const safeProjectId=String(projectId).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'unknown';
    const buildBranch='build/project-'+safeProjectId;
    // The in-memory store is a row-capped cache: fall back to D1 when this isolate has
    // no build row for the project.
    let localBuilds=store.list('builds').filter(b=>b.projectId===projectId);
    if(!localBuilds.length&&hasD1(env))localBuilds=(await d1List(env,'builds',{limit:200}).catch(()=>[])).filter(b=>b.projectId===projectId);
    // Ask GitHub for THIS project's branch. Querying the newest runs of the whole
    // repository listed unrelated CI runs and other projects' builds as this project's,
    // so bestAPK could point at an artifact that belonged to a different founder
    // command — or at a run page that holds no APK at all.
    const buildsResp=await fetch('https://api.github.com/repos/'+repo+'/actions/runs?branch='+encodeURIComponent(buildBranch)+'&per_page=20',{headers:ghHeaders});
    const ghBuilds=[];
    if(buildsResp.ok){
      const rd=await buildsResp.json();
      const runs=rd.workflow_runs||[];
      // Check each successful build run for artifacts
      for(const r of runs.filter(run=>run.conclusion==='success')){
        let downloadAPK=null,downloadEXE=null,viewUrl=r.html_url||null;
        try{
          const artResp=await fetch(r.artifacts_url,{headers:ghHeaders});
          if(artResp.ok){
            const ad=await artResp.json();
            const apk=ad.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('apk')||a.name.toLowerCase().includes('android')));
            const exe=ad.artifacts?.find(a=>a.name&&(a.name.toLowerCase().includes('exe')||a.name.toLowerCase().includes('desktop')||a.name.toLowerCase().includes('appimage')));
            if(apk&&!apk.expired)downloadAPK='/api/download-artifact/'+apk.id+'?name='+encodeURIComponent('mauli-android.apk');
            if(exe&&!exe.expired)downloadEXE='/api/download-artifact/'+exe.id+'?name='+encodeURIComponent('mauli-desktop.AppImage');
          }
        }catch(e){}
        // An artifacts API failure (403) or an expired artifact leaves only a run page,
        // which is a link and not a download: returning it as downloadAPK saved a
        // GitHub HTML page as mauli-android.apk.
        if(downloadAPK||downloadEXE||viewUrl){
          ghBuilds.push({id:r.id.toString(),branch:r.head_branch||'',status:r.conclusion,conclusion:r.conclusion,completedAt:r.updated_at,downloadUrlAPK:downloadAPK,downloadUrlEXE:downloadEXE,viewUrl:viewUrl});
        }
      }
    }
    // Merge local + GitHub builds, dedup by best available
    const allBuilds=[...localBuilds.map(b=>({...b,type:b.platform||'android'})),...ghBuilds];
    // Return the best build with download URL
    // Only a proxied /api/download-artifact url is a real APK. Older rows stored the run
    // page in downloadUrl, and offering that as the download saved an HTML page.
    const withAPK=allBuilds.find(b=>b.downloadUrlAPK||/^\/api\/download-artifact\//.test(String(b.downloadUrl||'')));
    const bestAPK=withAPK?(withAPK.downloadUrlAPK||withAPK.downloadUrl||null):null;
    const bestEXE=allBuilds.find(b=>b.downloadUrlEXE)?.downloadUrlEXE||null;
    return ok({builds:allBuilds.slice(0,5),bestAPK,bestEXE});
  }
  // ── DOWNLOAD ARTIFACT: Proxy GitHub artifact download ──
  if(request.method==='GET'&&url.pathname.startsWith('/api/download-artifact/')){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const parts=url.pathname.split('/');const artifactId=parts[parts.length-1];
    const token=env?.GITHUB_TOKEN||env?.MAULI_GITHUB_TOKEN||env?.GITHUB_PAT;
    const repo=env?.GITHUB_RESULT_REPO||'kalpeshpatil4694/MAULI-2.0';
    if(!token)return fail('GitHub token not configured',500);
    const ghHeaders={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'MAULI-2.0-downloader'};
    // Fetch the artifact zip from GitHub
    const artResp=await fetch('https://api.github.com/repos/'+repo+'/actions/artifacts/'+artifactId+'/zip',{headers:ghHeaders,redirect:'follow'});
    if(!artResp.ok)return fail('Artifact not available ('+artResp.status+')',artResp.status);
    const fileName=url.searchParams.get('name')||'mauli-build.zip';
    return new Response(artResp.body,{status:200,headers:{'content-type':'application/zip','content-disposition':'attachment; filename="'+fileName+'"','cache-control':'no-store'}});
  }
  if(request.method==='GET'&&url.pathname==='/api/app-files'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.searchParams.get('projectId');
    if(!projectId)return fail('projectId required',400);
    // Same authority as /api/build-app: every code-workspace artifact D1 holds for
    // the project, not whichever rows the capped in-memory cache happens to have.
    const artifacts=await projectCodeArtifacts(projectId,env);
    if(artifacts.length===0)return fail('No code artifacts',404);
    // collectProjectFiles() de-duplicates by path. Without it this route returned the
    // same file up to six times (one copy per code-workspace artifact) and the client
    // fired one browser download per entry — Chrome allows the first and silently
    // drops the rest, so a finished project looked like it downloaded nothing.
    const files=collectProjectFiles(projectId,null,store,artifacts);
    if(files.length===0)return fail('No files found',404);
    return ok({files,projectId,count:files.length});
  }
  // A deliverable is one zip, not twenty browser downloads. The dashboard used to
  // loop the /api/app-files entries through an <a download> each, which Chrome blocks
  // after the first on mobile, and those entries were duplicated per artifact.
  if(request.method==='GET'&&url.pathname==='/api/project-download'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.searchParams.get('projectId');
    if(!projectId)return fail('projectId required',400);
    const artifacts=await projectCodeArtifacts(projectId,env);
    if(artifacts.length===0)return fail('No code artifacts',404);
    const files=collectProjectFiles(projectId,null,store,artifacts);
    if(files.length===0)return fail('No files found',404);
    const zip=createZip(files);
    const name='mauli-'+String(projectId).replace(/[^a-zA-Z0-9_-]/g,'_')+'.zip';
    return new Response(zip,{status:200,headers:{'content-type':'application/zip','content-disposition':'attachment; filename="'+name+'"','content-length':String(zip.length),'cache-control':'no-store'}});
  }
  if(request.method==='GET'&&url.pathname==='/api/preview-app'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const projectId=url.searchParams.get('projectId');
    if(!projectId)return fail('projectId required',400);
    const artifacts=await projectCodeArtifacts(projectId,env);
    if(artifacts.length===0)return fail('No code artifacts',404);
    // The APK web app entry point first, then any other html file.
    const files=collectProjectFiles(projectId,null,store,artifacts);
    const html=files.find(f=>f.path==='www/index.html')||files.find(f=>f.path.endsWith('.html'));
    if(html)return new Response(html.content,{headers:{'content-type':'text/html;charset=utf-8'}});
    return fail('No HTML files',404);
  }
  
    // ── CLOUDFLARE API: Debug endpoint ──
  if(request.method==='GET'&&url.pathname==='/api/cf/debug'){const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const token = (env?.CLOUDFLARE_API_TOKEN || process.env?.CLOUDFLARE_API_TOKEN || '').trim();
    let apiTest = null;
    if (token) {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch('https://api.cloudflare.com/client/v4/accounts?per_page=1', {
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          signal: ctrl.signal
        }); clearTimeout(t);
        const d = await r.json();
        apiTest = { success: d.success, accountId: d.result?.[0]?.id || null, errors: d.errors?.map(e=>e.message) || [] };
      } catch (e) { apiTest = { success: false, error: e.message }; }
    }
    return ok({
      tokenSet: Boolean(token),
      tokenLength: token?.length || 0,
      tokenPrefix: token?.substring(0,5) || 'none',
      allEnvKeys: Object.keys(env || {}).filter(k => !k.startsWith('_')),
      apiTest
    });
  }
  // ── CLOUDFLARE API: Real-time usage from Cloudflare ──
  if(request.method==='GET'&&url.pathname==='/api/cf/usage'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const report=await getFullUsageReport(env);
    return ok({usage:report});
  }
  if(request.method==='GET'&&url.pathname==='/api/cf/d1'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const d1=await getD1UsageFromAPI(env);
    return ok({d1});
  }
  if(request.method==='GET'&&url.pathname==='/api/cf/workers'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const workers=await getWorkerAnalytics(env);
    return ok({workers});
  }
  if(request.method==='GET'&&url.pathname==='/api/cf/kv'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const kv=await getKVUsage(env);
    return ok({kv});
  }
  if(request.method==='GET'&&url.pathname==='/api/cf/alerts'){
    const auth=requireFounder(request,env);if(!auth.ok)return fail(auth.error,auth.status);
    const result=await checkLimits(env);
    return ok(result);
  }

  return fail('Route not found',404);
} catch(error){return fail(error.message||'Internal error',500);} } };