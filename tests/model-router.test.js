import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/model-registry.js';
import { expandCapabilities, classifyComplexity, scoreModel, routeModel, routeForRetry } from '../src/model-router.js';
import { modelRegistry } from '../src/model-registry.js';
import { generateAI } from '../src/ai.js';
import { registerModelProvider } from '../src/model-provider.js';

test('registry validates models and matches required capabilities', () => {
  const registry = new ModelRegistry([
    { id:'cheap', provider:'a', capabilities:['planning'], contextWindow:1000, reasoningScore:50, codingScore:50, qualityScore:60, speedScore:95, costScore:100, reliabilityScore:80, riskLevel:'normal', enabled:true },
    { id:'strong', provider:'b', capabilities:['planning','backend','database'], contextWindow:10000, reasoningScore:95, codingScore:95, qualityScore:95, speedScore:70, costScore:60, reliabilityScore:95, riskLevel:'normal', enabled:true }
  ]);
  assert.equal(registry.candidates(['backend'])[0].id, 'strong');
  assert.throws(() => registry.register({ id:'bad', provider:'x', capabilities:[] }), /contextWindow/);
});

test('capability aliases are deterministic', () => {
  const expanded = expandCapabilities(['coding']);
  assert.ok(expanded.includes('coding'));
  assert.ok(expanded.includes('backend'));
  assert.ok(expanded.includes('javascript'));
});

test('complexity classification escalates complex and critical work', () => {
  assert.equal(classifyComplexity({ requiredCapabilities:['frontend','backend','database','security'] }), 'complex');
  assert.equal(classifyComplexity({ description:'production security migration' }), 'critical');
  assert.equal(classifyComplexity({}), 'simple');
});

test('scoring prefers quality/reasoning on complex work and rejects insufficient context', () => {
  const fast = { id:'fast', contextWindow:10000, qualityScore:55, speedScore:100, costScore:100, reasoningScore:50, reliabilityScore:70 };
  const strong = { id:'strong', contextWindow:10000, qualityScore:95, speedScore:75, costScore:60, reasoningScore:95, reliabilityScore:95 };
  assert.ok(scoreModel(strong, { complexity:'complex' }) > scoreModel(fast, { complexity:'complex' }));
  assert.equal(scoreModel(fast, { estimatedContext:20000 }), -Infinity);
});

test('router returns fallback candidate and never hides an incompatible task', () => {
  const original = modelRegistry.models;
  modelRegistry.models = new Map([
    ['fast',{id:'fast',provider:'test',capabilities:['backend'],contextWindow:10000,qualityScore:55,speedScore:100,costScore:100,reasoningScore:50,reliabilityScore:70,riskLevel:'normal',enabled:true}],
    ['strong',{id:'strong',provider:'test',capabilities:['backend'],contextWindow:10000,qualityScore:95,speedScore:75,costScore:60,reasoningScore:95,reliabilityScore:95,riskLevel:'normal',enabled:true}]
  ]);
  try {
    const result = routeModel({ requiredCapabilities:['backend'], complexity:'complex' });
    assert.equal(result.selected.id, 'strong');
    assert.equal(result.fallback.id, 'fast');
    const impossible = routeModel({ requiredCapabilities:['quantum-computing'] });
    assert.equal(impossible.selected, null);
    assert.equal(impossible.routable, false);
  } finally { modelRegistry.models = original; }
});

test('retry routing excludes the failed model', () => {
  const original = modelRegistry.models;
  modelRegistry.models = new Map([
    ['one',{id:'one',provider:'test',capabilities:['backend'],contextWindow:1000,qualityScore:90,speedScore:90,costScore:90,reasoningScore:90,reliabilityScore:90,riskLevel:'normal',enabled:true}],
    ['two',{id:'two',provider:'test',capabilities:['backend'],contextWindow:1000,qualityScore:80,speedScore:80,costScore:80,reasoningScore:80,reliabilityScore:80,riskLevel:'normal',enabled:true}]
  ]);
  try { assert.equal(routeForRetry({requiredCapabilities:['backend']}, 'one').selected.id, 'two'); }
  finally { modelRegistry.models = original; }
});

test('AI generation uses provider adapter and automatic model fallback', async () => {
  const original = modelRegistry.models;
  modelRegistry.models = new Map([
    ['primary',{id:'primary',provider:'router-test',capabilities:['planning'],contextWindow:1000,qualityScore:100,speedScore:100,costScore:100,reasoningScore:100,reliabilityScore:100,riskLevel:'normal',enabled:true}],
    ['fallback',{id:'fallback',provider:'router-test',capabilities:['planning'],contextWindow:1000,qualityScore:90,speedScore:90,costScore:90,reasoningScore:90,reliabilityScore:90,riskLevel:'normal',enabled:true}]
  ]);
  registerModelProvider('router-test', { generate: async ({ model }) => { if (model === 'primary') throw new Error('primary unavailable'); return 'fallback-ok'; } });
  try {
    const result = await generateAI({}, [{ role:'user', content:'plan' }], { task:{requiredCapabilities:['planning'], complexity:'medium'} });
    assert.equal(result, 'fallback-ok');
  } finally { modelRegistry.models = original; }
});
