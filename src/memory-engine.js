import { id, now } from './core.js';
import { store } from './store.js';

export const MEMORY_TYPES = ['founder_rule','founder_preference','company_decision','project_requirement','technical_knowledge','agent_result','task_result','error','solution','approval'];
export const MEMORY_IMPORTANCE = ['low','normal','high','critical'];

const importanceWeight = { low: 1, normal: 2, high: 3, critical: 4 };

function normalizeTags(tags = []) {
  return [...new Set((Array.isArray(tags) ? tags : [tags]).map(tag => String(tag ?? '').trim().toLowerCase()).filter(Boolean))];
}

function scoreMemory(memory, query) {
  if (!query) return importanceWeight[memory.importance] ?? 2;
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const text = [memory.content, memory.type, memory.scope, memory.source, ...(memory.tags ?? [])].join(' ').toLowerCase();
  const matches = terms.filter(term => text.includes(term)).length;
  return matches * 10 + (importanceWeight[memory.importance] ?? 2);
}

export function createMemory({ type, content, scope = 'company', scopeId = null, importance = 'normal', tags = [], source = 'system' }) {
  if (!MEMORY_TYPES.includes(type)) throw new Error(`Unsupported memory type: ${type}`);
  if (!MEMORY_IMPORTANCE.includes(importance)) throw new Error(`Unsupported memory importance: ${importance}`);
  const text = String(content ?? '').trim();
  if (!text) throw new Error('Memory content is required');
  const normalizedTags = normalizeTags(tags);
  const existing = store.list('memory').find(memory => memory.type === type && memory.scope === scope && memory.scopeId === scopeId && String(memory.content).trim() === text);
  if (existing) return store.put('memory', { ...existing, importance, tags: [...new Set([...(existing.tags ?? []), ...normalizedTags])], source });
  const memory = store.put('memory', { id: id('mem'), type, content: text, scope, scopeId, importance, tags: normalizedTags, source, createdAt: now() });
  store.addEvent('memory.created', memory);
  return memory;
}

export function searchMemory({ scope = null, scopeId = null, type = null, tag = null, query = null, limit = 20 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const normalizedTag = tag ? String(tag).trim().toLowerCase() : null;
  return store.list('memory')
    .filter(memory => (!scope || memory.scope === scope) && (!scopeId || memory.scopeId === scopeId) && (!type || memory.type === type) && (!normalizedTag || (memory.tags ?? []).includes(normalizedTag)))
    .map(memory => ({ memory, score: scoreMemory(memory, query) }))
    .filter(entry => !query || entry.score > (importanceWeight[entry.memory.importance] ?? 2))
    .sort((a, b) => b.score - a.score || String(b.memory.updatedAt ?? '').localeCompare(String(a.memory.updatedAt ?? '')))
    .slice(0, safeLimit)
    .map(entry => entry.memory);
}
