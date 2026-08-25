import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { recordLearning, observeExecutionLearning, getLearning, retireLearning, learningSnapshot } from '../src/learning.js';

test('learning engine validates domains and records idempotent observations', () => {
  assert.throws(() => recordLearning({ type: 'bad', pattern: 'x', outcome: 'success' }), /Unsupported learning type/);
  assert.throws(() => recordLearning({ type: 'success_pattern', pattern: '', outcome: 'success' }), /pattern is required/);
  const a = recordLearning({ type: 'success_pattern', pattern: 'coding task', outcome: 'success', scope: 'project', scopeId: 'p1', confidence: 0.9 });
  const b = recordLearning({ type: 'success_pattern', pattern: 'coding task', outcome: 'failure', scope: 'project', scopeId: 'p1' });
  assert.equal(a.id, b.id);
  assert.equal(b.observations, 2);
  assert.ok(b.confidence >= 0 && b.confidence <= 1);
});

test('learning scopes isolate project and agent performance', () => {
  recordLearning({ type: 'agent_performance', pattern: 'agent-a', outcome: 'success', scope: 'agent', scopeId: 'agent-a' });
  recordLearning({ type: 'agent_performance', pattern: 'agent-b', outcome: 'failure', scope: 'agent', scopeId: 'agent-b' });
  assert.equal(getLearning({ scope: 'agent', scopeId: 'agent-a' }).every(x => x.scopeId === 'agent-a'), true);
  assert.equal(getLearning({ scope: 'agent', scopeId: 'agent-a' }).some(x => x.scopeId === 'agent-b'), false);
});

test('execution observation creates success, performance and recovery patterns', () => {
  const result = observeExecutionLearning({ task: { id: 't1', projectId: 'p1', agentId: 'a1', title: 'build app' }, execution: { id: 'r1', state: 'completed' }, verification: { passed: true }, recovery: { action: 'retry', classification: 'transient' }, modelId: 'm1', toolId: 'tool1' });
  assert.equal(result.length, 5);
  assert.ok(result.every(x => x.confidence >= 0 && x.confidence <= 1));
  assert.equal(getLearning({ type: 'model_performance', query: 'm1' }).length, 1);
  assert.equal(getLearning({ type: 'recovery_pattern', query: 'retry' }).length, 1);
});

test('learning retirement removes retired records from active recall', () => {
  const item = recordLearning({ type: 'failure_pattern', pattern: 'known failure', outcome: 'failure' });
  assert.equal(getLearning({ query: 'known failure' }).length, 1);
  const retired = retireLearning(item.id);
  assert.equal(retired.status, 'retired');
  assert.equal(getLearning({ query: 'known failure' }).length, 0);
});

test('learning snapshot remains bounded and numeric', () => {
  const snapshot = learningSnapshot();
  assert.equal(Number.isFinite(snapshot.averageConfidence), true);
  assert.ok(snapshot.count >= 0);
  assert.ok(snapshot.highConfidence >= 0);
  assert.ok(store.list('learning').every(x => x.confidence >= 0 && x.confidence <= 1));
});
