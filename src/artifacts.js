import { id, now } from './core.js';
import { store } from './store.js';

/**
 * Lightweight artifact registry for Worker-compatible MAULI execution.
 * Artifacts are metadata + generated content; no local filesystem is assumed.
 */
export function registerArtifact({ projectId, taskId, agentId = null, type = 'code-workspace', content, metadata = {} }) {
  if (!projectId) throw new Error('projectId is required');
  const artifact = {
    id: id('artifact'),
    projectId,
    taskId: taskId ?? null,
    agentId,
    type,
    content,
    metadata,
    createdAt: now(),
    updatedAt: now()
  };
  return store.put('artifacts', artifact);
}

export function getArtifact(artifactId) {
  return store.get('artifacts', artifactId) ?? null;
}

export function listProjectArtifacts(projectId) {
  return store.list('artifacts').filter(item => item.projectId === projectId);
}

export function listTaskArtifacts(taskId) {
  return store.list('artifacts').filter(item => item.taskId === taskId);
}
