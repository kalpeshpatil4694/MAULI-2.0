import { id, now } from './core.js';

export class MemoryStore {
  constructor() {
    this.data = new Map();
    this.events = [];
  }
  list(type) { return [...(this.data.get(type) ?? new Map()).values()]; }
  get(type, key) { return this.data.get(type)?.get(key) ?? null; }
  put(type, value) {
    const bucket = this.data.get(type) ?? new Map();
    const item = { ...value, updatedAt: now(), createdAt: value.createdAt ?? now() };
    bucket.set(item.id ?? id(type), item);
    this.data.set(type, bucket);
    return item;
  }
  addEvent(type, payload) {
    const event = { id: id('evt'), type, payload, at: now() };
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
    return event;
  }
  recentEvents(limit = 50) { return this.events.slice(-limit).reverse(); }
}

export const store = new MemoryStore();
