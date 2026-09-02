import test from 'node:test';
import assert from 'node:assert/strict';
import { saveCommandResult, getCommandResult, listCommandResults } from '../src/result-recorder.js';

test('command results are stored as independent run records', async () => {
  const a = `run_test_a_${Date.now()}`;
  const b = `run_test_b_${Date.now()}`;
  await saveCommandResult({ runId:a, command:'first', result:{status:'completed'} }, {});
  await saveCommandResult({ runId:b, command:'second', result:{status:'completed'} }, {});
  assert.equal(getCommandResult(a)?.resultRunId, a);
  assert.equal(getCommandResult(b)?.resultRunId, b);
  assert.equal(Array.isArray(getCommandResult(a)), false);
  const ids = listCommandResults().map(x => x.resultRunId);
  assert.ok(ids.includes(a));
  assert.ok(ids.includes(b));
});
