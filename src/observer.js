import { id, now } from './core.js';
import { store } from './store.js';

export const OBSERVER_DOMAINS = ['task','agent','execution','verification','retry','escalation','artifact','project','system'];

function domainFor(type = '') {
  const prefix = String(type).split('.')[0];
  if (prefix === 'task' || prefix === 'agent' || prefix === 'execution' || prefix === 'verification' || prefix === 'artifact' || prefix === 'project') return prefix;
  if (String(type).includes('retry')) return 'retry';
  if (String(type).includes('escalat')) return 'escalation';
  return 'system';
}

function entityIdFor(event, domain = domainFor(event?.type)) {
  const p = event?.payload ?? {};
  if (domain === 'task') return p.taskId ?? p.id ?? null;
  if (domain === 'agent') return p.agentId ?? p.id ?? null;
  if (domain === 'execution') return p.executionId ?? p.runId ?? p.id ?? null;
  if (domain === 'verification') return p.verificationId ?? p.id ?? null;
  if (domain === 'artifact') return p.artifactId ?? p.id ?? null;
  if (domain === 'project') return p.projectId ?? p.id ?? null;
  return p.taskId ?? p.agentId ?? p.runId ?? p.executionId ?? p.verificationId ?? p.artifactId ?? p.projectId ?? p.id ?? null;
}

function normalize(event) {
  const domain = domainFor(event.type);
  const p = event.payload ?? {};
  return {
    id: event.id,
    type: event.type,
    domain,
    entityId: entityIdFor(event, domain),
    taskId: p.taskId ?? (domain === 'task' ? p.id : null),
    projectId: p.projectId ?? (domain === 'project' ? p.id : null),
    agentId: p.agentId ?? (domain === 'agent' ? p.id : null),
    executionId: p.executionId ?? p.runId ?? (domain === 'execution' ? p.id : null),
    verificationId: p.verificationId ?? (domain === 'verification' ? p.id : null),
    artifactId: p.artifactId ?? (domain === 'artifact' ? p.id : null),
    at: event.at ?? event.createdAt ?? now(),
    payload: p
  };
}

export function recordObserverEvent(type, payload = {}) {
  if (!type || typeof type !== 'string') throw new Error('Observer event type is required');
  return normalize(store.addEvent(type, { ...payload, observerEventId: id('obs') }));
}

export function listObserverEvents({ limit = 100, domain, taskId, projectId, agentId, executionId, verificationId, since } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const cutoff = since ? Date.parse(since) : NaN;
  return store.recentEvents(Math.max(safeLimit, 1000)).map(normalize).filter(event => {
    if (domain && event.domain !== domain) return false;
    if (taskId && event.taskId !== taskId && event.entityId !== taskId) return false;
    if (projectId && event.projectId !== projectId && event.entityId !== projectId) return false;
    if (agentId && event.agentId !== agentId && event.entityId !== agentId) return false;
    if (executionId && event.executionId !== executionId && event.entityId !== executionId) return false;
    if (verificationId && event.verificationId !== verificationId && event.entityId !== verificationId) return false;
    if (Number.isFinite(cutoff) && Date.parse(event.at) < cutoff) return false;
    return true;
  }).slice(0, safeLimit);
}

export function getTaskTimeline(taskId, options = {}) {
  return listObserverEvents({ ...options, taskId, limit: options.limit ?? 200 });
}

export function getProjectTimeline(projectId, options = {}) {
  return listObserverEvents({ ...options, projectId, limit: options.limit ?? 200 });
}

export function getAgentTimeline(agentId, options = {}) {
  return listObserverEvents({ ...options, agentId, limit: options.limit ?? 200 });
}

export function getExecutionTimeline(executionId, options = {}) {
  return listObserverEvents({ ...options, executionId, limit: options.limit ?? 200 });
}

export function getVerificationTimeline(verificationId, options = {}) {
  return listObserverEvents({ ...options, verificationId, limit: options.limit ?? 200 });
}

export function observerSummary(options = {}) {
  const events = listObserverEvents({ ...options, limit: options.limit ?? 500 });
  const counts = Object.fromEntries(OBSERVER_DOMAINS.map(domain => [domain, 0]));
  for (const event of events) counts[event.domain] = (counts[event.domain] ?? 0) + 1;
  return { count: events.length, counts, latest: events[0] ?? null };
}
