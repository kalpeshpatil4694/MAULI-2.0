import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { buildArtifactDelivery, validateArtifactPackage } from '../src/artifact-delivery-2.js';

test('artifact delivery creates an integrity-verified manifest', () => {
  const project = { id: 'batch9-web', founderCommand: 'Build a web application' };
  const artifacts = [{ id: 'a1', type: 'code-workspace', content: { files: [{ path: 'index.html', content: '<h1>MAULI</h1>' }] }, metadata: { qualityGateStatus: 'PASS' } }];
  const validation = validateArtifactPackage({ project, artifacts });
  assert.equal(validation.passed, true);
  const result = buildArtifactDelivery({ project, artifacts, version: '1.0.0' });
  assert.equal(result.type, 'delivery-package');
  assert.equal(result.content.manifest.validation.integrity, true);
  assert.equal(result.content.manifest.fileCount, 1);
});

test('mobile request rejects web-only artifact delivery', () => {
  const project = { id: 'batch9-mobile', founderCommand: 'Build an Android mobile app' };
  const artifacts = [{ id: 'a2', type: 'code-workspace', content: { files: [{ path: 'index.html', content: '<h1>web</h1>' }] } }];
  assert.equal(validateArtifactPackage({ project, artifacts }).passed, false);
  assert.throws(() => buildArtifactDelivery({ project, artifacts }), /Artifact delivery blocked/);
});

test('duplicate artifact paths fail integrity validation', () => {
  const project = { id: 'batch9-duplicate', founderCommand: 'Build a web application' };
  const artifacts = [{ id: 'a3', type: 'code-workspace', content: { files: [{ path: 'index.html', content: 'a' }, { path: 'index.html', content: 'b' }] } }];
  const result = validateArtifactPackage({ project, artifacts });
  assert.equal(result.passed, false);
  assert.equal(result.integrity, false);
});

test('delivery package is persisted in the existing artifact store', () => {
  const project = { id: 'batch9-store', founderCommand: 'Build a web application' };
  const artifacts = [{ id: 'a4', type: 'code-workspace', content: { files: [{ path: 'index.html', content: '<main />' }] } }];
  const result = buildArtifactDelivery({ project, artifacts });
  assert.equal(store.get('artifacts', result.id)?.type, 'delivery-package');
});
