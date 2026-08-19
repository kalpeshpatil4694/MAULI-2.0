import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgent } from '../src/agents.js';

test('L1 orchestration requires all task tools for eligible agent', () => {
  const frontend = { id:'frontend', state:'available', capabilities:['frontend','ui'], tools:['code.execute','test.run'], metadata:{} };
  const partial = { id:'partial', state:'available', capabilities:['frontend','ui'], tools:['code.execute'], metadata:{} };
  const requiredTools = ['code.execute','test.run'];
  assert(Number.isFinite(scoreAgent(frontend,['frontend'],{requiredTools,requireAllTools:true})));
  assert.equal(scoreAgent(partial,['frontend'],{requiredTools,requireAllTools:true}), -Infinity);
});
