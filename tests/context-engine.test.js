import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, selectContext, prepareContext, summarizeText, buildContextEnvelope } from '../src/context-engine.js';

test('context engine estimates tokens deterministically and safely', () => {
  assert.equal(estimateTokens('1234'), 1);
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  assert.equal(estimateTokens('1234', 0), 1);
});

test('context selection preserves system and latest user while fitting budget', () => {
  const result = selectContext([
    { role:'system', content:'System policy must remain.' },
    { role:'user', content:'Old unrelated message '.repeat(100) },
    { role:'assistant', content:'Old answer '.repeat(100) },
    { role:'user', content:'Current task: build the database API.' }
  ], { budgetTokens: 40, reserveTokens: 5 });
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages.at(-1).role, 'user');
  assert.ok(result.usedTokens <= 35);
  assert.ok(result.droppedCount >= 1);
});

test('context engine ranks relevant older context ahead of irrelevant context', () => {
  const result = selectContext([
    { role:'system', content:'policy' },
    { role:'assistant', content:'database schema and API details' },
    { role:'assistant', content:'weather and travel details' },
    { role:'user', content:'Continue database API work.' }
  ], { budgetTokens: 24, reserveTokens: 2 });
  const text = result.messages.map(m => m.content).join(' ');
  assert.match(text, /database/i);
});

test('oversized content is compressed without exceeding the budget', () => {
  const result = prepareContext([
    { role:'system', content:'A'.repeat(2000) },
    { role:'user', content:'B'.repeat(2000) }
  ], { budgetTokens: 80, reserveTokens: 8 });
  assert.ok(result.metadata.selectedInputTokens <= 72);
  assert.ok(result.metadata.compressed || result.metadata.droppedCount > 0);
});

test('summaries and context envelope respect requested headroom', () => {
  const summary = summarizeText('one two three '.repeat(100), 10);
  assert.ok(estimateTokens(summary) <= 10);
  const envelope = buildContextEnvelope({
    task:{objective:'build API'}, project:{name:'P'}, agent:{name:'A'},
    importantFacts:['fact'], recentEvents:['event'], memory:['memory'], budgetTokens:40
  });
  assert.ok(envelope.usedTokens <= 40);
  assert.ok(envelope.headroomTokens >= 0);
});
