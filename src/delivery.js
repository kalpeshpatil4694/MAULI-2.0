import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';

function assertDeliveryQuality(project, tasks, artifacts) {
  const incomplete = tasks.filter(task => task.state !== 'completed');
  if (incomplete.length) throw new Error(`Final delivery blocked: ${incomplete.length} task(s) are not completed`);

  const failedVerification = tasks.filter(task => {
    if (!task.verificationId) return true;
    const verification = store.get('verifications', task.verificationId);
    return verification?.passed !== true;
  });
  if (failedVerification.length) throw new Error(`Final delivery blocked: ${failedVerification.length} task verification(s) failed or missing`);

  const codeArtifacts = artifacts.filter(artifact => artifact.type === 'code-workspace');
  const failedQuality = codeArtifacts.filter(artifact => artifact.metadata?.qualityGateStatus !== 'PASS');
  if (codeArtifacts.length && failedQuality.length) {
    throw new Error(`Final delivery blocked: ${failedQuality.length} generated artifact(s) failed the L1.1 quality gate`);
  }
}

export function buildFinalDelivery(project) {
  if (!project?.id) throw new Error('project is required');
  const tasks = store.list('tasks').filter(task => task.projectId === project.id);
  const artifacts = store.list('artifacts').filter(artifact => artifact.projectId === project.id);
  assertDeliveryQuality(project, tasks, artifacts);
  const completed = tasks.filter(task => task.state === 'completed');
  const failed = tasks.filter(task => task.state === 'failed');
  const qualityGateArtifacts = artifacts.filter(artifact => artifact.metadata?.qualityGateStatus === 'PASS');
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
      qualityGatePassedArtifacts: qualityGateArtifacts.length,
      deliveredAt: now()
    },
    quality: {
      required: true,
      status: 'PASS',
      stages: ['automatedBuildTest', 'requirementVerification', 'securityCheck', 'artifactIntegrity', 'integrationCheck', 'finalQA']
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
    metadata: { state: project.state, generatedBy: 'mauli-l1.1-delivery', qualityGateStatus: 'PASS' }
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
