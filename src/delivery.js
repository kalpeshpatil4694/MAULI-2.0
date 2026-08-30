import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';

/**
 * Build the final delivery for a completed project.
 *
 * Key fix: registerArtifact then re-store with downloadPath metadata
 * in a single store.put call so the persisted version includes everything.
 */
export function buildFinalDelivery(project) {
  if (!project?.id) throw new Error('project is required');

  const tasks = store.list('tasks').filter(t => t.projectId === project.id);
  const artifacts = store.list('artifacts').filter(a => a.projectId === project.id);
  const completed = tasks.filter(t => t.state === 'completed');
  const failed = tasks.filter(t => t.state === 'failed');

  const deliveryContent = {
    projectId: project.id,
    project: {
      id: project.id,
      name: project.name,
      objective: project.objective,
      state: project.state
    },
    summary: {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      artifactCount: artifacts.length,
      deliveredAt: now()
    },
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      state: t.state,
      assignedAgentId: t.assignedAgentId ?? null,
      verificationId: t.verificationId ?? null
    })),
    artifacts: artifacts.map(a => ({
      id: a.id,
      type: a.type,
      taskId: a.taskId ?? null,
      metadata: a.metadata ?? {}
    }))
  };

  // Register the artifact — returns the stored version with id, createdAt, etc.
  const artifact = registerArtifact({
    projectId: project.id,
    taskId: null,
    agentId: null,
    type: 'final-delivery',
    content: deliveryContent,
    metadata: {
      state: project.state,
      generatedBy: 'mauli-l1-delivery'
    }
  });

  // Re-store with downloadPath in metadata AND inject artifactId into content
  // so the API consumer knows which artifact to download.
  const final = store.put('artifacts', {
    ...artifact,
    content: {
      ...artifact.content,
      artifactId: artifact.id,
      artifactType: artifact.type
    },
    metadata: {
      ...artifact.metadata,
      downloadPath: `/api/artifacts/${artifact.id}/download`
    },
    id: artifact.id
  });

  return final;
}
