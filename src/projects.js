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
  if (!tasks.length) return project?.state ?? 'planning';
  const nonQa = tasks.filter(t => !t.finalProjectVerification);
  const qa = tasks.filter(t => t.finalProjectVerification);
  if (nonQa.some(t => t.state === 'failed')) return 'active';
  // 'completed' must mean DELIVERED. Deriving it from tasks alone let a project whose
  // delivery was refused read as finished while the founder had nothing to download.
  if (tasks.every(settledTask) && qa.length > 0 && qa.every(t => settledTask(t) && t.verificationId))
    return project?.finalDeliveryId ? 'completed' : 'active';
  // 'queued' belongs here: a task waiting for a slot is runnable work, and leaving it out
  // let a project whose only task was queued fall through to its stored 'planning' label
  // even though the scheduler could claim it on the next tick.
  if (tasks.some(t => ['working','running','assigned','verifying','queued'].includes(t.state))) return 'active';
  // A project whose entire remaining workload is parked has stopped progressing. Deriving
  // the state from "any task is blocked" alone reported 'active' forever on a project where
  // nothing could run — a live spinner over dead work. When EVERY unfinished task is
  // blocked (which already means nothing is runnable: a queued/assigned/working/verifying
  // task would not be blocked), the project is 'blocked' and can show which reason holds it.
  // One runnable task alongside a blocked one is still active work.
  const unfinished = tasks.filter(t => !settledTask(t));
  if (unfinished.length && unfinished.every(t => t.state === 'blocked')) return 'blocked';
  if (tasks.some(t => t.state === 'blocked')) return 'active';
  if (nonQa.length && nonQa.every(settledTask) && qa.some(t => !settledTask(t))) return 'active';
  if (tasks.every(settledTask)) return project?.finalDeliveryId ? 'completed' : 'active';
  return project?.state === 'completed' ? 'active' : (project?.state ?? 'planning');
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
