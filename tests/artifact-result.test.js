import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCommandResult } from '../src/result-recorder.js';

test('Result persistence exposes final delivery artifact id', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let writtenPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'PUT') {
      writtenPayload = JSON.parse(Buffer.from(JSON.parse(options.body).content, 'base64').toString('utf8'));
      return new Response(JSON.stringify({ ok: true, commit: { sha: 'commit-test' }, content: { sha: 'content-test' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = Buffer.from(JSON.stringify(writtenPayload ?? {})).toString('base64');
    return new Response(JSON.stringify({ sha: 'existing', content: body }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await saveCommandResult({ command: 'test', result: { status: 'completed', finalDelivery: { id: 'artifact_final_123', type: 'final-delivery' } } }, { GITHUB_TOKEN: 'test-token' });
    assert.equal(result.saved, true);
    const write = calls.find(call => call.options.method === 'PUT');
    const payload = JSON.parse(Buffer.from(JSON.parse(write.options.body).content, 'base64').toString('utf8'));
    assert.equal(payload.result.artifact, 'artifact_final_123');
    assert.equal(payload.result.artifactType, 'final-delivery');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
