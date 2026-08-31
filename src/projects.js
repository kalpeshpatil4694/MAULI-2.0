import { id, now } from './core.js';
import { store } from './store.js';
import { createTask, assignTask } from './tasks.js';

function projectStateFromTasks(project) {
  const tasks = store.list('tasks').filter(t => t?.projectId === project?.id);
  if (!tasks.length) return project?.state ?? 'planning';
  const nonQa = tasks.filter(t => !t.finalProjectVerification);
  const qa = tasks.filter(t => t.finalProjectVerification);
  if (nonQa.some(t => t.state === 'failed')) return 'active';
  if (tasks.every(t => t.state === 'completed') && qa.length > 0 && qa.every(t => t.state === 'completed' && t.verificationId)) return 'completed';
  if (tasks.some(t => ['working','running','assigned','verifying'].includes(t.state))) return 'active';
  if (tasks.some(t => t.state === 'blocked')) return 'active';
  if (nonQa.length && nonQa.every(t => t.state === 'completed') && qa.some(t => t.state !== 'completed')) return 'active';
  if (tasks.every(t => t.state === 'completed')) return 'completed';
  return project?.state === 'completed' ? 'active' : (project?.state ?? 'planning');
}

export function createProject({ name, objective, founderCommand = '', requirements = [], priority = 'normal' }) {
  const project = store.put('projects', { id: id('project'), name, objective, founderCommand, requirements, priority, state: 'planning', milestones: [], createdAt: now() });
  store.addEvent('project.created', project); return project;
}

export function addTaskToProject(projectId, taskInput) {
  const project = store.get('projects', projectId); if (!project) return null;
  const task = createTask({ ...taskInput, projectId });
  store.put('projects', { ...project, state: 'active', id: project.id });
  return assignTask(task.id);
}

export const listProjects = () => store.list('projects').map(project => ({ ...project, state: projectStateFromTasks(project) }));
