import test from 'node:test';
import assert from 'node:assert/strict';
import { freePlanFromCommand } from '../src/ai.js';

test('calculator command uses frontend-first capabilities', () => {
  const plan = freePlanFromCommand('Create a professional calculator web app with addition, subtraction, multiplication, division, calculation history, clear history, and responsive mobile-friendly UI');
  assert.deepEqual(plan.capabilities, ['planning', 'product-planning', 'frontend', 'ui', 'security', 'testing']);
  assert.equal(plan.capabilities.includes('backend'), false);
  assert.equal(plan.capabilities.includes('database'), false);
  assert.ok(plan.requirements.some(x => /calculation history/i.test(x)));
  assert.ok(plan.requirements.some(x => /clear calculation history/i.test(x)));
});
