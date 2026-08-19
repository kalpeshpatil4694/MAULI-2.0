import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgent } from '../src/agents.js';

test('experienced contextual agent outranks low-confidence perfect first result', () => {
  const experienced={id:'experienced',state:'available',capabilities:['backend','api'],metadata:{successRate:0.9,learning:{'api|backend':{attempts:10,successes:9,failures:1,successRate:0.9,confidence:1}}}};
  const newAgent={id:'new',state:'available',capabilities:['backend','api'],metadata:{successRate:1,learning:{'api|backend':{attempts:1,successes:1,failures:0,successRate:1,confidence:0.1}}}};
  assert.ok(scoreAgent(experienced,['backend','api']) > scoreAgent(newAgent,['backend','api']));
});

test('incomplete capability match is not eligible', () => {
  const agent={id:'partial',state:'available',capabilities:['backend'],metadata:{}};
  assert.equal(scoreAgent(agent,['backend','api']),-Infinity);
});
