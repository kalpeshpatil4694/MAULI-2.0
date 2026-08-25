import assert from 'node:assert/strict';
import test from 'node:test';
import { store } from '../src/store.js';
import { runAutonomousQA, qaRetryDecision } from '../src/autonomous-qa.js';

function reset() {
  store.data.clear();
  store.events.length = 0;
}

function goodTask() {
  const project = store.put('projects', { id: 'project_qa', objective: 'Build a web application' });
  const task = store.put('tasks', { id: 'task_qa', projectId: project.id, title: 'Build web application', description: 'Build a web application', acceptance: [] });
  const artifact = store.put('artifacts', { id: 'artifact_qa', type: 'project', content: { files: [
    { path: 'index.html', content: '<html><body>MAULI</body></html>' },
    { path: 'script.js', content: 'document.body.dataset.ready="true";' }
  ] } });
  return { task, artifact, execution: { id: 'execution_qa', taskId: task.id, state: 'completed', result: { type: 'code', artifactId: artifact.id } } };
}

test('Batch 11 QA passes the full end-to-end gate', () => {
  reset();
  const input = goodTask();
  const qa = runAutonomousQA({ ...input, regressionTest: () => true });
  assert.equal(qa.passed, true);
  assert.equal(qa.attempts.length, 1);
  assert.equal(qa.attempts[0].stages.build, true);
  assert.equal(qa.attempts[0].stages.requirementVerification, true);
  assert.equal(qa.attempts[0].stages.security, true);
  assert.equal(qa.attempts[0].stages.artifactIntegrity, true);
  assert.equal(qa.attempts[0].stages.runtimeSmoke, true);
  assert.equal(qa.attempts[0].stages.regression, true);
});

test('QA failure performs bounded recovery and re-test', () => {
  reset();
  const input = goodTask();
  let runs = 0;
  const qa = runAutonomousQA({
    ...input,
    runtimeSmokeTest: () => { runs += 1; return runs > 1; },
    regressionTest: () => true,
    maxRecoveryAttempts: 1,
    task: { ...input.task, maxAttempts: 2, qaRetest: ({ execution }) => execution }
  });
  assert.equal(qa.passed, true);
  assert.equal(qa.attempts.length, 2);
  assert.ok(store.events.some(event => event.type === 'qa.recovery'));
});

test('QA does not retry after recovery budget is exhausted', () => {
  reset();
  const input = goodTask();
  const qa = runAutonomousQA({ ...input, runtimeSmokeTest: () => false, regressionTest: () => true, maxRecoveryAttempts: 1 });
  assert.equal(qa.passed, false);
  assert.equal(qa.attempts.length, 2);
  assert.equal(qaRetryDecision(qa, 2).action, 'escalate');
});
