import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { saveCommandResult, getCommandResult, listCommandResults } from '../src/result-recorder.js';

test('command result writer rewrites one canonical record for the same run', async () => {
  const runId='result-writer-regression-run';
  await saveCommandResult({runId,command:'first',result:{status:'running'}});
  await saveCommandResult({runId,command:'first',result:{status:'completed',project:{id:'project-result-writer'}}});
  const result=getCommandResult(runId);
  assert.equal(result?.resultRunId,runId);
  assert.equal(result?.result?.status,'completed');
  assert.equal(result?.id,`command-result:${runId}`);
  const rows=listCommandResults().filter(x=>x.resultRunId===runId);
  assert.equal(rows.length,1);
});
