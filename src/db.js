import { canWriteD1, recordD1Write } from './d1-quota.js';
import { queueQuotaSnapshot } from './queue-quota.js';

export function hasD1(env) { return Boolean(env?.DB && typeof env.DB.prepare === 'function'); }

export async function ensureSchema(env) {
  if (!hasD1(env)) return false;
  const statements = [
    `CREATE TABLE IF NOT EXISTS entities (type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(type,id))`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`,
    // Without this, "WHERE type=? ORDER BY updated_at DESC LIMIT n" still scans every row
    // of that type (2560 duplicate agents) to sort — the LIMIT only helped with this index.
    `CREATE INDEX IF NOT EXISTS idx_entities_type_updated ON entities(type, updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
  return true;
}

function projectStateFromTasks(project, tasks) {
  const own = tasks.filter(t => t?.projectId === project?.id);
  if (!own.length) return project?.state ?? 'planning';
  if (own.some(t => t.state === 'failed')) return 'escalated';
  if (own.some(t => ['working', 'running', 'blocked', 'assigned'].includes(t.state))) return 'active';
  if (own.every(t => t.state === 'completed')) return 'completed';
  if (own.some(t => t.state === 'completed')) return 'active';
  return project?.state === 'completed' ? 'active' : (project?.state ?? 'planning');
}

export async function d1List(env, type, { existingTasks, limit } = {}) {
  const result = limit
    ? await env.DB.prepare('SELECT data FROM entities WHERE type = ? ORDER BY updated_at DESC LIMIT ?').bind(type, limit).all()
    : await env.DB.prepare('SELECT data FROM entities WHERE type = ? ORDER BY updated_at DESC').bind(type).all();
  const rows = (result.results ?? []).map(row => JSON.parse(row.data));
  if (type !== 'projects' || !rows.length) return rows;
  let tasks = existingTasks;
  if (!tasks) {
    const taskResult = await env.DB.prepare('SELECT data FROM entities WHERE type = ?').bind('tasks').all();
    tasks = (taskResult.results ?? []).map(row => JSON.parse(row.data));
  }
  return rows.map(project => ({ ...project, state: projectStateFromTasks(project, tasks) }));
}

export async function d1Put(env, type, value, { critical = false } = {}) {
  // Reserve a small write budget before executing. Actual rows_written is recorded
  // from D1 metadata after success, so the dashboard remains honest about writes.
  if (!canWriteD1(env, critical, 2)) return { ...value, _d1WriteDeferred: true };
  const now = new Date().toISOString();
  const item = { ...value, createdAt: value.createdAt ?? now, updatedAt: now };
  try {
    const result = await env.DB.prepare(`INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).bind(type, item.id, JSON.stringify(item), item.createdAt, now).run();
    recordD1Write(env, Math.max(1, Number(result?.meta?.rows_written) || 1));
    return item;
  } catch (error) {
    return { ...item, _d1WriteDeferred: true, _d1WriteError: error?.message ?? String(error) };
  }
}

export async function d1Events(env, limit = 50) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  const result = await env.DB.prepare('SELECT id,type,payload,created_at FROM events ORDER BY created_at DESC LIMIT ?').bind(safeLimit).all();
  return (result.results ?? []).map(r => ({ id:r.id, type:r.type, payload:JSON.parse(r.payload), at:r.created_at }));
}

export async function d1Event(env, event, { critical = false } = {}) {
  if (!canWriteD1(env, critical, 1)) return { ...event, _d1WriteDeferred: true };
  try {
    const result = await env.DB.prepare('INSERT INTO events(id,type,payload,created_at) VALUES(?,?,?,?)').bind(event.id,event.type,JSON.stringify(event.payload),event.at).run();
    recordD1Write(env, Math.max(1, Number(result?.meta?.rows_written) || 1));
    return event;
  } catch (error) {
    return { ...event, _d1WriteDeferred: true, _d1WriteError: error?.message ?? String(error) };
  }
}

export async function claimBuildVersion(env, projectId, buildId, branch, startedAt) {
  if (!hasD1(env)) return false;
  return d1Put(env, 'build_locks', { id: 'project:' + projectId, projectId, buildId, branch, startedAt, status: 'active' }, { critical: true });
}

export async function getBuildVersion(env, projectId) {
  if (!hasD1(env)) return null;
  const row = await env.DB.prepare('SELECT data FROM entities WHERE type = ? AND id = ? LIMIT 1').bind('build_locks', 'project:' + projectId).first();
  return row?.data ? JSON.parse(row.data) : null;
}

const FREE_LIMITS = {
  d1DatabaseMB: 500,
  d1AccountMB: 5000,
  d1RowsReadPerDay: 5000000,
  d1RowsWrittenPerDay: 100000,
  d1QueriesPerInvocation: 50,
  workersRequestsPerDay: 100000,
  workersSafeRequestsPerDay: 90000,
  workersCpuMs: 10,
  workersMemoryMB: 128,
  workersSubrequests: 50,
  workersConfiguredSubrequests: 40,
  workersSizeMB: 64,
  cronTriggersPerAccount: 5,
  kvReadsPerDay: 100000,
  kvWritesPerDay: 1000,
  kvDeletesPerDay: 1000,
  kvListRequestsPerDay: 1000,
  kvStorageMB: 1024,
  workersAiNeuronsPerDay: 10000,
  workersAiSafeRequestsPerDay: 18,
  r2StorageGBMonth: 10,
  r2ClassAOperationsMonth: 1000000,
  r2ClassBOperationsMonth: 10000000,
  queuesOperationsPerDay: 10000,
  hyperdriveQueriesPerDay: 100000
};

let _usageCache=null;let _usageCacheTime=0;const USAGE_CACHE_TTL=15*60*1000;
// Events stats are scanned once per hour at most (COUNT+SUM over the events table
// used to scan 500K+ rows on EVERY usage-page visit — a rows_read bomb).
let _eventStats=null;let _eventStatsTime=0;const EVENT_STATS_TTL=6*60*60*1000;
// COUNT(*)+SUM(LENGTH(payload)) over the events table reads every row — with 500K+ rows
// that single query blew most of the daily 5M rows_read budget on its own. Sample the
// newest window instead: bounded to EVENT_SAMPLE rows, and exact once the table is small.
const EVENT_SAMPLE=1200;
async function eventStats(env){
  const now=Date.now();
  if(_eventStats&&(now-_eventStatsTime)<EVENT_STATS_TTL)return _eventStats;
  const row=await env.DB.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(LENGTH(payload)),0) as bytes FROM (SELECT payload FROM events ORDER BY created_at DESC LIMIT ?)').bind(EVENT_SAMPLE).first();
  const sampled=Number(row?.cnt??0);
  _eventStats={count:sampled,bytes:Number(row?.bytes??0),sampled:true,exact:sampled<EVENT_SAMPLE,window:EVENT_SAMPLE};
  _eventStatsTime=Date.now();
  return _eventStats;
}
// ── Maintenance bookkeeping ──────────────────────────────────────────────
// Cooldowns and daily delete budgets live in D1 (one tiny row) instead of module state:
// Cloudflare recycles isolates and several can run the cron at once, so a per-isolate
// counter cannot bound the account-wide rows_written budget.
const MAINTENANCE_ID='maintenance';
function dayKey(){return new Date().toISOString().slice(0,10);}
async function maintenanceState(env){
  try{
    const row=await env.DB.prepare('SELECT data FROM entities WHERE type=? AND id=?').bind('stats',MAINTENANCE_ID).first();
    return row?.data?JSON.parse(row.data):{};
  }catch(_){return{};}
}
async function saveMaintenanceState(env,data){
  try{
    const stamp=new Date().toISOString();
    await env.DB.prepare('INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
      .bind('stats',MAINTENANCE_ID,JSON.stringify(data),stamp,stamp).run();
  }catch(_){}
}
// D1 free tier allows ~50 queries per invocation, so each prune run issues a few
// set-based DELETEs with the row cap inside the statement, instead of hundreds of 90-id
// chunks (which also blew the daily rows_written budget).
let _lastEventPrune=0;
export async function pruneEvents(env,{keep=3000,batchLimit=8000,maxStatements=3,minIntervalMs=2*60*60*1000,dailyCap=50000}={}){
  if(!hasD1(env))return{pruned:0,reason:'no-d1'};
  const now=Date.now();
  const data=await maintenanceState(env);
  const today=dayKey();
  const deletedToday=data.eventsDay===today?Number(data.eventsDeleted||0):0;
  if(now-Number(data.eventsAt||0)<minIntervalMs)return{pruned:0,reason:'cooldown'};
  if(deletedToday>=dailyCap)return{pruned:0,reason:'daily-cap'};
  try{
    const {canWriteD1,recordD1Write}=await import('./d1-quota.js');
    // Walk the created_at index to the keep-th newest event instead of COUNT(*)ing the
    // whole table — costs ~keep rows instead of every row in the table.
    // OFFSET keep-1 lands on the oldest row we want to keep, so '< cutoff' leaves exactly `keep` rows.
    const cutoffRow=await env.DB.prepare('SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1 OFFSET ?').bind(Math.max(0,keep-1)).first();
    if(!cutoffRow?.created_at){data.eventsAt=now;await saveMaintenanceState(env,data);return{pruned:0,reason:'under-threshold'};}
    const cutoff=cutoffRow.created_at;
    let pruned=0;let remaining=Math.min(batchLimit*maxStatements,dailyCap-deletedToday);
    while(remaining>0){
      const take=Math.min(batchLimit,remaining);
      if(!canWriteD1(env,false,take))break;
      const result=await env.DB.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at < ? ORDER BY created_at ASC LIMIT ?)').bind(cutoff,take).run();
      const written=Number(result?.meta?.rows_written)||0;
      if(!written)break;
      recordD1Write(env,written);pruned+=written;remaining-=written;
      if(written<take)break;
    }
    data.eventsAt=now;data.eventsDay=today;data.eventsDeleted=deletedToday+pruned;
    await saveMaintenanceState(env,data);
    if(pruned){_eventStats=null;_eventStatsTime=0;}
    return{pruned,cutoff};
  }catch(e){return{pruned:0,error:e.message};}
}
// Prunes the 20KB-per-row command results, plus stale runs/verifications/builds — the
// command_results table was the single largest storage consumer (8,592 rows / 175MB).
export async function pruneOldResults(env,{keep={command_results:300,runs:400,verifications:400,builds:50},batchLimit=4000,maxStatements=3,minIntervalMs=2*60*60*1000,dailyCap=30000}={}){
  if(!hasD1(env))return{pruned:0,reason:'no-d1'};
  const now=Date.now();
  const data=await maintenanceState(env);
  const today=dayKey();
  const deletedToday=data.resultsDay===today?Number(data.resultsDeleted||0):0;
  if(now-Number(data.resultsAt||0)<minIntervalMs)return{pruned:0,reason:'cooldown'};
  if(deletedToday>=dailyCap)return{pruned:0,reason:'daily-cap'};
  const out={};
  let total=0;
  try{
    const {canWriteD1,recordD1Write}=await import('./d1-quota.js');
    for(const [type,max] of Object.entries(keep)){
      let pruned=0;let remaining=Math.min(batchLimit*maxStatements,dailyCap-deletedToday-total);
      while(remaining>0){
        const cutoffRow=await env.DB.prepare('SELECT updated_at FROM entities WHERE type=? ORDER BY updated_at DESC LIMIT 1 OFFSET ?').bind(type,Math.max(0,max-1)).first();
        if(!cutoffRow?.updated_at)break;
        const take=Math.min(batchLimit,remaining);
        if(!canWriteD1(env,false,take))break;
        const result=await env.DB.prepare('DELETE FROM entities WHERE type=? AND id IN (SELECT id FROM entities WHERE type=? AND updated_at < ? ORDER BY updated_at ASC LIMIT ?)').bind(type,type,cutoffRow.updated_at,take).run();
        const written=Number(result?.meta?.rows_written)||0;
        if(!written)break;
        recordD1Write(env,written);pruned+=written;remaining-=written;total+=written;
        if(written<take)break;
      }
      out[type]=pruned;
    }
    data.resultsAt=now;data.resultsDay=today;data.resultsDeleted=deletedToday+total;
    await saveMaintenanceState(env,data);
    _usageCache=null;_usageCacheTime=0;
    return{...out,total};
  }catch(e){return{pruned:0,error:e.message};}
}
export async function getD1Usage(env) {
  const now=Date.now();if(_usageCache&&(now-_usageCacheTime)<USAGE_CACHE_TTL)return _usageCache;
  if (!hasD1(env)) return { d1: false, types: [], totalBytes: 0, totalRows: 0 };
  try {
    const typeRows = await env.DB.prepare('SELECT type, COUNT(*) as cnt, SUM(LENGTH(data)) as bytes FROM entities GROUP BY type ORDER BY bytes DESC').all();
    const types = (typeRows.results ?? []).map(r => ({ type:r.type, count:r.cnt, bytes:r.bytes ?? 0, mb:((r.bytes ?? 0)/1048576).toFixed(2) }));
    const totalBytes = types.reduce((s,t)=>s+t.bytes,0); const totalRows=types.reduce((s,t)=>s+t.count,0);
    const events=await eventStats(env);
    const result={d1:true,types,events,totalBytes,totalRows,totalMB:(totalBytes/1048576).toFixed(2)};
    _usageCache=result;_usageCacheTime=Date.now();return result;
  } catch(e){return {d1:false,error:e.message,types:[],totalBytes:0,totalRows:0};}
}

export async function getUsageReport(env) {
  const d1=await getD1Usage(env);const limits=FREE_LIMITS;const usedMB=parseFloat(d1.totalMB??'0');
  const queues=queueQuotaSnapshot(env);
  return {limits,d1:{connected:hasD1(env),usedMB,limitMB:limits.d1DatabaseMB,remainingMB:Math.max(0,limits.d1DatabaseMB-usedMB).toFixed(2),pct:Math.min(100,(usedMB/limits.d1DatabaseMB)*100).toFixed(1),rows:d1.totalRows,events:d1.events,breakdown:d1.types},workers:{requestsPerDay:limits.workersRequestsPerDay,safeRequestsPerDay:limits.workersSafeRequestsPerDay,cpuMs:limits.workersCpuMs,memoryMB:limits.workersMemoryMB,subrequests:limits.workersSubrequests,configuredSubrequests:limits.workersConfiguredSubrequests,sizeMB:limits.workersSizeMB,cronTriggers:limits.cronTriggersPerAccount},d1Free:{rowsReadPerDay:limits.d1RowsReadPerDay,rowsWrittenPerDay:limits.d1RowsWrittenPerDay,queriesPerInvocation:limits.d1QueriesPerInvocation},kv:{readsPerDay:limits.kvReadsPerDay,writesPerDay:limits.kvWritesPerDay,deletesPerDay:limits.kvDeletesPerDay,listRequestsPerDay:limits.kvListRequestsPerDay,storageMB:limits.kvStorageMB},workersAI:{freeNeuronsPerDay:limits.workersAiNeuronsPerDay,safeRequestsPerDay:limits.workersAiSafeRequestsPerDay},r2:{storageGBMonth:limits.r2StorageGBMonth,classAOperationsMonth:limits.r2ClassAOperationsMonth,classBOperationsMonth:limits.r2ClassBOperationsMonth},queues:{operationsPerDay:limits.queuesOperationsPerDay,safeOperationsPerDay:queues.safeLimit,used:queues.used,remaining:queues.remaining,pct:queues.percent,status:queues.status,protectionMode:queues.protectionMode},hyperdrive:{queriesPerDay:limits.hyperdriveQueriesPerDay},account:{d1StorageMB:limits.d1AccountMB,d1Databases:10}};
}

export async function cleanupD1(env, options = {}) {
  if (!hasD1(env)) return { cleaned:false, reason:'No D1 connection' };
  const { maxEvents=500, deleteOldResults=true }=options; const results={};
  // Set-based deletes with the row cap inside the statement: a single statement may bind
  // at most 100 parameters (the old thousands-wide IN list always failed on D1) and the
  // free tier allows ~50 queries per invocation.
  const pruneIds=async(type,max,table='entities')=>{
    let deleted=0;
    for(let i=0;i<5;i++){
      const take=2000;
      if(!canWriteD1(env,false,take))break;
      let result;
      if(table==='events'){
        const cutoff=await env.DB.prepare('SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1 OFFSET ?').bind(Math.max(0,max-1)).first();
        if(!cutoff?.created_at)break;
        result=await env.DB.prepare('DELETE FROM events WHERE id IN (SELECT id FROM events WHERE created_at < ? ORDER BY created_at ASC LIMIT ?)').bind(cutoff.created_at,take).run();
      }else{
        const cutoff=await env.DB.prepare('SELECT updated_at FROM entities WHERE type=? ORDER BY updated_at DESC LIMIT 1 OFFSET ?').bind(type,Math.max(0,max-1)).first();
        if(!cutoff?.updated_at)break;
        result=await env.DB.prepare('DELETE FROM entities WHERE type=? AND id IN (SELECT id FROM entities WHERE type=? AND updated_at < ? ORDER BY updated_at ASC LIMIT ?)').bind(type,type,cutoff.updated_at,take).run();
      }
      const written=Number(result?.meta?.rows_written)||0;
      if(!written)break;
      recordD1Write(env,written);deleted+=written;
      if(written<take)break;
    }
    return deleted;
  };
  try{results.eventsPruned=await pruneIds('events',maxEvents,'events');}catch(e){results.eventsError=e.message;}
  if(deleteOldResults){try{results.resultsPruned=await pruneIds('command_results',20);}catch(e){results.resultsError=e.message;}}
  try{results.buildsPruned=await pruneIds('builds',10);}catch(e){results.buildsError=e.message;}
  try{results.verificationsPruned=await pruneIds('verifications',50);}catch(e){results.verificationsError=e.message;}
  try{results.runsPruned=await pruneIds('runs',50);}catch(e){results.runsError=e.message;}
  _usageCache=null;_usageCacheTime=0;
  const after=await getD1Usage(env);results.afterMB=after.totalMB;results.cleaned=true;return results;
}
