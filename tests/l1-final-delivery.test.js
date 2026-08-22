import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { buildFinalDelivery } from '../src/delivery.js';

test('L1 final delivery creates a founder-readable project artifact only after verification', () => {
  const project = store.put('projects', {
    id: 'delivery-project',
    name: 'Delivery Test',
    objective: 'Build and verify a small application',
    state: 'completed'
  });
  store.put('tasks', {
    id: 'delivery-task', projectId: project.id, title: 'Build application',
    state: 'completed', assignedAgentId: 'coding-agent', verificationId: 'verification-1'
  });
  store.put('verifications', { id: 'verification-1', taskId: 'delivery-task', passed: true });

  const artifact = buildFinalDelivery(project);
  assert.equal(artifact.type, 'final-delivery');
  assert.equal(artifact.content.project.state, 'completed');
  assert.equal(artifact.content.summary.completedTasks, 1);
  assert.equal(artifact.content.tasks[0].verificationId, 'verification-1');
  assert.equal(artifact.content.quality.status, 'PASS');
});

test('L1.1 final delivery blocks an unverified completed task', () => {
  const project = store.put('projects', {
    id: 'delivery-block-project', name: 'Blocked Delivery', objective: 'Build app', state: 'completed'
  });
  store.put('tasks', {
    id: 'delivery-block-task', projectId: project.id, title: 'Build app',
    state: 'completed', verificationId: 'missing-verification'
  });

  assert.throws(() => buildFinalDelivery(project), /Final delivery blocked/);
});
