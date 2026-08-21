import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../src/zip.js';

test('L1 downloadable artifact: creates a valid ZIP signature with generated files', () => {
  const zip = createZip([
    { path: 'index.html', content: '<h1>MAULI</h1>' },
    { path: 'README.md', content: '# Generated project' }
  ]);
  assert.ok(zip instanceof Uint8Array);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.equal(zip[2], 0x03);
  assert.equal(zip[3], 0x04);
  assert.equal(zip[zip.length - 22], 0x50);
  assert.equal(zip[zip.length - 21], 0x4b);
  assert.equal(zip[zip.length - 20], 0x05);
  assert.equal(zip[zip.length - 19], 0x06);
});
