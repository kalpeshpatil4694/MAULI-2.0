import { id, now } from './core.js';
import { store } from './store.js';

const LEVELS = { low: 0, normal: 1, high: 2, critical: 3 };
export function riskLevel(input = {}) {
  if (input.destructive || input.production || input.secrets || input.externalWrite) return 'critical';
  if (input.codeWrite || input.externalApi || input.cost) return 'high';
  return 'normal';
}
export function requiresApproval(risk) { return LEVELS[risk] >= LEVELS.high; }
export function requestApproval({ action, risk = 'high', projectId = null, taskId = null }) {
  const approval = store.put('approvals', { id: id('approval'), action, risk, projectId, taskId, state: 'pending', requestedAt: now() });
  store.addEvent('approval.requested', approval);
  return approval;
}
export function decideApproval(approvalId, approved, note = '') {
  const current = store.get('approvals', approvalId);
  if (!current) return null;
  const next = store.put('approvals', { ...current, state: approved ? 'approved' : 'rejected', note, decidedAt: now(), id: current.id });
  store.addEvent('approval.decided', next);
  return next;
}
export const listApprovals = () => store.list('approvals');
