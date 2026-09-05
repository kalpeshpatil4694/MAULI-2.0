import assert from 'node:assert/strict';
import { aiQuotaSnapshot, generateAI, AI_DAILY_REQUEST_LIMIT, AI_SAFE_REQUEST_LIMIT } from './ai.js';

function env() {
  return { AI: { async run() { return { response: 'ok' }; } } };
}

const e = env();
assert.equal(AI_DAILY_REQUEST_LIMIT, 20);
assert.equal(AI_SAFE_REQUEST_LIMIT, 18);
assert.equal(aiQuotaSnapshot(e).used, 0);

for (let i = 0; i < AI_DAILY_REQUEST_LIMIT; i++) await generateAI(e, [{ role: 'user', content: 'x' }]);
const snapshot = aiQuotaSnapshot(e);
assert.equal(snapshot.used, 20);
assert.equal(snapshot.status, 'limit_reached');
await assert.rejects(() => generateAI(e, [{ role: 'user', content: 'x' }]), /daily safety limit reached/);
