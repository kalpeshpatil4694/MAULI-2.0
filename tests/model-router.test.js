import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRegistry } from '../src/model-registry.js';
import { classifyComplexity, scoreModel } from '../src/model-router.js';

test('registry capability matching',()=>{const r=new ModelRegistry([{id:'a',provider:'x',capabilities:['planning'],contextWindow:100,enabled:true},{id:'b',provider:'y',capabilities:['planning','backend'],contextWindow:1000,enabled:true}]);assert.equal(r.candidates(['backend'])[0].id,'b');assert.throws(()=>r.register({id:'bad'}));});
test('complexity classification',()=>{assert.equal(classifyComplexity({requiredCapabilities:['a','b','c','d']}),'complex');assert.equal(classifyComplexity({description:'production security migration'}),'critical');assert.equal(classifyComplexity({}),'simple');});
test('model scoring',()=>{const a={id:'a',contextWindow:1000,qualityScore:50,speedScore:100,costScore:100,reasoningScore:50,reliabilityScore:70};const b={id:'b',contextWindow:1000,qualityScore:95,speedScore:75,costScore:60,reasoningScore:95,reliabilityScore:95};assert.ok(scoreModel(b,{complexity:'complex'})>scoreModel(a,{complexity:'complex'}));assert.equal(scoreModel(a,{estimatedContext:2000}),-Infinity);});
