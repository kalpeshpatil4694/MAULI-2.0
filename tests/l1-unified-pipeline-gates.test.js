import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { ensureProjectPipeline } from '../src/pipeline-gates.js';

test('unified delivery pipeline creates ordered mandatory gates', () => {
  const projectId='pipeline-gate-regression-project';
  store.put('projects',{id:projectId,name:'Pipeline Gate Test',objective:'Build a test web app',requirements:['web app'],state:'active'});
  store.put('tasks',{id:'pipeline-generation-task',projectId,title:'Generate app',state:'completed',finalProjectVerification:false});
  store.put('tasks',{id:'pipeline-final-qa',projectId,title:'Final QA',state:'queued',finalProjectVerification:true});
  const result=ensureProjectPipeline(projectId);
  const types=result.gates.map(g=>g.type);
  assert.deepEqual(types.sort(),['build','integrity','qa','requirements','security','test'].sort());
  const byType=new Map(result.gates.map(g=>[g.type,g]));
  assert.deepEqual(byType.get('test').dependsOn,[byType.get('build').id]);
  assert.deepEqual(byType.get('requirements').dependsOn,[byType.get('test').id]);
  assert.deepEqual(byType.get('security').dependsOn,[byType.get('requirements').id]);
  assert.deepEqual(byType.get('qa').dependsOn,[byType.get('security').id]);
  assert.deepEqual(byType.get('integrity').dependsOn,[byType.get('qa').id]);
});
