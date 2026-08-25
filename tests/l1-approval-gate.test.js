import test from 'node:test';
import assert from 'node:assert/strict';
import { requestApproval, decideApproval, isApprovalGranted, requiresApproval } from '../src/governance.js';
import { store } from '../src/store.js';

test('L1 approval gate blocks high-risk work until founder approval', () => {
  assert.equal(requiresApproval('high'), true);
  assert.equal(requiresApproval('critical'), true);

  const rejectedApproval = requestApproval({
    action: 'Write generated application code',
    risk: 'high',
    projectId: 'fixture-project',
    taskId: 'fixture-task'
  });

  assert.equal(rejectedApproval.state, 'pending');
  assert.equal(isApprovalGranted(rejectedApproval.id), false);

  const rejected = decideApproval(rejectedApproval.id, false, 'Founder rejected for test');
  assert.equal(rejected.state, 'rejected');
  assert.equal(isApprovalGranted(rejectedApproval.id), false);

  const approvedApproval = requestApproval({
    action: 'Write generated application code',
    risk: 'high',
    projectId: 'fixture-project',
    taskId: 'fixture-task'
  });
  const approved = decideApproval(approvedApproval.id, true, 'Founder approved for test');
  assert.equal(approved.state, 'approved');
  assert.equal(isApprovalGranted(approvedApproval.id), true);
  assert.equal(store.get('approvals', approvedApproval.id).state, 'approved');
});
