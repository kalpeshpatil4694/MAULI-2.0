import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask, registerExecutor, grantExecutor } from '../src/execution.js';

test('external executor is blocked without explicit external permission', async () => {
  registerExecutor('test.external', async () => ({ ok:true }), { risk:'high', scope:'external' });
  grantExecutor('test.external','external');
  const result=await executeTask({id:'security-external-1',executor:'test.external',risk:'high'},{allowExternal:false});
  assert.equal(result.state,'failed');
  assert.match(result.error,/External execution permission is not granted/);
});

test('critical executor requires explicit approval', async () => {
  registerExecutor('test.critical', async () => ({ ok:true }), { risk:'critical', scope:'internal' });
  grantExecutor('test.critical','internal');
  const blocked=await executeTask({id:'security-critical-1',executor:'test.critical',risk:'critical'},{approved:false});
  assert.equal(blocked.state,'failed');
  assert.match(blocked.error,/Critical execution requires explicit approval/);
  const allowed=await executeTask({id:'security-critical-2',executor:'test.critical',risk:'critical'},{approved:true});
  assert.equal(allowed.state,'completed');
});
