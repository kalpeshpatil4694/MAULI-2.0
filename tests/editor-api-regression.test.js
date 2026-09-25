import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { store } from '../src/store.js';

const projectId = `dashboard-editor-${Date.now()}`;
const artifactId = `artifact-${projectId}`;

store.put('projects', { id: projectId, name: 'Editor regression project', state: 'active' });
store.put('artifacts', {
  id: artifactId,
  projectId,
  type: 'code-workspace',
  content: { files: [{ path: 'www/index.html', content: '<h1>Before</h1>' }] },
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

test('editor lists and loads generated workspace files', async () => {
  const listResponse = await worker.fetch(new Request(`https://mauli.test/api/edits?projectId=${projectId}`), {});
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.ok, true);
  assert.deepEqual(list.data.files, [{ path: 'www/index.html' }]);

  const fileResponse = await worker.fetch(new Request(`https://mauli.test/api/edits?projectId=${projectId}&filePath=www/index.html`), {});
  assert.equal(fileResponse.status, 200);
  const file = await fileResponse.json();
  assert.equal(file.data.file.content, '<h1>Before</h1>');
});

test('editor saves content into the actual code workspace artifact', async () => {
  const response = await worker.fetch(new Request('https://mauli.test/api/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectId, filePath: 'www/index.html', content: '<h1>After</h1>', operation: 'update' })
  }), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.edit.projectId, projectId);
  assert.equal(store.get('artifacts', artifactId).content.files[0].content, '<h1>After</h1>');
});
