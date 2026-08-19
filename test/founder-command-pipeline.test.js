import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretCommand } from '../src/orchestrator.js';

test('founder command becomes an actionable intent', () => {
  const intent = interpretCommand('Create an e-commerce platform');
  assert.equal(intent.command, 'Create an e-commerce platform');
  assert.ok(intent.objective);
  assert.ok(intent.capabilities.includes('requirements'));
});

test('empty founder command is rejected', () => {
  assert.throws(() => interpretCommand('   '), /Founder command is required/);
});
