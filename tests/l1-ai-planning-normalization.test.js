import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretWithAI } from '../src/ai.js';

test('L1 AI planning accepts fenced JSON and filters capabilities', async () => {
  const env = { AI: { async run() { return { response: '```json\n{"objective":"Build store","requirements":["catalog"],"capabilities":["frontend","invalid-capability","backend"],"risks":["payments"],"acceptanceCriteria":["checkout works"]}\n```' }; } } };
  const plan = await interpretWithAI(env, 'Build an online store');
  assert.equal(plan.objective, 'Build store');
  assert.deepEqual(plan.capabilities, ['frontend','backend']);
  assert.deepEqual(plan.requirements, ['catalog']);
  assert.deepEqual(plan.acceptanceCriteria, ['checkout works']);
});

test('L1 AI planning survives malformed model output without claiming success', async () => {
  const env = { AI: { async run() { return { response: 'not-json: work completed' }; } } };
  const plan = await interpretWithAI(env, 'Build a website');
  assert.equal(plan.objective, 'Build a website');
  assert.equal(plan.capabilities.length, 0);
  assert.match(plan.risks[0], /malformed|not valid JSON/i);
  assert.deepEqual(plan.acceptanceCriteria, []);
});
