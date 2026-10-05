import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/tools.js';
import { verifyResult } from '../src/verification.js';

test('deployment tool never reports an unexecuted deployment as ready', async () => {
  const result = await executeTool('deploy.execute', {}, { agentId: 'agent-qa' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'deployment_requires_external_runner');
});

test('API tester refuses to fake localhost execution when no deployment URL exists', async () => {
  const result = await executeTool('api.test', {}, { agentId: 'agent-qa' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'baseUrl_required');
});

test('mobile build never reports a build as ready without a build runner', async () => {
  const result = await executeTool('mobile.build', {}, { agentId: 'agent-qa' });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'mobile_build_requires_external_runner');
});

test('verification rejects blocked executor results even when execution state is completed', () => {
  const task = { id: 'task-1', agentId: 'agent-qa', acceptance: [] };
  const execution = {
    id: 'run-1',
    taskId: 'task-1',
    agentId: 'agent-qa',
    state: 'completed',
    result: { status: 'blocked', reason: 'external_runner_required' }
  };
  const verification = verifyResult(task, execution);
  assert.equal(verification.passed, false);
  assert.equal(verification.checks.find(c => c.name === 'result_not_blocked')?.passed, false);
});
