import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, startTask, completeTask } from '../src/tasks.js';
import { registerAgent } from '../src/agents.js';
import { store } from '../src/store.js';
import { recordObserverEvent, listObserverEvents, getTaskTimeline, observerSummary } from '../src/observer.js';

test('observer records normalized lifecycle events', () => {
  const agent = registerAgent({ name: `Observer Agent ${Date.now()}`, role: 'Tester', capabilities: ['testing'] });
  const task = createTask({ title: `Observer task ${Date.now()}`, projectId: 'project_observer', requiredCapabilities: ['testing'] });
  startTask(task.id);
  recordObserverEvent('task.retry', { taskId: task.id, agentId: agent.id, attempt: 2, reason: 'verification_failed' });
  completeTask(task.id, { ok: true });

  const timeline = getTaskTimeline(task.id);
  assert.ok(timeline.length >= 3);
  assert.ok(timeline.some(event => event.type === 'task.created' && event.domain === 'task'));
  assert.ok(timeline.some(event => event.type === 'task.started' && event.domain === 'task'));
  assert.ok(timeline.some(event => event.type === 'task.retry' && event.domain === 'retry'));
  assert.equal(timeline[0].taskId, task.id);
});

test('observer classifies retry and escalation before task/agent prefixes', () => {
  const taskId = `task_observer_${Date.now()}`;
  const agentId = `agent_observer_${Date.now()}`;
  const retry = recordObserverEvent('task.retry', { taskId, agentId, attempt: 2 });
  const escalation = recordObserverEvent('task.escalated', { taskId, agentId, reason: 'max_attempts' });
  const retryFromExecution = recordObserverEvent('execution.retry', { taskId, executionId: `run_${Date.now()}` });

  assert.equal(retry.domain, 'retry');
  assert.equal(retry.taskId, taskId);
  assert.equal(escalation.domain, 'escalation');
  assert.equal(escalation.taskId, taskId);
  assert.equal(retryFromExecution.domain, 'retry');
  assert.equal(retryFromExecution.taskId, taskId);
});

test('observer normalizes entity ids for every lifecycle domain', () => {
  const ids = {
    task: `task_${Date.now()}`,
    agent: `agent_${Date.now()}`,
    execution: `run_${Date.now()}`,
    verification: `verification_${Date.now()}`,
    artifact: `artifact_${Date.now()}`,
    project: `project_${Date.now()}`
  };
  for (const [domain, entityId] of Object.entries(ids)) {
    const event = recordObserverEvent(`${domain}.created`, { id: entityId });
    assert.equal(event.domain, domain);
    assert.equal(event.entityId, entityId);
  }
});

test('observer filters by domain and entity without mutating store events', () => {
  const before = store.recentEvents(1000).length;
  const task = createTask({ title: `Observer filter ${Date.now()}` });
  recordObserverEvent('verification.completed', { taskId: task.id, verificationId: `verification_${Date.now()}` });
  const verificationEvents = listObserverEvents({ domain: 'verification', taskId: task.id });
  assert.equal(verificationEvents.length, 1);
  assert.equal(verificationEvents[0].taskId, task.id);
  assert.equal(store.recentEvents(1000).length, before + 2);
});

test('observer summary exposes all domain counts', () => {
  const summary = observerSummary({ limit: 100 });
  assert.ok(summary.count >= 1);
  for (const domain of ['task','agent','execution','verification','retry','escalation','artifact','project','system']) {
    assert.ok(Object.hasOwn(summary.counts, domain));
  }
  assert.ok(summary.counts.task >= 1);
});
