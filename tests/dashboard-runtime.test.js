import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHTML } from '../src/dashboard.js';

test('dashboard embedded JavaScript must parse', () => {
  const html = dashboardHTML();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length > 0, 'dashboard must contain an executable script');
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script), 'embedded dashboard script must be valid JavaScript');
  }
});

test('dashboard exposes same-origin API connection contract', () => {
  const html = dashboardHTML();
  assert.match(html, /\/api\/heartbeat/);
  assert.match(html, /\/api\/state/);
  assert.match(html, /System Online/);
});
