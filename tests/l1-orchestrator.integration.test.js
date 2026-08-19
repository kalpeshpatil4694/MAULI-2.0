import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

test('L1 orchestrator: Founder e-commerce command enters real planning pipeline', async () => {
  seedAgents();

  const result = await planCommand('Create a simple e-commerce platform', {});

  assert.ok(result?.project?.id, 'orchestrator should create a project');
  assert.ok(Array.isArray(result.tasks), 'orchestrator should return tasks');
  assert.ok(result.tasks.length > 0, 'orchestrator should create at least one task');

  const projectTasks = store.list('tasks').filter(task => task.projectId === result.project.id);
  assert.ok(projectTasks.length > 0, 'project should contain persisted tasks');

  const verificationTask = projectTasks.find(task => task.executor === 'internal.verify-code');
  if (verificationTask) {
    assert.ok(Array.isArray(verificationTask.dependsOn), 'verification task should have dependencies');
  }

  assert.ok(['active', 'completed', 'escalated', 'awaiting_approval', 'blocked', 'error'].includes(result.status), `unexpected status: ${result.status}`);
});
