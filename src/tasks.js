import { id, now } from './core.js';
import { store } from './store.js';
import { selectAgents, updateAgent } from './agents.js';

export const TASK_STATES = ['queued','assigned','working','verifying','completed','failed','blocked','cancelled'];

export function createTask({ projectId = null, title, description = '', requiredCapabilities = [], risk = 'normal', dependsOn = [], acceptance = [] }) {
  const task = store.put('tasks', { id: id('task'), projectId, title, description, requiredCapabilities, risk, dependsOn, acceptance, state: 'queued', attempts: 0 });
  store.addEvent('task.created', task);
  return task;
}

export function assignTask(taskId, agentId = null) {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const agent = agentId ? store.get('agents', agentId) : selectAgents(task.requiredCapabilities)[0];
  if (!agent) return store.put('tasks', { ...task, state: 'blocked', blockedReason: 'No capable available agent', id: task.id });
  const assigned = store.put('tasks', { ...task, state: 'assigned', agentId: agent.id, assignedAt: now(), id: task.id });
  updateAgent(agent.id, { state: 'assigned', currentTaskId: task.id });
  store.addEvent('task.assigned', assigned);
  return assigned;
}

export function completeTask(taskId, result = {}) {
  const task = store.get('tasks', taskId);
  if (!task) return null;
  const completed = store.put('tasks', { ...task, state: 'completed', result, completedAt: now(), id: task.id });
  if (task.agentId) updateAgent(task.agentId, { state: 'available', currentTaskId: null });
  store.addEvent('task.completed', completed);
  return completed;
}

export const listTasks = () => store.list('tasks');
