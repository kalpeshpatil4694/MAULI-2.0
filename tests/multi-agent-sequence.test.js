import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addTaskToProject } from '../src/projects.js';
import { seedAgents, selectAgents } from '../src/agents.js';
import { completeTask } from '../src/tasks.js';
import { store } from '../src/store.js';

function setup() {
  seedAgents();
  const project = createProject({ name:'Sequence Test', objective:'Validate dependent specialist workflow' });
  const researchAgent = selectAgents(['research','analysis'])[0];
  const frontendAgent = selectAgents(['frontend','ui'])[0];
  const first = addTaskToProject(project.id, { title:'Research', requiredCapabilities:['research','analysis'], assignedAgentId:researchAgent?.id, sequence:0 });
  const second = addTaskToProject(project.id, { title:'Frontend', requiredCapabilities:['frontend','ui'], assignedAgentId:frontendAgent?.id, sequence:1, dependsOn:[first.id] });
  return { project, first, second };
}

test('dependent task remains blocked until prerequisite completes', () => {
  const { first, second } = setup();
  assert.equal(first.state, 'assigned');
  assert.equal(second.dependsOn[0], first.id);
  assert.notEqual(store.get('tasks', first.id)?.state, 'completed');
  assert.equal(store.get('tasks', second.id)?.state, 'blocked');
});

test('completed prerequisite immediately unlocks and assigns dependency', () => {
  const { first, second } = setup();
  const completed = completeTask(first.id, { verified: true });
  const unlocked = store.get('tasks', second.id);
  assert.equal(completed.state, 'completed');
  assert.equal(unlocked?.state, 'assigned');
  assert.equal(unlocked?.agentId, unlocked?.assignedAgentId);
  assert.notEqual(unlocked?.blockedReason, 'Dependencies incomplete');
});
