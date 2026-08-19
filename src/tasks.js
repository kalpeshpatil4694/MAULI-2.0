import { id, now } from './core.js';
import { store } from './store.js';
import { selectAgents, updateAgent } from './agents.js';

export const TASK_STATES = ['queued','assigned','working','verifying','completed','failed','blocked','cancelled'];

export function createTask({ projectId = null, title, description = '', requiredCapabilities = [], risk = 'normal', dependsOn = [], acceptance = [], maxAttempts = 3, executor = 'internal.plan' }) {
  const task = store.put('tasks', { id: id('task'), projectId, title, description, requiredCapabilities, risk, dependsOn, acceptance, state: 'queued', attempts: 0, maxAttempts, executor });
  store.addEvent('task.created', task);
  return task;
}

export function assignTask(taskId, agentId = null) {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const dependencies = (task.dependsOn ?? []).map(idValue => store.get('tasks', idValue));
  if (dependencies.some(d => d && d.state !== 'completed')) return store.put('tasks', { ...task, state: 'blocked', blockedReason: 'Dependencies incomplete', id: task.id });
  const agent = agentId ? store.get('agents', agentId) : selectAgents(task.requiredCapabilities)[0];
  if (!agent) return store.put('tasks', { ...task, state: 'blocked', blockedReason: 'No capable available agent', id: task.id });
  const assigned = store.put('tasks', { ...task, state: 'assigned', agentId: agent.id, assignedAt: now(), id: task.id });
  updateAgent(agent.id, { state: 'assigned', currentTaskId: task.id });
  store.addEvent('task.assigned', assigned);
  return assigned;
}

export function startTask(taskId) {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const started = store.put('tasks', { ...task, state: 'working', startedAt: now(), attempts: (task.attempts ?? 0) + 1, id: task.id });
  if (started.agentId) updateAgent(started.agentId, { state: 'working', currentTaskId: started.id });
  store.addEvent('task.started', started);
  return started;
}

export function markVerifying(taskId, result = {}) {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const next = store.put('tasks', { ...task, state: 'verifying', result, id: task.id });
  if (task.agentId) updateAgent(task.agentId, { state: 'verifying', currentTaskId: task.id });
  store.addEvent('task.verifying', next);
  return next;
}

export function completeTask(taskId, result = {}) {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const completed = store.put('tasks', { ...task, state: 'completed', result, completedAt: now(), id: task.id });
  if (task.agentId) updateAgent(task.agentId, { state: 'available', currentTaskId: null });
  store.addEvent('task.completed', completed);
  return completed;
}

export function failTask(taskId, error = 'Execution failed') {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const failed = store.put('tasks', { ...task, state: 'failed', error, failedAt: now(), id: task.id });
  if (task.agentId) updateAgent(task.agentId, { state: 'available', currentTaskId: null });
  store.addEvent('task.failed', failed);
  return failed;
}

export const listTasks = () => store.list('tasks');
