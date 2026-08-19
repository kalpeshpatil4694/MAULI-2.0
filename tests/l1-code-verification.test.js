import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { registerArtifact } from '../src/artifacts.js';
import { executeTask } from '../src/execution.js';

test('L1 code verification rejects missing artifacts', async () => {
  const task = store.put('tasks', {
    id: 'verify-missing-artifact', projectId: 'verify-project', title: 'Verify code',
    executor: 'internal.verify-code', state: 'queued'
  });
  const result = await executeTask(task, { agentId: 'qa-test' });
  assert.equal(result.state, 'completed');
  assert.equal(result.result?.passed, false);
});

test('L1 code verification accepts a valid artifact', async () => {
  const task = store.put('tasks', {
    id: 'verify-valid-artifact', projectId: 'verify-project', title: 'Verify valid code',
    executor: 'internal.verify-code', state: 'queued'
  });
  registerArtifact({
    id: 'artifact-valid-test', projectId: task.projectId, taskId: task.id, agentId: 'coding-test',
    type: 'code-workspace',
    content: {
      files: [{ path: 'index.js', content: 'export const ok = true;' }],
      tests: ['node --test']
    }
  });
  const result = await executeTask(task, { agentId: 'qa-test', adapter: 'none' });
  assert.equal(result.state, 'completed');
  assert.equal(result.result?.passed, true);
  assert.ok(result.result?.checks?.every(check => check.passed));
});
