import test from 'node:test';
import assert from 'node:assert/strict';
import { riskLevel, requiresApproval, requestApproval, decideApproval, isApprovalGranted } from '../src/governance.js';
import { requireFounder } from '../src/auth.js';

test('high-risk actions require founder approval', () => {
  assert.equal(riskLevel({ codeWrite:true }), 'high');
  assert.equal(requiresApproval('high'), true);
  assert.equal(riskLevel({ production:true }), 'critical');
  assert.equal(requiresApproval('critical'), true);
});

test('approval cannot be granted without an explicit decision', () => {
  const approval=requestApproval({ action:'test high-risk action', risk:'high' });
  assert.equal(isApprovalGranted(approval.id), false);
  decideApproval(approval.id, true, 'approved by founder test');
  assert.equal(isApprovalGranted(approval.id), true);
});

test('founder authorization rejects missing or invalid credentials', () => {
  const env={FOUNDER_API_KEY:'secret-test-key'};
  const missing=new Request('https://example.com/api/command');
  const invalid=new Request('https://example.com/api/command',{headers:{authorization:'Bearer wrong'}});
  assert.equal(requireFounder(missing,env).status,401);
  assert.equal(requireFounder(invalid,env).status,401);
});
