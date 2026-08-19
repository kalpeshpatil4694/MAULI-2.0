import test from 'node:test';
import assert from 'node:assert/strict';
import { seedAgents } from '../src/agents.js';
import { store } from '../src/store.js';
import { registerExecutionAdapter } from '../src/execution-adapter.js';
import { verifyResult } from '../src/verification.js';

test('L1 core smoke: project/task/artifact verification primitives work without Cloudflare', async () => {
  seedAgents();
  assert.ok(store.list('agents').length > 0, 'agents should be seeded');

  const artifact = {
    id: 'artifact-test',
    type: 'code-workspace',
    content: {
      files: [{ path: 'index.js', content: 'export default 1;' }],
      tests: ['node --test']
    }
  };

  store.put('artifacts', artifact);
  const result = verifyResult(
    { id: 'task-test', projectId: 'project-test' },
    { state: 'completed', result: { artifactId: artifact.id } }
  );

  assert.equal(result.passed, true);

  registerExecutionAdapter('test-zero-cost', {
    capabilities: ['test'],
    cost: 'zero',
    available: () => true,
    execute: async () => ({ adapter: 'test-zero-cost', status: 'accepted', executed: false })
  });
});
