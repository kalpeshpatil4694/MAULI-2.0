import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { recall } from '../src/memory.js';

test('L1 memory loop records task results and reusable solutions', async () => {
  const env = {
    AI: {
      async run() {
        return JSON.stringify({
          objective: 'Plan an e-commerce product',
          requirements: ['requirements review'],
          capabilities: ['planning'],
          risks: [],
          acceptanceCriteria: ['Execution plan generated']
        });
      }
    }
  };

  const result = await planCommand('Plan an e-commerce product', env);
  assert.ok(result?.project?.id, 'project should exist');

  const memories = recall({ scope: 'task', limit: 100 });
  assert.ok(memories.some(m => m.type === 'task_result'), 'task result memory should be recorded');
  assert.ok(memories.some(m => ['solution', 'error'].includes(m.type)), 'execution learning memory should be recorded');
});
