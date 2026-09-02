import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCommandResult, getCommandResult } from '../src/result-recorder.js';

test('Result persistence exposes final delivery artifact id without GitHub writes', async () => {
  const runId = `artifact_test_${Date.now()}`;
  const result = await saveCommandResult({
    runId,
    command: 'test',
    result: { status: 'completed', finalDelivery: { id: 'artifact_final_123', type: 'final-delivery' } }
  }, {});
  assert.equal(result.saved, true);
  assert.equal(result.storage, 'd1');
  assert.equal(result.githubSync.disabled, true);
  const stored = getCommandResult(runId);
  assert.equal(stored.result.artifact, 'artifact_final_123');
  assert.equal(stored.result.artifactType, 'final-delivery');
});
