import { id, now } from './core.js';
import { store } from './store.js';

const LEVELS = Object.freeze({ low: 0, normal: 1, high: 2, critical: 3 });
const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;
const SECRET_KEYS = /token|secret|password|api[-_]?key|authorization|credential/i;

export function normalizeRisk(risk = 'normal') {
  const value = String(risk).toLowerCase();
  if (!(value in LEVELS)) throw new Error(`Unknown risk level: ${risk}`);
  return value;
}

export function sanitizeAuditValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : sanitizeAuditValue(item)]));
}

export function createApproval({ action, risk = 'high', projectId = null, taskId = null, requestedBy = 'founder', ttlMs = DEFAULT_APPROVAL_TTL_MS }) {
  if (!action || typeof action !== 'string') throw new Error('Approval action is required');
  const normalizedRisk = normalizeRisk(risk);
  const safeTtl = Number.isFinite(ttlMs) ? Math.max(1000, Math.min(ttlMs, 24 * 60 * 60 * 1000)) : DEFAULT_APPROVAL_TTL_MS;
  const requestedAt = now();
  const approval = store.put('approvals', {
    id: id('approval'), action, risk: normalizedRisk, projectId, taskId, requestedBy,
    state: 'pending', requestedAt, expiresAt: new Date(Date.parse(requestedAt) + safeTtl).toISOString()
  });
  store.addEvent('security.approval.requested', sanitizeAuditValue(approval));
  return approval;
}

export function approvalIsUsable(approval, { projectId = null, taskId = null, requiredRisk = null } = {}) {
  if (!approval || approval.state !== 'approved') return false;
  if (approval.projectId && projectId && approval.projectId !== projectId) return false;
  if (approval.taskId && taskId && approval.taskId !== taskId) return false;
  if (requiredRisk && LEVELS[approval.risk] < LEVELS[normalizeRisk(requiredRisk)]) return false;
  return !approval.expiresAt || Date.parse(approval.expiresAt) > Date.now();
}

export function decideApprovalSecure(approvalId, approved, note = '', actor = 'founder') {
  const current = store.get('approvals', approvalId);
  if (!current) return null;
  if (current.state !== 'pending') return current;
  if (current.expiresAt && Date.parse(current.expiresAt) <= Date.now()) {
    const expired = store.put('approvals', { ...current, state: 'expired', decidedAt: now(), decidedBy: actor, id: current.id });
    store.addEvent('security.approval.expired', sanitizeAuditValue(expired));
    return expired;
  }
  const next = store.put('approvals', { ...current, state: approved === true ? 'approved' : 'rejected', note: String(note).slice(0, 1000), decidedAt: now(), decidedBy: actor, id: current.id });
  store.addEvent('security.approval.decided', sanitizeAuditValue(next));
  return next;
}

export function authorizeSecureAction({ risk = 'normal', projectId = null, taskId = null, approvalId = null, allowExternal = false, external = false, actor = 'system' } = {}) {
  const normalizedRisk = normalizeRisk(risk);
  if (external && !allowExternal) return { ok: false, reason: 'external_scope_not_permitted' };
  if (LEVELS[normalizedRisk] >= LEVELS.high) {
    const approval = approvalId ? store.get('approvals', approvalId) : null;
    if (!approvalIsUsable(approval, { projectId, taskId, requiredRisk: normalizedRisk })) return { ok: false, reason: 'valid_approval_required' };
  }
  store.addEvent('security.authorization.checked', { actor, projectId, taskId, risk: normalizedRisk, approvalId: approvalId ?? null, external: Boolean(external), allowed: true });
  return { ok: true };
}

export function securitySnapshot() {
  const approvals = store.list('approvals');
  const active = approvals.filter(item => item.state === 'pending' || item.state === 'approved');
  return { approvals: approvals.length, activeApprovals: active.length, highRiskApprovalRequired: true, secretsRedacted: true, generatedAt: now() };
}

export const SECURITY_LEVELS = LEVELS;
export const APPROVAL_TTL_MS = DEFAULT_APPROVAL_TTL_MS;
