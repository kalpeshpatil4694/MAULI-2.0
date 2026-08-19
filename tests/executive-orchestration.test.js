import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

test('executive orchestrator completes a multi-task founder command end-to-end', async () => {
  seedAgents();

  const env = {
    AI: {
      async run() {
        return JSON.stringify({
          objective: 'Create a validated product plan',
          requirements: ['research requirements', 'design frontend'],
          capabilities: ['research', 'frontend'],
          risks: [],
          acceptanceCriteria: ['Requirements researched', 'Frontend plan produced']
        });
      }
    }
  };

  const result = await planCommand('Create a product plan', env);

  assert.equal(result.status, 'completed');
  assert.equal(result.project.state, 'completed');
  assert.ok(result.tasks.length >= 2);

  const tasks = result.tasks.map(entry => store.get('tasks', entry.task.id));
  assert.ok(tasks.every(task => task?.state === 'completed'));
  assert.equal(tasks[1].dependsOn[0], tasks[0].id);
  assert.ok(tasks.every(task => task?.assignedAgentId));
  assert.ok(tasks.every(task => task?.verificationId));
});
