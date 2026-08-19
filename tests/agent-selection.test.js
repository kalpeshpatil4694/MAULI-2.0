import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAgent, selectBestAgent, scoreAgent } from '../src/agents.js';

test('agent scoring prefers the strongest capability match', () => {
  const suffix = Date.now();
  const basic = registerAgent({ name:`Basic ${suffix}`, role:'Engineer', capabilities:['backend'] });
  const strong = registerAgent({ name:`Strong ${suffix}`, role:'Engineer', capabilities:['backend','api','javascript'], metadata:{ successRate:0.95 } });
  assert.ok(scoreAgent(strong, ['backend','api']) > scoreAgent(basic, ['backend','api']));
  assert.equal(selectBestAgent(['backend','api']).id, strong.id);
});

test('agent scoring can prefer a requested department', () => {
  const suffix = Date.now();
  const a = registerAgent({ name:`A ${suffix}`, role:'Engineer', department:'General', capabilities:['research'] });
  const b = registerAgent({ name:`B ${suffix}`, role:'Research', department:'Research', capabilities:['research'] });
  assert.equal(selectBestAgent(['research'], { department:'Research' }).id, b.id);
  assert.notEqual(a.id, b.id);
});
