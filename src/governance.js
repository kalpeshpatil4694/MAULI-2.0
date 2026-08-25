import { store } from './store.js';
import { normalizeRisk, createApproval, decideApprovalSecure, approvalIsUsable, SECURITY_LEVELS } from './security-governance.js';

export function riskLevel(input = {}) {
  if (input.destructive || input.production || input.secrets || input.externalWrite) return 'critical';
  if (input.codeWrite || input.externalApi || input.cost) return 'high';
  return 'normal';
}
export function requiresApproval(risk) { return SECURITY_LEVELS[normalizeRisk(risk)] >= SECURITY_LEVELS.high; }
export function requestApproval({ action, risk = 'high', projectId = null, taskId = null, requestedBy = 'founder', ttlMs } = {}) {
  return createApproval({ action, risk, projectId, taskId, requestedBy, ...(ttlMs == null ? {} : { ttlMs }) });
}
export function decideApproval(approvalId, approved, note = '', actor = 'founder') {
  return decideApprovalSecure(approvalId, approved, note, actor);
}
export function isApprovalGranted(approvalId, context = {}) {
  return approvalIsUsable(store.get('approvals', approvalId), context);
}
export const listApprovals = () => store.list('approvals');
