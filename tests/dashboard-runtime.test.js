import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { dashboardHTML } from '../src/dashboard.js';

test('dashboard embedded JavaScript must parse', () => {
  const html = dashboardHTML();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length > 0, 'dashboard must contain an executable script');
  for (const script of scripts) {
    try {
      new vm.Script(script, { filename: 'dashboard-inline.js' });
    } catch (error) {
      const line = Number(error?.lineNumber || error?.line || 0);
      const lines = script.split('\n');
      const context = line > 0 ? lines.slice(Math.max(0, line - 3), line + 2).join('\n') : script.slice(0, 1000);
      assert.fail(`embedded dashboard script must be valid JavaScript: ${error?.message || error}\n${context}`);
    }
  }
});

test('dashboard exposes same-origin API connection contract', () => {
  const html = dashboardHTML();
  assert.match(html, /\/api\/heartbeat/);
  assert.match(html, /\/api\/state/);
  assert.match(html, /System Online/);
});
