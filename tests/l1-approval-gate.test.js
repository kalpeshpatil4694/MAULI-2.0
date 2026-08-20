import test from 'node:test';
import assert from 'node:assert/strict';
import { requestApproval, decideApproval, isApprovalGranted, requiresApproval } from '../src/governance.js';
import { store } from '../src/store.js';

test('L1 approval gate blocks high-risk work until founder approval', () => {
  assert.equal(requiresApproval('high'), true);
  assert.equal(requiresApproval('critical'), true);

  const approval = requestApproval({
    action: 'Write generated application code',
    risk: 'high',
    projectId: 'fixture-project',
    taskId: 'fixture-task'
  });

  assert.equal(approval.state, 'pending');
  assert.equal(isApprovalGranted(approval.id), false);

  const rejected = decideApproval(approval.id, false, 'Founder rejected for test');
  assert.equal(rejected.state, 'rejected');
  assert.equal(isApprovalGranted(approval.id), false);

  const approved = decideApproval(approval.id, true, 'Founder approved for test');
  assert.equal(approved.state, 'approved');
  assert.equal(isApprovalGranted(approval.id), true);
  assert.equal(store.get('approvals', approval.id).state, 'approved');
});
