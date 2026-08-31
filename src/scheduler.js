import { store } from './store.js';
import { executePlannedProject } from './orchestrator.js';
import { recoverRunningExecutions } from './execution.js';

const MAX_TASKS_PER_TICK = 2;

function depsComplete(task) {
  return (task?.dependsOn ?? []).every(id => store.get('tasks', id)?.state === 'completed');
}

function runnableTasks() {
  return store.list('tasks')
    .filter(t => ['queued', 'assigned'].includes(t.state) && depsComplete(t))
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

export async function runScheduler(env = {}, limit = MAX_TASKS_PER_TICK) {
  const recovered = recoverRunningExecutions();
  const results = [];
  const candidates = runnableTasks().slice(0, Math.max(1, limit));

  for (const task of candidates) {
    // Re-read immediately so a concurrent request cannot use an already completed task.
    const current = store.get('tasks', task.id);
    if (!current || !['queued', 'assigned'].includes(current.state) || !depsComplete(current)) continue;
    const project = store.get('projects', current.projectId);
    if (!project) continue;
    const selectedAgent = current.assignedAgentId ? store.get('agents', current.assignedAgentId) : null;
    try {
      const result = await executePlannedProject({
        project,
        task: current,
        selectedAgent,
        env,
        approved: false,
        plannedTasks: store.list('tasks').filter(t => t.projectId === project.id).map(t => ({ task: t, selectedAgent: t.assignedAgentId ? store.get('agents', t.assignedAgentId) : null }))
      });
      results.push({ taskId: current.id, status: result?.status ?? 'unknown' });
    } catch (error) {
      results.push({ taskId: current.id, status: 'error', error: error?.message ?? String(error) });
    }
  }
  return { recovered: recovered.length, started: results.length, results };
}
