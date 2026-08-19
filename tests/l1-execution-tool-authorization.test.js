import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTask } from '../src/execution.js';
import { registerTool } from '../src/tools.js';

registerTool({
  name: 'test.execution.tool',
  description: 'Tool used by execution authorization test',
  risk: 'read',
  capabilities: ['testing'],
  handler: () => ({ ok: true })
});

test('L1 execution passes authorized project and agent context to required tools', async () => {
  const result = await executeTask({
    id: 'execution-tool-test',
    projectId: 'project-1',
    assignedAgentId: 'agent-1',
    executor: 'internal.plan',
    toolNames: ['test.execution.tool']
  }, {});
  assert.equal(result.state, 'completed');
  assert.equal(result.requiredTools[0].name, 'test.execution.tool');
  assert.equal(result.requiredTools[0].authorization.ok, true);
});

test('L1 execution fails closed when a required tool is not registered', async () => {
  const result = await executeTask({
    id: 'execution-tool-missing',
    projectId: 'project-1',
    assignedAgentId: 'agent-1',
    executor: 'internal.plan',
    toolNames: ['missing.required.tool']
  }, {});
  assert.equal(result.state, 'failed');
  assert.match(result.error, /Required tool is not registered/);
});
