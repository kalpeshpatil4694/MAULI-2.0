import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { buildFinalDelivery } from '../src/delivery.js';

test('L1 final delivery exposes a downloadable artifact reference', () => {
  const project = store.put('projects', {
    id: 'delivery-download-project',
    name: 'Delivery Download',
    objective: 'Verify downloadable final delivery',
    state: 'completed'
  });
  store.put('tasks', {
    id: 'delivery-download-task',
    projectId: project.id,
    title: 'Completed task',
    state: 'completed',
    assignedAgentId: 'agent-test',
    verificationId: 'verification-test'
  });
  store.put('verifications', {
    id: 'verification-test',
    taskId: 'delivery-download-task',
    passed: true
  });

  const artifact = buildFinalDelivery(project);
  assert.equal(artifact.type, 'final-delivery');
  assert.equal(artifact.metadata.downloadPath, `/api/artifacts/${artifact.id}/download`);
  assert.equal(artifact.content.artifactId, artifact.id);
  assert.equal(artifact.content.artifactType, 'final-delivery');
});
