import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, runNodeTest, executionPolicy } from '../src/code-execution-adapter.js';

test('L1 local execution adapter runs a safe command and captures result', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("MAULI-L1-OK")']);
  assert.equal(result.success, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'MAULI-L1-OK');
});

test('L1 local execution adapter captures failed command', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 3);
});

test('L1 node test runner returns verification-ready result', async () => {
  const result = await runNodeTest(['tests/l1-agent-selection.test.js']);
  assert.equal(typeof result.success, 'boolean');
  assert.equal(typeof result.exitCode, 'number');
  assert.ok(typeof result.stdout === 'string');
  assert.ok(typeof result.stderr === 'string');
});

test('L1 execution policy is bounded and shell-free', () => {
  const policy = executionPolicy({ timeoutMs: 999999 });
  assert.equal(policy.shell, false);
  assert.equal(policy.timeoutMs, 15000);
  assert.equal(policy.network, 'disabled-by-default');
});
