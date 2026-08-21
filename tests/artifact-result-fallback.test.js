import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { saveCommandResult } from '../src/result-recorder.js';

test('completed Result recovers final delivery artifact from project registry', async () => {
  const originalFetch = globalThis.fetch;
  store.put('artifacts', {
    id: 'artifact_final_fallback',
    projectId: 'project_fallback',
    taskId: null,
    agentId: null,
    type: 'final-delivery',
    content: { projectId: 'project_fallback' },
    metadata: {},
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z'
  });
  let written = null;
  let writtenPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      const request = JSON.parse(options.body);
      writtenPayload = Buffer.from(request.content, 'base64').toString('utf8');
      written = JSON.parse(writtenPayload);
      return new Response(JSON.stringify({ ok: true, commit: { sha: 'commit-test' }, content: { sha: 'content-test' } }), { status: 200 });
    }
    const payload = writtenPayload ?? '{}';
    return new Response(JSON.stringify({ sha: 'existing', content: Buffer.from(payload).toString('base64') }), { status: 200 });
  };
  try {
    const result = await saveCommandResult({
      command: 'test',
      result: { status: 'completed', project: { id: 'project_fallback' } }
    }, { GITHUB_TOKEN: 'test-token' });
    assert.equal(result.saved, true);
    assert.equal(written.result.artifact, 'artifact_final_fallback');
    assert.equal(written.result.artifactType, 'final-delivery');
  } finally {
    store.delete?.('artifacts', 'artifact_final_fallback');
    globalThis.fetch = originalFetch;
  }
});
