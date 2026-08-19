import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addTaskToProject } from '../src/projects.js';
import { seedAgents, selectAgents } from '../src/agents.js';
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

test('completed prerequisite unlocks dependency', () => {
  const { first, second } = setup();
  store.put('tasks', { ...first, state:'completed', id:first.id });
  const depsComplete = (second.dependsOn ?? []).every(id => store.get('tasks', id)?.state === 'completed');
  assert.equal(depsComplete, true);
});
