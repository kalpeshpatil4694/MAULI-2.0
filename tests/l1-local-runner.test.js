import test from 'node:test';
import assert from 'node:assert/strict';
import './bootstrap-local-runner.js';
import { executeWithAdapter } from '../src/execution-adapter.js';

test('L1 local runner executes generated Node artifact without paid services', async () => {
  const result = await executeWithAdapter('local-node', {
    artifact: { content: { files: [{ path: 'index.js', content: 'console.log("MAULI_OK")' }] } },
    command: 'node',
    args: ['index.js']
  });
  assert.equal(result.executed, true);
  assert.equal(result.status, 'accepted');
  assert.match(result.stdout, /MAULI_OK/);
});
