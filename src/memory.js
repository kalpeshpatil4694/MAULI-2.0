import { id, now } from './core.js';
import { store } from './store.js';

export const MEMORY_TYPES = ['founder_rule','founder_preference','company_decision','project_requirement','technical_knowledge','agent_result','task_result','error','solution','approval'];
export const MEMORY_IMPORTANCE = ['low','normal','high','critical'];

export function remember({ type, content, scope = 'company', scopeId = null, importance = 'normal', tags = [], source = 'system' }) {
  if (!MEMORY_TYPES.includes(type)) throw new Error(`Unsupported memory type: ${type}`);
  const memory = store.put('memory', { id: id('mem'), type, content, scope, scopeId, importance, tags, source, createdAt: now() });
  store.addEvent('memory.created', memory);
  return memory;
}

export function recall({ scope = null, scopeId = null, type = null, tag = null, limit = 20 } = {}) {
  return store.list('memory').filter(m => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId) && (!type || m.type === type) && (!tag || m.tags.includes(tag))).slice(-limit).reverse();
}
