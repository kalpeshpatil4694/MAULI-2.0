import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { buildFinalDelivery } from '../src/delivery.js';

test('L1 final delivery creates a founder-readable project artifact', () => {
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

  const artifact = buildFinalDelivery(project);
  assert.equal(artifact.type, 'final-delivery');
  assert.equal(artifact.content.project.state, 'completed');
  assert.equal(artifact.content.summary.completedTasks, 1);
  assert.equal(artifact.content.tasks[0].verificationId, 'verification-1');
});
