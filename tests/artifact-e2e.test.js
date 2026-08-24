import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtifactE2EPlan, executeArtifactTask } from '../src/artifact-e2e.js';
import { store } from '../src/store.js';

test('artifact E2E parser creates exactly three dependent artifact stages', () => {
  const command = `Create a test project named MAULI ARTIFACT E2E RETEST with exactly 3 tasks.
Task 1: Create a real artifact file named task-1-output.txt containing exactly "MAULI TASK 1 PASSED".
Task 2: Verify task-1-output.txt exists with exactly "MAULI TASK 1 PASSED". Then create task-2-output.txt containing exactly "MAULI TASK 2 PASSED".
Task 3: Verify both previous artifact files exist with exact contents. Then create task-3-output.txt containing exactly "MAULI TASK 3 PASSED".`;
  const plan = buildArtifactE2EPlan(command);
  assert.ok(plan);
  assert.equal(plan.capabilities.includes('artifact-e2e'), true);
  assert.deepEqual(plan.artifactSteps.map(step => step.title), ['Task 1', 'Task 2', 'Task 3']);
  assert.deepEqual(plan.artifactSteps.map(step => step.artifact.path), ['task-1-output.txt', 'task-2-output.txt', 'task-3-output.txt']);
  assert.deepEqual(plan.artifactSteps[0].verifyBefore, []);
  assert.deepEqual(plan.artifactSteps[1].verifyBefore.map(x => x.path), ['task-1-output.txt']);
  assert.deepEqual(plan.artifactSteps[2].verifyBefore.map(x => x.path), ['task-1-output.txt', 'task-2-output.txt']);
});

test('artifact executor creates and verifies exact file content', async () => {
  const projectId = 'project-artifact-e2e-test';
  const task = { id: 'task-artifact-1', projectId, agentId: null, artifactSpec: { artifact: { path: 'task-1-output.txt', content: 'MAULI TASK 1 PASSED' }, verifyBefore: [] } };
  const result = await executeArtifactTask({ task });
  assert.equal(result.type, 'artifact');
  assert.equal(result.artifactVerification.passed, true);
  assert.equal(store.get('artifacts', result.artifactId).content.files[0].content, 'MAULI TASK 1 PASSED');
});
