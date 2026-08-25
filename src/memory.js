import { id, now } from './core.js';
import { store } from './store.js';

export const MEMORY_TYPES = Object.freeze([
  'founder_rule','founder_preference','company_decision','project_requirement','technical_knowledge',
  'agent_result','task_result','tool_result','error','solution','decision','learning','approval'
]);
export const MEMORY_IMPORTANCE = Object.freeze(['low','normal','high','critical']);
export const MEMORY_SCOPES = Object.freeze(['founder','company','project','task','agent','tool']);

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  try { return JSON.stringify(value); } catch { return String(value); }
}
function normalizeConfidence(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}
function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [tags]).filter(Boolean).map(String))].slice(0, 50);
}
function fingerprint({ type, content, scope, scopeId }) {
  return [type, scope, scopeId ?? '', textOf(content).toLowerCase().replace(/\s+/g, ' ')].join('|');
}
function terms(value) { return new Set(textOf(value).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []); }
function relevance(memory, query, tag) {
  const q = terms(query); let score = 0;
  for (const word of terms(memory.content)) if (q.has(word)) score += 1;
  if (tag && memory.tags?.includes(tag)) score += 10;
  score += memory.importance === 'critical' ? 8 : memory.importance === 'high' ? 5 : memory.importance === 'normal' ? 2 : 0;
  score += normalizeConfidence(memory.confidence) * 2;
  return score;
}

export function remember({ type, content, scope = 'company', scopeId = null, importance = 'normal', tags = [], source = 'system', confidence = 0.5, provenance = null, supersedes = null, relatedMemoryIds = [] } = {}) {
  if (!MEMORY_TYPES.includes(type)) throw new Error(`Unsupported memory type: ${type}`);
  if (!MEMORY_SCOPES.includes(scope)) throw new Error(`Unsupported memory scope: ${scope}`);
  if (content == null || textOf(content) === '') throw new Error('Memory content is required');
  if (!MEMORY_IMPORTANCE.includes(importance)) throw new Error(`Unsupported memory importance: ${importance}`);
  const normalized = { type, content, scope, scopeId, importance, tags: normalizeTags(tags), source, confidence: normalizeConfidence(confidence), provenance, supersedes, relatedMemoryIds: [...new Set(relatedMemoryIds.filter(Boolean))].slice(0, 50) };
  const fp = fingerprint(normalized);
  const existing = store.list('memory').find(m => m.fingerprint === fp && m.status !== 'superseded');
  if (existing) return existing;
  if (supersedes) {
    const old = store.get('memory', supersedes);
    if (old) store.put('memory', { ...old, status: 'superseded', supersededBy: null });
  }
  const memory = store.put('memory', { id: id('mem'), ...normalized, fingerprint: fp, status: 'active', createdAt: now() });
  if (supersedes) store.put('memory', { ...memory, supersedes });
  store.addEvent('memory.created', memory);
  if (supersedes) store.addEvent('memory.superseded', { oldId: supersedes, newId: memory.id });
  return memory;
}

export function recall({ scope = null, scopeId = null, type = null, tag = null, query = '', limit = 20, includeSuperseded = false } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  return store.list('memory')
    .filter(m => (!scope || m.scope === scope) && (!scopeId || m.scopeId === scopeId) && (!type || m.type === type) && (!tag || m.tags?.includes(tag)) && (includeSuperseded || m.status !== 'superseded'))
    .map((m, index) => ({ m, score: relevance(m, query, tag), index }))
    .sort((a, b) => b.score - a.score || String(b.m.createdAt).localeCompare(String(a.m.createdAt)) || b.index - a.index)
    .slice(0, safeLimit).map(x => x.m);
}

export function getMemory(idValue) { return store.get('memory', idValue); }
export function forgetMemory(idValue) {
  const memory = getMemory(idValue);
  if (!memory) return null;
  const updated = store.put('memory', { ...memory, status: 'archived', archivedAt: now() });
  store.addEvent('memory.archived', updated);
  return updated;
}

export function linkMemories(memoryId, relatedMemoryIds = []) {
  const memory = getMemory(memoryId);
  if (!memory) throw new Error(`Memory not found: ${memoryId}`);
  const links = [...new Set([...(memory.relatedMemoryIds ?? []), ...relatedMemoryIds.filter(Boolean)])].slice(0, 50);
  return store.put('memory', { ...memory, relatedMemoryIds: links });
}
