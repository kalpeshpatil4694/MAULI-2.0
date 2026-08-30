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
  store.put('tasks', {
    id: 'delivery-final-qa', projectId: project.id, title: 'Final Project QA',
    state: 'completed', assignedAgentId: 'qa-agent', verificationId: 'final-verification-1',
    finalProjectVerification: true
  });

  const artifact = buildFinalDelivery(project);
  assert.equal(artifact.type, 'final-delivery');
  assert.equal(artifact.content.project.state, 'completed');
  assert.equal(artifact.content.summary.completedTasks, 2);
  assert.equal(artifact.content.tasks.find(task => task.id === 'delivery-task').verificationId, 'verification-1');
});
