import { canWriteD1, recordD1Write } from './d1-quota.js';

export function hasD1(env) { return Boolean(env?.DB && typeof env.DB.prepare === 'function'); }

export async function ensureSchema(env) {
  if (!hasD1(env)) return false;
  const statements = [
    `CREATE TABLE IF NOT EXISTS entities (type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(type,id))`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`,
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

export async function d1List(env, type, { existingTasks } = {}) {
  const result = await env.DB.prepare('SELECT data FROM entities WHERE type = ? ORDER BY updated_at DESC').bind(type).all();
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
  // An UPSERT can update indexed rows as well as the entity row; reserve a small
  // amount before executing so the guard cannot knowingly cross the hard ceiling.
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
  const result = await env.DB.prepare('SELECT id,type,payload,created_at FROM events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
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
  d1QueriesPerInvocation: 50,
  workersRequestsPerDay: 100000,
  workersCpuMs: 10,
  workersMemoryMB: 128,
  workersSubrequests: 50,
  workersSizeMB: 3,
  kvReadsPerDay: 100000,
  kvWritesPerDay: 1000,
  kvStorageMB: 25000,
};

let _usageCache=null;let _usageCacheTime=0;const USAGE_CACHE_TTL=5*60*1000;
export async function getD1Usage(env) {
  const now=Date.now();if(_usageCache&&(now-_usageCacheTime)<USAGE_CACHE_TTL)return _usageCache;
  if (!hasD1(env)) return { d1: false, types: [], totalBytes: 0, totalRows: 0 };
  try {
    const typeRows = await env.DB.prepare('SELECT type, COUNT(*) as cnt, SUM(LENGTH(data)) as bytes FROM entities GROUP BY type ORDER BY bytes DESC').all();
    const types = (typeRows.results ?? []).map(r => ({ type:r.type, count:r.cnt, bytes:r.bytes ?? 0, mb:((r.bytes ?? 0)/1048576).toFixed(2) }));
    const totalBytes = types.reduce((s,t)=>s+t.bytes,0); const totalRows=types.reduce((s,t)=>s+t.count,0);
    const eventCount=await env.DB.prepare('SELECT COUNT(*) as cnt FROM events').first();
    const eventBytes=await env.DB.prepare('SELECT COALESCE(SUM(LENGTH(payload)),0) as bytes FROM events').first();
    const result={d1:true,types,events:{count:eventCount?.cnt??0,bytes:eventBytes?.bytes??0},totalBytes,totalRows,totalMB:(totalBytes/1048576).toFixed(2)};
    _usageCache=result;_usageCacheTime=Date.now();return result;
  } catch(e){return {d1:false,error:e.message,types:[],totalBytes:0,totalRows:0};}
}

export async function getUsageReport(env) {
  const d1=await getD1Usage(env);const limits=FREE_LIMITS;const usedMB=parseFloat(d1.totalMB??'0');
  return {limits,d1:{connected:hasD1(env),usedMB,limitMB:limits.d1DatabaseMB,remainingMB:Math.max(0,limits.d1DatabaseMB-usedMB).toFixed(2),pct:Math.min(100,(usedMB/limits.d1DatabaseMB)*100).toFixed(1),rows:d1.totalRows,events:d1.events,breakdown:d1.types},workers:{requestsPerDay:limits.workersRequestsPerDay,cpuMs:limits.workersCpuMs,memoryMB:limits.workersMemoryMB,subrequests:limits.workersSubrequests,sizeMB:limits.workersSizeMB},kv:{readsPerDay:limits.kvReadsPerDay,writesPerDay:limits.kvWritesPerDay,storageMB:limits.kvStorageMB},account:{d1StorageMB:limits.d1AccountMB,d1Databases:10}};
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
