import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';
import { checkDeliveryContract } from './delivery-contract.js';

function assertDeliveryQuality(project, tasks, artifacts) {
  const incomplete = tasks.filter(task => task.state !== 'completed');
  if (incomplete.length) throw new Error(`Final delivery blocked: ${incomplete.length} task(s) are not completed`);

  const failedVerification = tasks.filter(task => {
    if (!task.verificationId) return true;
    const verification = store.get('verifications', task.verificationId);
    return verification?.passed !== true;
  });
  if (failedVerification.length) throw new Error(`Final delivery blocked: ${failedVerification.length} task verification(s) failed or missing`);

  const testArtifacts = artifacts.filter(artifact => artifact.type === 'test-artifact');
  const badTestArtifacts = testArtifacts.filter(artifact => {
    const files = Array.isArray(artifact.content?.files) ? artifact.content.files : [];
    return artifact.metadata?.exactContent !== true || files.length !== 1 || !files[0]?.path || typeof files[0]?.content !== 'string';
  });
  if (testArtifacts.length && badTestArtifacts.length) throw new Error(`Final delivery blocked: ${badTestArtifacts.length} test artifact(s) failed artifact integrity`);

  const codeArtifacts = artifacts.filter(artifact => artifact.type === 'code-workspace');
  const failedQuality = codeArtifacts.filter(artifact => artifact.metadata?.qualityGateStatus !== 'PASS');
  if (codeArtifacts.length && failedQuality.length) throw new Error(`Final delivery blocked: ${failedQuality.length} generated artifact(s) failed the L1.1 quality gate`);

  const files = codeArtifacts.flatMap(artifact => Array.isArray(artifact.content?.files) ? artifact.content.files : []);
  const contract = checkDeliveryContract(project.founderCommand ?? project.objective ?? '', files);
  if (!contract.passed) {
    throw new Error(`Final delivery blocked: requested ${contract.requestedType} does not match generated artifacts. ${contract.checks.filter(check => !check.passed).map(check => check.reason || check.name).join('; ')}`);
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
  const artifactFiles = artifacts.flatMap(artifact => (artifact.content?.files ?? []).map(file => ({ artifactId: artifact.id, artifactType: artifact.type, taskId: artifact.taskId ?? null, path: file.path, content: file.content, verified: artifact.type === 'test-artifact' ? artifact.metadata?.exactContent === true : true })));
  const contract = checkDeliveryContract(project.founderCommand ?? project.objective ?? '', codeArtifactsForDelivery(artifacts));
  const delivery = {
    projectId: project.id,
    project: { id: project.id, name: project.name, objective: project.objective, founderCommand: project.founderCommand ?? null, state: project.state },
    requestedDeliveryType: contract.requestedType,
    deliveryContract: contract,
    summary: { totalTasks: tasks.length, completedTasks: completed.length, failedTasks: failed.length, artifactCount: artifacts.length, qualityGatePassedArtifacts: qualityGateArtifacts.length, artifactFileCount: artifactFiles.length, deliveredAt: now() },
    progress: project.progress ?? { percent: completed.length === tasks.length ? 100 : 0, completed: completed.length, total: tasks.length, currentTask: null },
    quality: { required: true, status: 'PASS', stages: ['automatedBuildTest', 'requirementVerification', 'securityCheck', 'artifactIntegrity', 'integrationCheck', 'finalQA', 'deliveryContract'] },
    tasks: tasks.map(task => ({ id:task.id, title:task.title, state:task.state, executor:task.executor ?? null, assignedAgentId:task.assignedAgentId ?? null, verificationId:task.verificationId ?? null })),
    artifacts: artifacts.map(artifact => ({ id:artifact.id, type:artifact.type, taskId:artifact.taskId ?? null, metadata:artifact.metadata ?? {}, files:(artifact.content?.files ?? []).map(file => ({path:file.path,content:file.content})) })),
    artifactFiles
  };
  const artifact = registerArtifact({ projectId:project.id, taskId:null, agentId:null, type:'final-delivery', content:delivery, metadata:{state:project.state,generatedBy:'mauli-l1.1-delivery',qualityGateStatus:'PASS',requestedDeliveryType:contract.requestedType,deliveryContractPassed:true} });
  artifact.content = {...delivery,artifactId:artifact.id,artifactType:artifact.type};
  artifact.metadata = {...artifact.metadata,downloadPath:`/api/artifacts/${artifact.id}/download`};
  store.put('artifacts',artifact);
  return artifact;
}

function codeArtifactsForDelivery(artifacts) {
  return artifacts.filter(artifact => artifact.type === 'code-workspace').flatMap(artifact => Array.isArray(artifact.content?.files) ? artifact.content.files : []);
}
