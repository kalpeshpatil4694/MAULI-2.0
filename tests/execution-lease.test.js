import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { executeTask, registerExecutor } from '../src/execution.js';

test('a task cannot have two live execution runs', async () => {
  const taskId = `task_lease_${Date.now()}`;
  let calls = 0;
  registerExecutor('test.lease', async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 30));
    return { type:'test', calls };
  }, { scope:'internal', risk:'low' });
  store.put('tasks', { id:taskId, state:'working', projectId:`project_lease_${Date.now()}` });
  const task = { id:taskId, state:'working', executor:'test.lease', projectId:'project_lease', requiredCapabilities:[], toolNames:[] };
  const [first, second] = await Promise.all([executeTask(task, {}), executeTask(task, { forceRestart:true })]);
  assert.equal(calls, 1);
  assert.equal(first.executionId, second.executionId);
  assert.equal(store.list('runs').filter(r => r.taskId === taskId && r.state === 'running').length, 0);
});
