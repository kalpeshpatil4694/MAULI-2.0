import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';

export function buildFinalDelivery(project) {
  if (!project?.id) throw new Error('project is required');
  const tasks = store.list('tasks').filter(task => task.projectId === project.id);
  const artifacts = store.list('artifacts').filter(artifact => artifact.projectId === project.id);
  const completed = tasks.filter(task => task.state === 'completed');
  const failed = tasks.filter(task => task.state === 'failed');
  const delivery = {
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
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      state: task.state,
      assignedAgentId: task.assignedAgentId ?? null,
      verificationId: task.verificationId ?? null
    })),
    artifacts: artifacts.map(artifact => ({
      id: artifact.id,
      type: artifact.type,
      taskId: artifact.taskId ?? null,
      metadata: artifact.metadata ?? {}
    }))
  };
  const artifact = registerArtifact({
    projectId: project.id,
    taskId: null,
    agentId: null,
    type: 'final-delivery',
    content: delivery,
    metadata: { state: project.state, generatedBy: 'mauli-l1-delivery' }
  });
  artifact.content = {
    ...delivery,
    artifactId: artifact.id,
    artifactType: artifact.type
  };
  artifact.metadata = {
    ...artifact.metadata,
    downloadPath: `/api/artifacts/${artifact.id}/download`
  };
  store.put('artifacts', artifact);
  return artifact;
}
