import { id, now } from './core.js';
import { hasD1, d1List, d1Put, d1Event, d1Events, getD1Usage } from './db.js';

const CRITICAL_TYPES = new Set(['projects','tasks','runs','command_results','verifications','artifacts','build_locks','approvals']);

function comparable(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...value };
  delete copy.updatedAt;
  delete copy._d1WriteDeferred;
  return JSON.stringify(copy);
}

export class MemoryStore {
  constructor() { this.data=new Map(); this.events=[]; this.env=null; this.hydrated=false; this.pendingWrites=new Set(); }
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
      let write;
      write=d1Put(this.env,type,item,{critical:CRITICAL_TYPES.has(type)}).catch(()=>{}).finally(()=>this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    }
    return item;
  }
  addEvent(type,payload) {
    const event={id:id('evt'),type,payload,at:now()}; this.events.push(event); if(this.events.length>1000)this.events.shift();
    if(hasD1(this.env)) {
      const critical=type.startsWith('command.')||type.startsWith('project.')||type.startsWith('task.')||type.startsWith('verification.')||type.startsWith('artifact.');
      let write;
      write=d1Event(this.env,event,{critical}).catch(()=>{}).finally(()=>this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    }
    return event;
  }
  async flush() { if(this.pendingWrites.size) await Promise.all([...this.pendingWrites]); return true; }
  recentEvents(limit=50) { return this.events.slice(-limit).reverse(); }
  async hydrate(types=['agents','projects','tasks','approvals','tools']) { if(!hasD1(this.env))return false; for(const type of types){const rows=await d1List(this.env,type);const existing=this.data.get(type)??new Map();for(const item of rows)if(item?.id)existing.set(item.id,item);if(existing.size)this.data.set(type,existing);}this.events=await d1Events(this.env);this.hydrated=true;this._pruneEventsIfNeeded();return true; }
  async _pruneEventsIfNeeded() {
    if(!hasD1(this.env))return;
    try {
      const usage=await getD1Usage(this.env);
      const d1MB=parseFloat(usage.totalMB??'0');
      if(d1MB>400) {
        const maxEvents=200;
        const count=usage.events?.count??0;
        if(count>maxEvents) {
          const toDelete=count-maxEvents;
          const old=await this.env.DB.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT ?').bind(toDelete).all();
          if(old.results?.length) {
            const ids=old.results.map(r=>r.id);
            const ph=ids.map(()=>'?').join(',');
            await this.env.DB.prepare(`DELETE FROM events WHERE id IN (${ph})`).bind(...ids).run();
          }
        }
        for(const type of ['command_results','runs','verifications']) {
          const cnt=await this.env.DB.prepare('SELECT COUNT(*) as c FROM entities WHERE type=?').bind(type).first();
          const max=type==='command_results'?15:type==='runs'?30:40;
          if((cnt?.c??0)>max) {
            const old=await this.env.DB.prepare('SELECT id FROM entities WHERE type=? ORDER BY updated_at ASC LIMIT ?').bind(type,(cnt.c-max)).all();
            if(old.results?.length) {
              const ids=old.results.map(r=>r.id);
              const ph=ids.map(()=>'?').join(',');
              await this.env.DB.prepare(`DELETE FROM entities WHERE type=? AND id IN (${ph})`).bind(type,...ids).run();
            }
          }
        }
      }
    } catch(_) {}
  }
  async hydrateLearning() { return this.hydrate(['agents','memory']); }
  // Get store metrics for monitoring
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

  // Data integrity check
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
