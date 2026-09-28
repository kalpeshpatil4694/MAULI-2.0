import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_LIVE_SCRIPT } from '../src/dashboard-live.js';
import { dashboardHTML } from '../src/dashboard.js';

const live = DASHBOARD_LIVE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');

test('project details modal offers a deliverable download', () => {
  // The details modal was the only view a user reached after a project finished,
  // and it rendered text only — there was no way to get the files out.
  assert.match(live, /Download deliverable/);
  assert.match(live, /det\.artifacts/);
  assert.match(live, /__mauliDownloadProject\|\|window\.downloadZip/);
});

test('Downloads list does not gate the button on the capped /api/state snapshot', () => {
  // /api/state returns only the newest 100 of 429 artifacts, so the original
  // loadDl() hid the Download button for most completed projects.
  assert.match(live, /window\.loadDl=function/);
  assert.match(live, /class="btn btn-g btn-s dl-btn"/);
  assert.doesNotMatch(live, /S\.artifacts\.some/);
});

test('download failures report the real reason instead of a blank No files', () => {
  assert.match(live, /Founder key needed/);
  assert.match(live, /no code files to download/i);
  assert.match(live, /no downloadable files/i);
  assert.doesNotMatch(live, /toast\('No files','err'\)/);
});

test('dashboard publishes the download hooks for the injected layer', () => {
  const html = dashboardHTML();
  assert.match(html, /window\.__mauliDownloadProject=downloadZip/);
  assert.match(html, /window\.__mauliRequestFounderKey=requestFounderKey/);
  assert.match(html, /function requestFounderKey\(\)/);
});
