import test from 'node:test';
import assert from 'node:assert/strict';
import { founderCommandCenter } from '../src/founder-command-center.js';

test('Batch 14 founder command center exposes required control surfaces', () => {
  const html = founderCommandCenter();
  for (const label of ['Founder Command','System Readiness','Projects','Agents','Models / Providers','Memory / Learning','Approvals / Security','Artifacts / Tools','Live Activity']) assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /authorization:'Bearer '/);
  assert.match(html, /\/api\/command-center/);
  assert.match(html, /\/api\/command/);
});
