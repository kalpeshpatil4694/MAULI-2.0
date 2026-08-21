import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { remember } from '../src/memory.js';

test('L1 command does not inject another task project memory into active context', async () => {
  const legacyTaskId = 'task_legacy_memory_isolation';
  remember({
    type: 'solution',
    content: {
      taskId: legacyTaskId,
      summary: 'Legacy project solution that must not leak into a new command.'
    },
    scope: 'task',
    scopeId: legacyTaskId,
    importance: 'normal',
    tags: ['internal.plan', 'research'],
    source: 'legacy-test'
  });

  const env = {
    AI: {
      async run() {
        return JSON.stringify({
          objective: 'Design a fresh research product',
          requirements: ['fresh requirement'],
          capabilities: ['research'],
          risks: [],
          acceptanceCriteria: ['Execution plan generated']
        });
      }
    }
  };

  const result = await planCommand('Design a fresh research product', env);
  assert.ok(result?.project?.id, 'new project should exist');
  assert.ok(result?.firstTask?.id, 'first task should exist');
  assert.notEqual(result.firstTask.id, legacyTaskId);
  assert.ok(Array.isArray(result.firstTask.memoryContext));
  assert.equal(
    result.firstTask.memoryContext.some(context => JSON.stringify(context).includes(legacyTaskId)),
    false,
    'legacy task memory must not leak into the new task context'
  );
});
