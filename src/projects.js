import { id, now } from './core.js';
import { store } from './store.js';
import { createTask, assignTask } from './tasks.js';
import { estimateProjectDuration } from './time-tracking.js';

// A duplicate pipeline gate that was collapsed (cancelled) is not unfinished work: counting
// it as live kept such a project deriving as 'active' forever, even after its delivery was
// written, which is what "the project never finishes" looked like from the dashboard.
const settledTask = t => t.state === 'completed' || (t.state === 'cancelled' && t.collapsedDuplicate === true);

function projectStateFromTasks(project) {
  const tasks = store.list('tasks').filter(t => t?.projectId === project?.id);
  if (project?.state === 'awaiting_approval') return 'awaiting_approval';
  if (['failed','escalated','cancelled'].includes(project?.state)) return project.state === 'escalated' ? 'failed' : project.state;
  if (!tasks.length) return project?.state ?? 'planning';
  const pending = tasks.some(t => ['queued','working','running','assigned','verifying'].includes(t.state));
  const failed = tasks.some(t => t.state === 'failed');
  const blocked = tasks.some(t => t.state === 'blocked');
  const allSettled = tasks.every(settledTask);
  // Active means work is actually pending/running. A blocked or failed pipeline with no
  // runnable work is terminal and must never masquerade as an active project forever.
  if (allSettled) return project?.finalDeliveryId ? 'completed' : 'blocked';
  if (failed && !pending) return 'failed';
  if (blocked && !pending) return 'blocked';
  if (pending) return 'active';
  return project?.state ?? 'planning';
}

export function createProject({ name, objective, founderCommand = '', requirements = [], priority = 'normal', commandRunId = null, commandReceivedAt = null, platform = null, requirementSpec = null, architecture = null }) {
  // The target platform is part of the command, not a build-time afterthought: it is
  // recorded with the project so every later step — planning, generation, packaging and
  // the delivery manifest — builds for what the founder actually asked for.
  //
  // The structured specification and the selected architecture ride along for the same
  // reason. Every REQ id the founder can be held to, and the delivery shape MAULI owes
  // them, are decided once, here, and read by generation, the gates and the delivery.
  const project = store.put('projects', { id: id('project'), name, objective, founderCommand, requirements, requirementSpec, architecture, priority, platform: platform ?? null, state: 'planning', milestones: [], commandRunId, commandReceivedAt:commandReceivedAt||now(), commandStartedAt:commandReceivedAt||now(), createdAt: commandReceivedAt||now() });
  store.addEvent('project.created', project); return project;
}

export function addTaskToProject(projectId, taskInput) {
  const project = store.get('projects', projectId); if (!project) return null;
  const task = createTask({ ...taskInput, projectId });
  store.put('projects', { ...project, state: 'active', startedAt:project.startedAt||now(), estimatedDurationMs:estimateProjectDuration(store.list('tasks').filter(t=>t.projectId===project.id)), id: project.id });
  return assignTask(task.id);
}

export const listProjects = () => store.list('projects').map(project => ({ ...project, state: projectStateFromTasks(project) }));
