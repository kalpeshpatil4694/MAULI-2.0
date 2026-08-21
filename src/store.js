import { id, now } from './core.js';
import { hasD1, d1List, d1Put, d1Event, d1Events } from './db.js';

export class MemoryStore {
  constructor() { this.data=new Map(); this.events=[]; this.env=null; this.hydrated=false; this.pendingWrites=new Set(); }
  configure(env) { this.env=env??null; }
  list(type) { return [...(this.data.get(type)??new Map()).values()]; }
  get(type,key) { return this.data.get(type)?.get(key)??null; }
  put(type,value) {
    const bucket=this.data.get(type)??new Map();
    const item={...value,id:value.id??id(type),updatedAt:now(),createdAt:value.createdAt??now()};
    bucket.set(item.id,item); this.data.set(type,bucket);
    if(hasD1(this.env)) {
      let write;
      write=d1Put(this.env,type,item).catch(()=>{}).finally(()=>this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    }
    return item;
  }
  addEvent(type,payload) {
    const event={id:id('evt'),type,payload,at:now()}; this.events.push(event); if(this.events.length>1000)this.events.shift();
    if(hasD1(this.env)) {
      let write;
      write=d1Event(this.env,event).catch(()=>{}).finally(()=>this.pendingWrites.delete(write));
      this.pendingWrites.add(write);
    }
    return event;
  }
  async flush() { if(this.pendingWrites.size) await Promise.all([...this.pendingWrites]); return true; }
  recentEvents(limit=50) { return this.events.slice(-limit).reverse(); }
  async hydrate(types=['agents','projects','tasks','approvals','memory','runs','verifications','tools']) { if(!hasD1(this.env))return false; for(const type of types){const rows=await d1List(this.env,type);const existing=this.data.get(type)??new Map();for(const item of rows)if(item?.id)existing.set(item.id,item);if(existing.size)this.data.set(type,existing);}this.events=await d1Events(this.env);this.hydrated=true;return true; }
  async hydrateLearning() { return this.hydrate(['agents','memory']); }
  snapshot(){return{hydrated:this.hydrated,entities:Object.fromEntries([...this.data.entries()].map(([type,bucket])=>[type,[...bucket.values()]])),events:this.recentEvents(100)};}
}
export const store=new MemoryStore();
