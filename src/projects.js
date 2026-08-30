import { id, now } from './core.js';
import { store } from './store.js';
import { createTask, assignTask } from './tasks.js';

function projectStateFromTasks(project) {
  const tasks = store.list('tasks').filter(t => t?.projectId === project?.id);
  if (!tasks.length) return project?.state ?? 'planning';
  if (tasks.some(t => t.state === 'failed')) return 'escalated';
  if (tasks.some(t => ['working', 'running', 'blocked', 'assigned'].includes(t.state))) return 'active';
  if (tasks.every(t => t.state === 'completed')) return 'completed';
  if (tasks.some(t => t.state === 'completed')) return 'active';
  return project?.state === 'completed' ? 'active' : (project?.state ?? 'planning');
}

export function createProject({ name, objective, founderCommand = '', requirements = [], priority = 'normal' }) {
  const project = store.put('projects', { id: id('project'), name, objective, founderCommand, requirements, priority, state: 'planning', milestones: [], createdAt: now() });
  store.addEvent('project.created', project);
  return project;
}

export function addTaskToProject(projectId, taskInput) {
  const project = store.get('projects', projectId);
  if (!project) return null;
  const task = createTask({ ...taskInput, projectId });
  store.put('projects', { ...project, state: 'active', id: project.id });
  return assignTask(task.id);
}

export const listProjects = () => store.list('projects').map(project => ({
  ...project,
  state: projectStateFromTasks(project)
}));
