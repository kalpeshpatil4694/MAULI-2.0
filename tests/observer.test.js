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
  assert.ok(timeline.some(event => event.type === 'task.created'));
  assert.ok(timeline.some(event => event.type === 'task.started'));
  assert.ok(timeline.some(event => event.type === 'task.retry' && event.domain === 'retry'));
  assert.equal(timeline[0].taskId, task.id);
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

test('observer summary exposes domain counts', () => {
  const summary = observerSummary({ limit: 100 });
  assert.ok(summary.count >= 1);
  assert.ok(summary.counts.task >= 1);
  assert.ok(Object.hasOwn(summary.counts, 'execution'));
  assert.ok(Object.hasOwn(summary.counts, 'verification'));
});
