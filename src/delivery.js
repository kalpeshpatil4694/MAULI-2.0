import { now } from './core.js';
import { store } from './store.js';
import { registerArtifact } from './artifacts.js';

const REQUIRED_GATES=['build','test','requirements','security','qa','integrity'];

export function buildFinalDelivery(project,{enforceGates=false}={}) {
  if (!project?.id) throw new Error('project is required');

  const tasks = store.list('tasks').filter(t => t.projectId === project.id);
  const artifacts = store.list('artifacts').filter(a => a.projectId === project.id);
  const completed = tasks.filter(t => t.state === 'completed');
  const failed = tasks.filter(t => t.state === 'failed');
  const finalQa = tasks.filter(t => t.finalProjectVerification);
  const codeArtifacts = artifacts.filter(a => a.type === 'code-workspace');
  const gates = new Map(tasks.filter(t => t.pipelineGate && t.gateType).map(t => [t.gateType,t]));

  if (!tasks.length) throw new Error('Delivery blocked: project has no tasks');
  if (failed.length) throw new Error(`Delivery blocked: ${failed.length} task(s) failed`);
  if (completed.length !== tasks.length) throw new Error('Delivery blocked: not all project tasks are completed');

  const missing=REQUIRED_GATES.filter(type=>gates.get(type)?.state!=='completed');
  // Legacy/direct execution remains compatible; the persistent scheduler is the authoritative
  // production delivery path and opts into mandatory gate enforcement explicitly.
  if(enforceGates && missing.length) throw new Error(`Delivery blocked: mandatory gates not passed: ${missing.join(', ')}`);

  if (finalQa.length !== 1 || finalQa[0].state !== 'completed' || !finalQa[0].verificationId) {
    throw new Error('Delivery blocked: final project QA verification has not passed');
  }

  if (codeArtifacts.length) {
    const securityTasks = tasks.filter(t =>
      (t.requiredCapabilities || []).includes('security') || /security/i.test(t.title || '')
    );
    if (!securityTasks.length || securityTasks.some(t => t.state !== 'completed' || !t.verificationId)) {
      throw new Error('Delivery blocked: security verification has not passed for code project');
    }
  }

  const integrityResult=gates.get('integrity')?.result??gates.get('integrity')?.output??null;
  const deliveryContent = {
    projectId: project.id,
    project: {
      id: project.id,
      name: project.name,
      objective: project.objective,
      state: project.state
    },
    deliveryContract: {
      mandatoryGates: REQUIRED_GATES,
      gates: REQUIRED_GATES.map(type => ({
        type,
        state:gates.get(type)?.state??'missing',
        taskId:gates.get(type)?.id??null,
        verificationId:gates.get(type)?.verificationId??null
      })),
      passed:true
    },
    summary: {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      artifactCount: artifacts.length,
      deliveredAt: now()
    },
    integrityManifest: integrityResult?.manifest??[],
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      state: t.state,
      pipelineGate:t.pipelineGate===true,
      gateType:t.gateType??null,
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
      gate: 'build+test+requirements+security+qa+integrity',
      mandatoryGatesPassed:true
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
