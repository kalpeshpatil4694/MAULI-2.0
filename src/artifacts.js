import { id, now } from './core.js';
import { store } from './store.js';
import { hasD1, d1Get } from './db.js';

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

/**
 * The artifact as D1 holds it, for a request that arrived before (or despite) hydration.
 *
 * `getArtifact()` answers from the isolate's hydrated copy of the store. Hydration is
 * awaited on the request path, but it is also `.catch(() => {})`-swallowed: a cold isolate
 * whose hydrate read failed (D1 subrequest ceiling, a transient error) then served EVERY
 * artifact route from an empty store. The founder clicked a delivered artifact and got
 * "Artifact not found" — for an artifact the same Worker had just listed one request
 * earlier. One row read is cheap and authoritative, so a miss in the cache falls through
 * to D1 before the route is allowed to claim the artifact does not exist.
 */
export async function getArtifactDurable(artifactId, env = store.env) {
  const cached = getArtifact(artifactId);
  if (cached) return cached;
  if (!artifactId || !hasD1(env)) return null;
  const row = await d1Get(env, 'artifacts', artifactId);
  if (!row) return null;
  // Adopt it into the cache so the rest of this request (and the next one) stops re-reading.
  store.put('artifacts', row);
  return row;
}

export function listProjectArtifacts(projectId) {
  return store.list('artifacts').filter(item => item.projectId === projectId);
}

export function listTaskArtifacts(taskId) {
  return store.list('artifacts').filter(item => item.taskId === taskId);
}
