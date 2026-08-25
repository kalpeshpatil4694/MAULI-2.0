import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { createApproval, approvalIsUsable, decideApprovalSecure, authorizeSecureAction, sanitizeAuditValue, securitySnapshot } from '../src/security-governance.js';

test('security governance creates scoped expiring approvals', () => {
  const approval = createApproval({ action: 'write production artifact', risk: 'high', projectId: 'project_security_test', taskId: 'task_security_test' });
  assert.equal(approval.state, 'pending');
  assert.equal(approval.projectId, 'project_security_test');
  assert.ok(approval.expiresAt);
  const decided = decideApprovalSecure(approval.id, true, 'approved for test');
  assert.equal(decided.state, 'approved');
  assert.equal(approvalIsUsable(decided, { projectId: approval.projectId, taskId: approval.taskId, requiredRisk: 'high' }), true);
});

test('security governance rejects cross-project approval reuse and missing approval', () => {
  const approval = createApproval({ action: 'write project A', risk: 'high', projectId: 'project_A' });
  decideApprovalSecure(approval.id, true);
  assert.equal(approvalIsUsable(store.get('approvals', approval.id), { projectId: 'project_B', requiredRisk: 'high' }), false);
  assert.deepEqual(authorizeSecureAction({ risk: 'high', projectId: 'project_B', approvalId: approval.id }), { ok: false, reason: 'valid_approval_required' });
  assert.deepEqual(authorizeSecureAction({ risk: 'critical', projectId: 'project_A' }), { ok: false, reason: 'valid_approval_required' });
});

test('security governance makes approval decisions immutable', () => {
  const approval = createApproval({ action: 'one-time action', risk: 'high' });
  const rejected = decideApprovalSecure(approval.id, false, 'no');
  const again = decideApprovalSecure(approval.id, true, 'should not override');
  assert.equal(rejected.state, 'rejected');
  assert.equal(again.state, 'rejected');
});

test('security governance redacts sensitive audit fields', () => {
  const value = sanitizeAuditValue({ token: 'secret', nested: { apiKey: 'secret2', ok: true }, normal: 'visible' });
  assert.deepEqual(value, { token: '[REDACTED]', nested: { apiKey: '[REDACTED]', ok: true }, normal: 'visible' });
});

test('security governance blocks external actions unless explicitly permitted', () => {
  assert.deepEqual(authorizeSecureAction({ risk: 'normal', external: true }), { ok: false, reason: 'external_scope_not_permitted' });
  assert.equal(authorizeSecureAction({ risk: 'normal', external: true, allowExternal: true }).ok, true);
  assert.equal(securitySnapshot().secretsRedacted, true);
});
