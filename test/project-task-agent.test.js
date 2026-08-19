import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addTaskToProject } from '../src/projects.js';
import { listTasks } from '../src/tasks.js';
import { registerAgent } from '../src/agents.js';
import { store } from '../src/store.js';

test('project creates assigned task and respects dependencies', () => {
  const agent=registerAgent({name:'Pipeline Test Agent',role:'Engineer',department:'Test',capabilities:['pipeline-test']});
  const project=createProject({name:'Pipeline Test',objective:'Validate project task agent flow'});
  const first=addTaskToProject(project.id,{title:'First task',requiredCapabilities:['pipeline-test']});
  assert.ok(first);
  assert.equal(first.projectId,project.id);
  assert.equal(first.agentId,agent.id);
  assert.equal(first.state,'assigned');

  const second=addTaskToProject(project.id,{title:'Dependent task',requiredCapabilities:['pipeline-test'],dependsOn:[first.id]});
  assert.ok(second);
  assert.equal(second.state,'blocked');
  assert.equal(second.blockedReason,'Dependencies incomplete');
  assert.equal(listTasks().some(t=>t.id===second.id),true);
  assert.equal(store.get('projects',project.id)?.state,'active');
});
