import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgent, selectAgents } from '../src/agents.js';

test('L1 agent scoring requires task tools when requested', () => {
  const coder = { id:'coder', state:'available', capabilities:['frontend'], tools:['code.execute','test.run'], metadata:{} };
  const noTools = { id:'no-tools', state:'available', capabilities:['frontend'], tools:[], metadata:{} };
  assert(Number.isFinite(scoreAgent(coder,['frontend'],{requiredTools:['code.execute','test.run']})));
  assert.equal(scoreAgent(noTools,['frontend'],{requiredTools:['code.execute','test.run']}), -Infinity);
});

test('L1 selection can allow partial tool matches when explicitly requested', () => {
  const partial = { id:'partial', state:'available', capabilities:['frontend'], tools:['code.execute'], metadata:{} };
  const selected = selectAgents(['frontend'],null,{requiredTools:['code.execute','test.run'],requireAllTools:false});
  assert.equal(selected.some(agent=>agent.id===partial.id), false);
  assert.equal(scoreAgent(partial,['frontend'],{requiredTools:['code.execute','test.run'],requireAllTools:false}) > -Infinity, true);
});
