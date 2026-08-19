import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyResult, retryDecision } from '../src/verification.js';
import { store } from '../src/store.js';

test('verification passes only when execution is complete, has result, and matches task', () => {
  const task={id:'verify-task-1',maxAttempts:3};
  const good={id:'exec-1',taskId:task.id,state:'completed',result:{ok:true}};
  const verification=verifyResult(task,good);
  assert.equal(verification.passed,true);
  assert.ok(store.get('verifications',verification.id));
});

test('failed verification retries until max attempts then escalates', () => {
  const task={id:'verify-task-2',maxAttempts:3};
  const failed={id:'exec-2',taskId:task.id,state:'failed',result:null};
  const verification=verifyResult(task,failed);
  assert.equal(verification.passed,false);
  assert.deepEqual(retryDecision(task,verification,1),{action:'retry',attempt:2});
  assert.deepEqual(retryDecision(task,verification,2),{action:'retry',attempt:3});
  assert.deepEqual(retryDecision(task,verification,3),{action:'escalate',attempt:3,reason:'verification_failed_after_retries'});
});

test('verification rejects mismatched execution identity', () => {
  const task={id:'verify-task-3',maxAttempts:1};
  const result=verifyResult(task,{id:'exec-3',taskId:'other-task',state:'completed',result:{ok:true}});
  assert.equal(result.passed,false);
  assert.equal(result.checks.find(c=>c.name==='task_identity')?.passed,false);
});
