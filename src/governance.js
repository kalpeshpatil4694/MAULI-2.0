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
export function approveProject(approval, project, note = '') {
  // When a founder approves a high-risk command, both gates must pass at once: the approval
  // row must flip to 'approved', AND the project must be re-queued so the scheduler will
  // begin the actual task chain. Before this, approve only touched the approval row and the
  // scheduler kicked via waitUntil, so a command could sit approved but never executed while
  // the project stayed queued behind the 40-project cron slice.
  if (!approval || !project || approval.state !== 'pending') return null;
  const updatedApproval = store.put('approvals', { ...approval, state: 'approved', note, decidedAt: now(), id: approval.id });
  store.addEvent('approval.decided', updatedApproval);
  // Convert the whole project's task list back to runnable in one pass. This is what
  // re-activates a blocked/failed command: cancel the stale bookkeeping rows ("blocked:
  // dependencies incomplete", infra failures) and mark every live task queued so the
  // scheduler can re-attempt the chain from where it stopped.
  store.put('projects', { ...project, state: 'queued', updatedAt: now(), id: project.id });
  const liveOnly = store.list('tasks').filter(
    t => t.projectId === project.id &&
      !['completed','failed','cancelled','blocked'].includes(t.state)
  );
  const requeuedIds = new Set();
  for (const t of liveOnly) {
    store.put('tasks', { ...t, state: 'queued', agentId: null, assignedAgentId: null, leaseUntil: null, infraRecoveries: 0, error: null, blockedReason: null, updatedAt: now(), id: t.id });
    requeuedIds.add(t.id);
  }
  // Deterministic re-activation of tasks stuck on dependency bookkeeping. A blocked or failed
  // task is a stale artifact, not a real blocker, when every input is either already finished
  // or itself re-queued above — the chain will reach it again through normal progression.
  // Idempotent: only mutates a row whose dependencies can actually become satisfied.
  const allReady = (depends) => (depends ?? []).every(id => {
    if (requeuedIds.has(id)) return true;
    const dep = store.get('tasks', id);
    return dep ? ['completed','failed','cancelled'].includes(dep.state) : false;
  });
  for (const gate of store.list('tasks').filter(
    t => t.projectId === project.id && ['blocked','failed'].includes(t.state)
  )) {
    if (allReady(gate.dependsOn)) {
      store.put('tasks', {
        ...gate, state: 'queued', agentId: null, assignedAgentId: null,
        leaseUntil: null, infraRecoveries: 0, error: null, blockedReason: null,
        updatedAt: now(), id: gate.id
      });
      requeuedIds.add(gate.id);
    }
  }
  return { approval: updatedApproval, project: store.get('projects', project.id), requeuedTaskIds: [...requeuedIds] };
}
export function isApprovalGranted(approvalId) {
  const approval = store.get('approvals', approvalId);
  return approval?.state === 'approved';
}
export const listApprovals = () => store.list('approvals');
