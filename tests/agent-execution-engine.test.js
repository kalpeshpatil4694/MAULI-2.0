import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask } from '../src/execution.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { createProject, addTaskToProject } from '../src/projects.js';

test('agent execution engine runs an assigned task and stores a result', async () => {
  seedAgents();
  const agent = store.list('agents').find(entry => (entry.capabilities ?? []).includes('planning'));
  assert.ok(agent);

  const project = createProject({
    name: 'Agent execution test',
    objective: 'Produce an execution plan'
  });
  const task = addTaskToProject(project.id, {
    title: 'Produce execution plan',
    description: 'Create a concise execution plan',
    requiredCapabilities: ['planning'],
    assignedAgentId: agent.id,
    risk: 'normal',
    executor: 'internal.plan',
    acceptance: ['Execution plan']
  });

  const result = await executeTask(task, { env: {}, agentId: agent.id });

  assert.equal(result.status, 'completed');
  assert.ok(result.result);
  assert.equal(result.taskId, task.id);
  assert.equal(result.agentId, agent.id);

  const execution = store.get('executions', result.executionId);
  assert.equal(execution?.status, 'completed');
  assert.equal(execution?.taskId, task.id);
  assert.equal(execution?.agentId, agent.id);
});
