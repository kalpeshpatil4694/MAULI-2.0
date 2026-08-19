import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTool, executeTool, listTools } from '../src/tools.js';

test('read-only tool executes without approval', async () => {
  const name = `test.read.${Date.now()}`;
  registerTool({ name, description: 'test', risk: 'read', handler: () => ({ ok: true }) });
  const result = await executeTool(name, {});
  assert.deepEqual(result, { ok: true });
});

test('write tool rejects execution without approval', async () => {
  const name = `test.write.${Date.now()}`;
  registerTool({ name, description: 'test', risk: 'write', handler: () => ({ ok: true }) });
  await assert.rejects(() => executeTool(name, {}), /Approval required/);
});

test('external tool rejects without external permission', async () => {
  const name = `test.external.${Date.now()}`;
  registerTool({ name, description: 'test', risk: 'external', scope: 'external', handler: () => ({ ok: true }) });
  await assert.rejects(() => executeTool(name, { }, { approved: true }), /External scope/);
});

test('destructive tool requires approval id', async () => {
  const name = `test.destroy.${Date.now()}`;
  registerTool({ name, description: 'test', risk: 'destructive', handler: () => ({ ok: true }) });
  await assert.rejects(() => executeTool(name, {}, { approved: true }), /approval ID/);
  const result = await executeTool(name, {}, { approved: true, approvalId: 'approval_test' });
  assert.deepEqual(result, { ok: true });
});

test('tool listing does not expose handlers', () => {
  const tools = listTools();
  assert.ok(tools.every(tool => !Object.hasOwn(tool, 'handler')));
});
