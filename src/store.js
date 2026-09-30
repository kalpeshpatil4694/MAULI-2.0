import { id, now } from './core.js';
import { hasD1, d1List, d1Put, d1Event, d1Events } from './db.js';

// 'builds' belongs here: /api/build-app writes the record from one isolate and
// /api/build-status reads it from whichever isolate answers the dashboard poll.
// As a non-critical write it was dropped whenever the write budget was tight, so
// the build existed on GitHub and in one isolate's memory but was simply not in
// D1 for the next request — a permanent 404 on a build that was running.
const CRITICAL_TYPES = new Set(['projects','tasks','runs','command_results','verifications','artifacts','builds','build_locks','approvals']);
// Events whose payload's entity already has its own row (agents, tasks, verifications,
// runs, executions, memory, chat messages, activities, tool runs). Persisting them to D1
// costs one rows_written per event on insert AND another on prune-delete, on top of the
// entity upsert that already recorded the same fact. They stay in the in-memory feed for
// the live dashboard; only the D1 copy is skipped.
//
// The task lifecycle is the expensive case: every task moved through assigned → working →
// verifying → completed, and several of those transitions wrote BOTH a task row and an
// event saying the same thing. Measured on a full 13-task command that narration was the
// majority of the 375 daily writes, and most of it is recoverable from the task row itself
// (state, attempts, infraRecoveries, error, verificationId, agentId).
//
// task.completed and command.completed deliberately stay persisted: those are the
// completion audit trail, and dropping them would trade a recoverability problem for a
// cost problem without the founder ever asking for it.
const MEMORY_ONLY_EVENTS = new Set([
  'agent.updated', 'agent.registered', 'agent.activity', 'agent.sub_agent_created',
  'execution.started', 'execution.completed', 'execution.failed', 'execution.duplicate_prevented',
  'memory.created', 'tool.executed',
  'chat.user_message', 'chat.assistant_response',
  'task.assigned', 'task.verifying',
  'scheduler.task_claimed', 'scheduler.task_recovered',
  'verification.completed',
]);
// Tables the dashboard counters are built from. If one of these fails to load the isolate
// must not advertise itself as hydrated, or the counters would render an empty store.
const HYDRATION_CRITICAL = new Set(['projects','tasks','artifacts','agents']);

function comparable(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...value };
  delete copy.updatedAt;
  delete copy._d1WriteDeferred;
  return JSON.stringify(copy);
}

export class MemoryStore {
  constructor() { this.data=new Map(); this.events=[]; this.env=null; this.hydrated=false; this.pendingWrites=new Set(); this.persistenceErrors=[]; this.hydrateErrors=[]; this.hydrateFailures=[]; this._hydrating=null; }
  // Single-flight hydration: concurrent callers (worker light paths and the HTTP init
  // path) share one in-flight promise instead of each re-reading every D1 table.
  hydrateOnce() {
    if (this.hydrated) return Promise.resolve(true);
    if (this._hydrating) return this._hydrating;
    this._hydrating = this.hydrate().catch((error)=>{ this.noteHydrateFailure('hydrate',error); return false; }).finally(()=>{ this._hydrating=null; });
    return this._hydrating;
  }
  configure(env) { this.env=env??null; }
  list(type) { return [...(this.data.get(type)??new Map()).values()]; }
  get(type,key) { return this.data.get(type)?.get(key)??null; }
  put(type,value) {
    const bucket=this.data.get(type)??new Map();
    const previous=value?.id ? bucket.get(value.id) : null;
    if (previous && comparable(previous) === comparable(value)) return previous;
    const item={...value,id:value.id??id(type),updatedAt:now(),createdAt:value.createdAt??now()};
    bucket.set(item.id,item); this.data.set(type,bucket);
    if(hasD1(this.env)) {
      const critical=CRITICAL_TYPES.has(type);
      let write;
      // Pass the version this row was read at so D1 can reject a write built on a copy
      // another isolate has since replaced (see d1Put's compare-and-set).
      write=d1Put(this.env,type,item,{critical,expectedUpdatedAt:previous?.updatedAt??null}).then(result=>{
        // d1Put persists the version it actually wrote, which can differ by a millisecond
        // from the one stamped above. The in-memory copy must adopt it: if it kept its own
        // timestamp, the next write's compare-and-set would compare against a version D1
        // never had, be rejected as stale, and this isolate would silently stop persisting
        // that row for the rest of its life.
        const persisted=result?.updatedAt;
        const current=bucket.get(item.id);
        if(persisted&&current&&current.updatedAt!==persisted){
          bucket.set(item.id,{...current,updatedAt:persisted});
        }
        if(critical&&result?._d1WriteDeferred){
          const reason=result._d1WriteError|| (result._d1WriteLimit?'write blocked':'unknown error');
          this.persistenceErrors.push(new Error(`D1 persistence deferred for ${type}/${item.id}: ${reason}`));
        }
        return result;
      }).catch(error=>{
        if(critical)this.persistenceErrors.push(error instanceof Error?error:new Error(String(error)));
        return null;
      }).finally(()=>this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    }
    return item;
  }  // Update the in-memory row without touching D1. For states that exist only between two
  // durable ones: an invocation that dies mid-transition leaves the previous durable state,
  // and orphan recovery already handles that state identically, so the extra row write per
  // task buys nothing but cost.
  putTransient(type, value) {
    const bucket=this.data.get(type)??new Map();
    const previous=value?.id ? bucket.get(value.id) : null;
    if (previous && comparable(previous) === comparable(value)) return previous;
    const item={...value,id:value.id??id(type),updatedAt:now(),createdAt:value.createdAt??now()};
    bucket.set(item.id,item); this.data.set(type,bucket);
    return item;
  }
  addEvent(type, payload) {
    const event={id:id('evt'),type,payload,at:now()}; this.events.push(event); if(this.events.length>1000)this.events.shift();
    if(hasD1(this.env) && !MEMORY_ONLY_EVENTS.has(type)) {
      const critical=type.startsWith('command.')||type.startsWith('project.')||type.startsWith('task.')||type.startsWith('verification.')||type.startsWith('artifact.');
      let write;
      write=d1Event(this.env,event,{critical}).then(result=>{
        if(critical&&result?._d1WriteDeferred){
          const reason=result._d1WriteError|| (result._d1WriteLimit?'write blocked':'unknown error');
          this.persistenceErrors.push(new Error(`D1 event persistence deferred: ${reason}`));
        }
        return result;
      }).catch(error=>{
        if(critical)this.persistenceErrors.push(error instanceof Error?error:new Error(String(error)));
        return null;
      }).finally(()=>this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    }
    return event;
  }
  async flush() { if(this.pendingWrites.size) await Promise.all([...this.pendingWrites]); if(this.persistenceErrors.length){const errors=[...this.persistenceErrors];this.persistenceErrors.length=0;throw errors[0];} return true; }
  recentEvents(limit=50) { return this.events.slice(-limit).reverse(); }
  async hydrate(types=['agents','projects','tasks','approvals','tools','artifacts','command_results','memory','runs','verifications','executions','builds']) {
    if(!hasD1(this.env))return false;
    // Load tasks before projects so project-state calculation never performs a second task query.
    const ordered=[...types].sort((a,b)=>{if(a==='tasks')return -1;if(b==='tasks')return 1;return 0;});
    const taskRows=[];
    // command_results are ~19KB each (74MB total in D1) — cap so the Results tab
    // stays usable without blowing the 128MB worker memory limit.
    // artifacts is raised to 600: the warm /api/state totals come from these store
    // counts, and at 300 the cap sat below the real D1 row count, so the Artifacts
    // counter started every isolate at a false ceiling and looked frozen again.
    const limits={command_results:50,agents:400,tasks:1500,artifacts:600,runs:300,verifications:300,executions:300,memory:500,builds:200,approvals:500,tools:200};
    // One failed table used to abort the whole sweep, and hydrateOnce() swallowed the
    // error — leaving the isolate permanently unhydrated, so every dashboard poll fell
    // back to the bounded snapshot (and, before that, to an empty state). Read each
    // table defensively and only claim hydration once the counter-driving tables loaded.
    const failed=new Set();
    for(const type of ordered){
      const isProject=type==='projects';
      let rows=null; let transientError=null;
      for(let attempt=0;attempt<2;attempt++){
        try{rows=await d1List(this.env,type,{existingTasks:isProject?taskRows:undefined,limit:limits[type]});break;}
        catch(error){
          if(attempt===0){transientError=error;await new Promise(r=>setTimeout(r,80));continue;}
          this.noteHydrateFailure(type,error);
        }
      }
      // A read that only succeeded on the retry is still a real D1 problem worth seeing.
      if(rows!==null&&transientError)this.noteHydrateFailure(type,transientError,true);
      if(rows===null){failed.add(type);continue;}
      const existing=this.data.get(type)??new Map();
      for(const item of rows)if(item?.id)existing.set(item.id,item);
      if(existing.size)this.data.set(type,existing);
      if(type==='tasks')taskRows.push(...rows);
    }
    try{this.events=await d1Events(this.env);}
    catch(error){this.noteHydrateFailure('events',error);failed.add('events');}
    this.hydrateFailures=[...failed];
    // Reporting hydrated with a missing counter table is what showed 0 projects / 0 tasks.
    // Stay unhydrated in that case so /api/state keeps serving the D1 snapshot instead.
    this.hydrated=[...failed].every(type=>!HYDRATION_CRITICAL.has(type));
    return this.hydrated;
  }
  noteHydrateFailure(type,error,recovered=false){
    const reason=(error?.message??String(error??'unknown')).slice(0,200);
    const entry={type,reason,recovered,at:new Date().toISOString()};
    this.hydrateErrors.push(entry);
    if(this.hydrateErrors.length>50)this.hydrateErrors.splice(0,this.hydrateErrors.length-50);
    console.warn(`hydrate failed (${type}):`,reason,recovered?'(recovered on retry)':'');
  }
  async hydrateLearning() { return this.hydrate(['agents','memory']); }
  metrics() {
    const entities = {};
    let totalSize = 0;
    for (const [type, bucket] of this.data) {
      const items = [...bucket.values()];
      const size = items.reduce((s, item) => s + JSON.stringify(item).length, 0);
      entities[type] = { count: items.length, sizeBytes: size, sizeKB: (size / 1024).toFixed(1) };
      totalSize += size;
    }
    return {
      hydrated: this.hydrated,
      entityTypes: Object.keys(entities).length,
      totalEntities: Object.values(entities).reduce((s, e) => s + e.count, 0),
      totalSizeKB: (totalSize / 1024).toFixed(1),
      totalSizeMB: (totalSize / 1048576).toFixed(2),
      pendingWrites: this.pendingWrites.size,
      eventCount: this.events.length,
      entities,
    };
  }
  integrity() {
    const issues = [];
    for (const [type, bucket] of this.data) {
      for (const [id, item] of bucket) {
        if (!item || typeof item !== 'object') issues.push({ type, id, issue: 'Invalid item structure' });
        if (item && !item.id) issues.push({ type, id, issue: 'Missing id field' });
        if (item && !item.updatedAt) issues.push({ type, id, issue: 'Missing updatedAt field' });
      }
    }
    return { healthy: issues.length === 0, issues, checkedAt: now() };
  }
  snapshot(){return{hydrated:this.hydrated,entities:Object.fromEntries([...this.data.entries()].map(([type,bucket])=>[type,[...bucket.values()]])),events:this.recentEvents(100)};}
}
export const store=new MemoryStore();
