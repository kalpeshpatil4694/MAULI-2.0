import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { createProject, addTaskToProject } from '../src/projects.js';
import { registerArtifact } from '../src/artifacts.js';
import { ensureProjectPipeline } from '../src/pipeline-gates.js';
import { listExecutors } from '../src/executor-registry.js';

test('L1 delivery pipeline creates ordered mandatory gates', () => {
  const project = createProject({
    name: 'Pipeline Gate Test',
    objective: 'Build a small application',
    founderCommand: 'Build a small application',
    requirements: ['functional application']
  });
  const generated = addTaskToProject(project.id, {
    title: 'Generate application',
    description: 'Generate source code',
    requiredCapabilities: ['frontend'],
    acceptance: [{ field: 'type', equals: 'code' }],
    executor: 'internal.code',
    maxAttempts: 1,
    sequence: 100
  });
  store.put('tasks', { ...generated, state: 'completed', verificationId: 'verification-generated', id: generated.id });
  registerArtifact({
    projectId: project.id,
    taskId: generated.id,
    type: 'code-workspace',
    content: { files: [{ path: 'index.html', content: '<main>MAULI</main>' }] }
  });
  const finalQa = addTaskToProject(project.id, {
    title: 'Final project verification and QA',
    description: 'Verify completed project',
    requiredCapabilities: ['testing', 'verification'],
    acceptance: [{ field: 'type', equals: 'plan' }],
    executor: 'internal.plan',
    maxAttempts: 1,
    sequence: 999,
    finalProjectVerification: true
  });

  const result = ensureProjectPipeline(project.id);
  const gates = store.list('tasks').filter(t => t.projectId === project.id && t.pipelineGate).sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(gates.map(t => t.gateType), ['build', 'test', 'requirements', 'security', 'qa', 'integrity']);
  assert.equal(gates.find(t => t.gateType === 'qa')?.id, finalQa.id);
  assert.equal(gates.find(t => t.gateType === 'build')?.dependsOn.includes(generated.id), true);
  assert.equal(gates.find(t => t.gateType === 'integrity')?.dependsOn[0], gates.find(t => t.gateType === 'qa')?.id);
  assert.ok(result.created.length >= 5);
  assert.ok(listExecutors().some(e => e.name === 'internal.pipeline-gate'));
});
