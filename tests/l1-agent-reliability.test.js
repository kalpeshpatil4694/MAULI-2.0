import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgent, selectAgents, recordAgentOutcome } from '../src/agents.js';
import { store } from '../src/store.js';

test('L1 agent scoring prefers reliable specialist', () => {
  const reliable = { id:'agent-a', state:'available', capabilities:['coding'], metadata:{successRate:0.95,reliabilityScore:95} };
  const weak = { id:'agent-b', state:'available', capabilities:['coding'], metadata:{successRate:0.40,reliabilityScore:40} };
  assert(scoreAgent(reliable,['coding']) > scoreAgent(weak,['coding']));
});

test('L1 agent with three consecutive failures enters cooldown', () => {
  const agent = store.put('agents',{id:'cooldown-agent',name:'Cooldown',role:'Engineer',department:'Engineering',capabilities:['coding'],state:'available',metadata:{}});
  recordAgentOutcome(agent.id,{success:false});
  recordAgentOutcome(agent.id,{success:false});
  const updated = recordAgentOutcome(agent.id,{success:false});
  assert(updated.metadata.consecutiveFailures >= 3);
  assert(updated.metadata.cooldownUntil > Date.now());
  assert.equal(selectAgents(['coding']).some(a=>a.id===agent.id), false);
});
