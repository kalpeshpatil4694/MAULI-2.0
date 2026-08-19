import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyResult } from '../src/verification.js';

test('L1 verification records individual acceptance criterion results', () => {
  const task = {
    id: 'acceptance-task',
    assignedAgentId: 'agent-1',
    acceptance: [
      { field: 'status', equals: 'ready' },
      { field: 'files', includes: 'index.js' }
    ]
  };
  const execution = {
    id: 'execution-1', taskId: 'acceptance-task', agentId: 'agent-1', state: 'completed',
    result: { status: 'ready', files: ['src/index.js'] }
  };
  const verification = verifyResult(task, execution);
  assert.equal(verification.passed, true);
  const acceptance = verification.checks.find(x => x.name === 'acceptance_criteria');
  assert.equal(acceptance.passed, true);
  assert.equal(acceptance.details.length, 2);
});

test('L1 verification fails when an acceptance criterion is not met', () => {
  const task = { id: 'acceptance-task-fail', acceptance: [{ field: 'status', equals: 'ready' }] };
  const execution = { id: 'execution-2', taskId: task.id, state: 'completed', result: { status: 'incomplete' } };
  const verification = verifyResult(task, execution);
  assert.equal(verification.passed, false);
  assert.equal(verification.checks.find(x => x.name === 'acceptance_criteria').passed, false);
});
