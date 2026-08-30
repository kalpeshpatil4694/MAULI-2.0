import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';

/**
 * Build the final delivery for a project only after the project-level QA gate
 * has passed. This is intentionally defensive because delivery is the final
 * trust boundary before MAULI exposes an artifact to the founder.
 */
export function buildFinalDelivery(project) {
  if (!project?.id) throw new Error('project is required');

  const tasks = store.list('tasks').filter(t => t.projectId === project.id);
  const artifacts = store.list('artifacts').filter(a => a.projectId === project.id);
  const completed = tasks.filter(t => t.state === 'completed');
  const failed = tasks.filter(t => t.state === 'failed');
  const finalQa = tasks.filter(t => t.finalProjectVerification);
  const codeArtifacts = artifacts.filter(a => a.type === 'code-workspace');

  if (!tasks.length) throw new Error('Delivery blocked: project has no tasks');
  if (failed.length) throw new Error(`Delivery blocked: ${failed.length} task(s) failed`);
  if (completed.length !== tasks.length) throw new Error('Delivery blocked: not all project tasks are completed');
  if (finalQa.length !== 1 || finalQa[0].state !== 'completed' || !finalQa[0].verificationId) {
    throw new Error('Delivery blocked: final project QA verification has not passed');
  }

  // Code projects must include a completed security task before delivery.
  if (codeArtifacts.length) {
    const securityTasks = tasks.filter(t =>
      (t.requiredCapabilities || []).includes('security') || /security/i.test(t.title || '')
    );
    if (!securityTasks.length || securityTasks.some(t => t.state !== 'completed' || !t.verificationId)) {
      throw new Error('Delivery blocked: security verification has not passed for code project');
    }
  }

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

  const artifact = registerArtifact({
    projectId: project.id,
    taskId: null,
    agentId: null,
    type: 'final-delivery',
    content: deliveryContent,
    metadata: {
      state: project.state,
      generatedBy: 'mauli-l1-delivery',
      gate: 'final-qa+security'
    }
  });

  return store.put('artifacts', {
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
}
