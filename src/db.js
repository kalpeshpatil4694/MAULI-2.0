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
// Self-throttling events pruning: keeps audit history bounded, shrinks scan costs,
// protects the 500MB storage. Bounded batch per run to respect the daily write quota.
let _lastEventPrune=0;
export async function pruneEvents(env,{keep=3000,batchLimit=15000,minIntervalMs=6*60*60*1000}={}){
  if(!hasD1(env))return{pruned:0,reason:'no-d1'};
  const now=Date.now();if(now-_lastEventPrune<minIntervalMs)return{pruned:0,reason:'cooldown'};
  try{
    const {canWriteD1,recordD1Write}=await import('./d1-quota.js');
    // Walk the created_at index to the keep-th newest event instead of COUNT(*)ing the
    // whole table — costs ~keep rows instead of every row in the table.
    const cutoffRow=await env.DB.prepare('SELECT created_at FROM events ORDER BY created_at DESC LIMIT 1 OFFSET ?').bind(keep).first();
    if(!cutoffRow?.created_at){_lastEventPrune=Date.now();return{pruned:0,reason:'under-threshold'};}
    _lastEventPrune=Date.now();
    const cutoff=cutoffRow.created_at;
    if(!canWriteD1(env,false,batchLimit))return{pruned:0,reason:'write-quota'};
    const old=await env.DB.prepare('SELECT id FROM events WHERE created_at < ? ORDER BY created_at ASC LIMIT ?').bind(cutoff,batchLimit).all();
    const ids=(old.results??[]).map(r=>r.id);if(!ids.length)return{pruned:0,reason:'under-threshold'};
    // D1 rejects statements with more than 100 bound parameters — delete in chunks.
    let pruned=0;
    for(let i=0;i<ids.length;i+=90){
      const chunk=ids.slice(i,i+90);
      const ph=chunk.map(()=>'?').join(',');
      const result=await env.DB.prepare(`DELETE FROM events WHERE id IN (${ph})`).bind(...chunk).run();
      recordD1Write(env,Math.max(1,Number(result?.meta?.rows_written)||chunk.length));
      pruned+=chunk.length;
    }
    _eventStats=null;_eventStatsTime=0;
    return{pruned,cutoff};
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
  const pruneIds=async(type,max,table='entities')=>{
    const countRow=table==='events'?await env.DB.prepare('SELECT COUNT(*) as cnt FROM events').first():await env.DB.prepare('SELECT COUNT(*) as cnt FROM entities WHERE type=?').bind(type).first();
    const count=Number(countRow?.cnt??0);if(count<=max)return 0;const toDelete=count-max;
    const old=table==='events'?await env.DB.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT ?').bind(toDelete).all():await env.DB.prepare('SELECT id FROM entities WHERE type=? ORDER BY updated_at ASC LIMIT ?').bind(type,toDelete).all();
    const ids=(old.results??[]).map(r=>r.id);if(!ids.length||!canWriteD1(env,false,ids.length))return 0;
    const ph=ids.map(()=>'?').join(',');let result;
    if(table==='events')result=await env.DB.prepare(`DELETE FROM events WHERE id IN (${ph})`).bind(...ids).run();
    else result=await env.DB.prepare(`DELETE FROM entities WHERE type=? AND id IN (${ph})`).bind(type,...ids).run();
    recordD1Write(env,Math.max(1,Number(result?.meta?.rows_written)||ids.length));return ids.length;
  };
  try{results.eventsPruned=await pruneIds('events',maxEvents,'events');}catch(e){results.eventsError=e.message;}
  if(deleteOldResults){try{results.resultsPruned=await pruneIds('command_results',20);}catch(e){results.resultsError=e.message;}}
  try{results.buildsPruned=await pruneIds('builds',10);}catch(e){results.buildsError=e.message;}
  try{results.verificationsPruned=await pruneIds('verifications',50);}catch(e){results.verificationsError=e.message;}
  try{results.runsPruned=await pruneIds('runs',50);}catch(e){results.runsError=e.message;}
  _usageCache=null;_usageCacheTime=0;
  const after=await getD1Usage(env);results.afterMB=after.totalMB;results.cleaned=true;return results;
}
