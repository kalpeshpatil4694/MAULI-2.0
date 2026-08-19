import { id, now } from './core.js';
import { store } from './store.js';
import { createTask, assignTask } from './tasks.js';

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

export const listProjects = () => store.list('projects');
