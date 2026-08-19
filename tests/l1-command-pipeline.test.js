import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { createProject, addTaskToProject } from '../src/projects.js';
import { selectAgents } from '../src/agents.js';
import { verifyResult } from '../src/verification.js';

test('L1 founder command pipeline: e-commerce request creates executable plan primitives', () => {
  seedAgents();
  const command = 'Create a simple e-commerce platform';
  const project = createProject({
    name: 'E-commerce Platform',
    objective: command,
    founderCommand: command,
    requirements: ['product catalog', 'cart', 'checkout', 'basic admin']
  });
  assert.ok(project?.id, 'project should be created');

  const codingAgent = selectAgents(['frontend', 'backend', 'api', 'coding'])[0] ?? selectAgents(['planning'])[0];
  assert.ok(codingAgent?.id, 'an agent should be selectable');

  const task = addTaskToProject(project.id, {
    title: 'Build e-commerce MVP',
    description: command,
    requiredCapabilities: ['frontend', 'backend', 'api'],
    acceptance: ['catalog works', 'cart works', 'checkout flow exists'],
    assignedAgentId: codingAgent.id,
    executor: 'internal.code',
    maxAttempts: 3,
    state: 'queued'
  });
  assert.ok(task?.id, 'coding task should be created');
  assert.equal(task.projectId, project.id);
  assert.equal(task.assignedAgentId, codingAgent.id);

  const verificationTask = addTaskToProject(project.id, {
    title: `Verify: ${task.title}`,
    description: `Verify output of ${task.id}`,
    requiredCapabilities: ['testing', 'verification'],
    acceptance: ['artifact exists', 'files valid'],
    executor: 'internal.verify-code',
    dependsOn: [task.id],
    verificationForTaskId: task.id,
    state: 'queued'
  });
  assert.ok(verificationTask?.id, 'verification task should be created');
  assert.deepEqual(verificationTask.dependsOn, [task.id]);

  const summary = verifyResult(task, {
    state: 'completed',
    result: { artifactId: 'not-yet-generated' }
  });
  assert.equal(typeof summary.passed, 'boolean');
  assert.ok(store.list('projects').some(p => p.id === project.id));
});
