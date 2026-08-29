import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { buildFinalDelivery } from '../src/delivery.js';

test('L1 final delivery is generated from completed project state', () => {
  const project = store.put('projects', {
    id: 'delivery-integration-project',
    name: 'Delivery Integration',
    objective: 'Verify final delivery integration',
    state: 'completed'
  });
  store.put('tasks', {
    id: 'delivery-integration-task',
    projectId: project.id,
    title: 'Completed task',
    state: 'completed',
    assignedAgentId: 'agent-test',
    verificationId: 'verification-test'
  });
  store.put('verifications', {
    id: 'verification-test',
    taskId: 'delivery-integration-task',
    passed: true
  });

  const artifact = buildFinalDelivery(project);
  assert.equal(artifact.type, 'final-delivery');
  assert.equal(artifact.content.project.state, 'completed');
  assert.equal(artifact.content.summary.completedTasks, 1);
  assert.equal(artifact.content.summary.failedTasks, 0);
});
