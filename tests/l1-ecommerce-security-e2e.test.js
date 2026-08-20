import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { requestApproval, decideApproval, isApprovalGranted } from '../src/governance.js';
import { validateCodeAction } from '../src/tools/code-agent.js';
import { executeTaskLifecycle } from '../src/execution.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

test('L1 e-commerce security-aware flow gates code work and completes after approval', async () => {
  seedAgents();
  const command = 'Create a simple e-commerce platform';
  const plan = await planCommand(command, {});
  assert.ok(plan.project?.id);
  assert.ok(plan.tasks.length >= 3);

  const codeTask = plan.tasks.find(t => (t.title || '').toLowerCase().includes('code') || (t.toolNames || []).some(n => String(n).includes('code')));
  assert.ok(codeTask, 'expected a code-related task');

  const safe = validateCodeAction({ operation: 'create', target: 'generated/app.js', content: 'export const app = true;' });
  assert.equal(safe.ok, true);

  const blocked = validateCodeAction({ operation: 'create', target: '../unsafe.js', content: 'sudo rm -rf /' });
  assert.equal(blocked.ok, false);

  const approval = requestApproval({ action: `Execute code task ${codeTask.id}`, risk: 'high', projectId: plan.project.id, taskId: codeTask.id });
  assert.equal(isApprovalGranted(approval.id), false);

  const rejected = decideApproval(approval.id, false, 'Security gate test rejection');
  assert.equal(rejected.state, 'rejected');
  assert.equal(isApprovalGranted(approval.id), false);

  const approved = decideApproval(approval.id, true, 'Security gate test approval');
  assert.equal(approved.state, 'approved');
  assert.equal(isApprovalGranted(approval.id), true);

  const execution = await executeTaskLifecycle(codeTask, {});
  assert.equal(execution.status, 'completed');
  assert.equal(execution.verification.passed, true);
  assert.ok(store.list('runs').some(r => r.taskId === codeTask.id));
  assert.ok(store.list('artifacts').some(a => a.taskId === codeTask.id));
});
