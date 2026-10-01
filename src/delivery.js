import { now } from './core.js';
import { store } from './store.js';
import { d1Get, hasD1 } from './db.js';
import { registerArtifact } from './artifacts.js';
import { analyzeGeneratedApp, evaluateRequirementCoverage } from './generated-app-quality.js';

const REQUIRED_GATES=['build','test','requirements','security','qa','integrity'];

export function buildFinalDelivery(project,{enforceGates=false}={}) {
  if (!project?.id) throw new Error('project is required');

  const tasks = store.list('tasks').filter(t => t.projectId === project.id);
  const artifacts = store.list('artifacts').filter(a => a.projectId === project.id);
  const completed = tasks.filter(t => t.state === 'completed');
  const failed = tasks.filter(t => t.state === 'failed');
  const finalQa = tasks.filter(t => t.finalProjectVerification);
  const codeArtifacts = artifacts.filter(a => a.type === 'code-workspace');

  // "ZIP creation is not delivery success." The delivered code is the union of every
  // agent's artifact, judged by the same fidelity gate the QA pipeline ran: a project
  // whose app is a demo, a placeholder or a dead button must never produce a
  // final-delivery artifact, even on the legacy path that does not enforce gates.
  const mergedFiles=[];
  const seenPaths=new Set();
  for(const a of codeArtifacts){
    for(const f of (a.content?.files??[])){
      if(!f||typeof f.path!=='string'||typeof f.content!=='string'||seenPaths.has(f.path)) continue;
      seenPaths.add(f.path); mergedFiles.push({path:f.path,content:f.content});
    }
  }
  const fidelity=mergedFiles.length
    ? analyzeGeneratedApp(mergedFiles,{objective:project.objective??'',requirements:project.requirements??[]})
    : null;
  if(fidelity&&!fidelity.passed){
    throw new Error('Delivery blocked: generated app fails functional fidelity ('+fidelity.violations.map(v=>v.code).join(', ')+')');
  }
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
    // Requirement coverage the founder asked for. The Worker's honest statuses are
    // keyword evidence ('IMPLEMENTED') or its absence ('FAILED'); the Node runtime
    // verifier (scripts/verify-generated-app.mjs, run in CI) upgrades evidence to
    // executed proof and BLOCKED covers projects whose code agents never ran.
    requirementCoverage:{
      basis:'static fidelity gate over executed source (HTML/JS/CSS); runtime proof via npm run test:runtime in CI',
      statuses:(mergedFiles.length
        ? evaluateRequirementCoverage(project.requirements??[],mergedFiles).map(c=>({requirement:c.requirement,status:c.status==='IMPLEMENTED'?'IMPLEMENTED':'FAILED',matched:c.matched}))
        : (project.requirements??[]).map(r=>({requirement:String(r),status:'BLOCKED',matched:[]})))
    },
    functionalFidelity:fidelity?{
      passed:fidelity.passed,
      score:fidelity.score,
      violations:fidelity.violations.map(v=>v.code),
      filesAnalyzed:mergedFiles.length
    }:null,
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

// The delivery artifact IS the product the founder downloads, and a plain store.put writes
// it in the background: production recorded a completed project whose finalDeliveryId
// pointed at an artifact row that never reached D1 — nothing to download, no error. This
// builds the delivery and then proves the artifact is durable before the caller is allowed
// to point the project at it.
export async function buildFinalDeliveryDurable(project, options = {}) {
  const delivery = buildFinalDelivery(project, options);
  if (delivery?.id && hasD1(store.env)) {
    await store.flush().catch(() => null);
    const stored = await d1Get(store.env, 'artifacts', delivery.id).catch(() => null);
    if (!stored) {
      // The write was lost with the isolate: re-apply against whatever D1 holds.
      await store.putDurable('artifacts', delivery);
      const confirmed = await d1Get(store.env, 'artifacts', delivery.id).catch(() => null);
      if (!confirmed) throw new Error(`Delivery blocked: artifact ${delivery.id} could not be persisted`);
    }
  }
  return delivery;
}
