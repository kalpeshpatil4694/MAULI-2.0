import test from 'node:test';
import assert from 'node:assert/strict';
import { learningAdjustedRate } from '../src/agent-learning.js';

test('learning confidence grows with experience', () => {
  const early = learningAdjustedRate({ attempts: 1, successRate: 1, confidence: 0.1 });
  const experienced = learningAdjustedRate({ attempts: 10, successRate: 1, confidence: 1 });
  assert.ok(early < experienced);
  assert.equal(experienced, 1);
});

test('learning adjustment does not overreact to one failure', () => {
  const earlyFailure = learningAdjustedRate({ attempts: 1, successRate: 0, confidence: 0.1 });
  assert.equal(earlyFailure, 0.45);
  assert.ok(earlyFailure > 0);
});

test('missing learning profile is ignored', () => {
  assert.equal(learningAdjustedRate(null), null);
  assert.equal(learningAdjustedRate({ attempts: 0 }), null);
});
