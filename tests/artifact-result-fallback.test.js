import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { saveCommandResult, getCommandResult } from '../src/result-recorder.js';

test('completed Result recovers final delivery artifact from project registry', async () => {
  const runId = `fallback_test_${Date.now()}`;
  store.put('artifacts', {
    id: 'artifact_final_fallback', projectId: 'project_fallback', taskId: null, agentId: null,
    type: 'final-delivery', content: { projectId: 'project_fallback' }, metadata: {},
    createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z'
  });
  try {
    const result = await saveCommandResult({
      runId,
      command: 'test',
      result: { status: 'completed', project: { id: 'project_fallback' } }
    }, {});
    assert.equal(result.saved, true);
    const stored = getCommandResult(runId);
    assert.equal(stored.result.artifact, 'artifact_final_fallback');
    assert.equal(stored.result.artifactType, 'final-delivery');
  } finally {
    store.delete?.('artifacts', 'artifact_final_fallback');
  }
});
