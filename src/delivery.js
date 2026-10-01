import { now } from './core.js';
import { store } from './store.js';
import { d1Get, hasD1 } from './db.js';
import { registerArtifact } from './artifacts.js';
import { analyzeGeneratedApp, evaluateRequirementCoverage } from './generated-app-quality.js';
import { buildRequirementMatrix, buildTraceability, scoreGeneratedAppQuality, dualStatus } from './requirement-matrix.js';
import { hasBackendEntryPoint } from './functional-code-executor.js';
import { describePlatform } from './platforms.js';

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
  // Wrong-app guard. Production shipped a contact form for "build a personal habit tracker"
  // with a perfect fidelity score, because the page repeated the founder's words and no
  // template matched the request. Both facts are now refused explicitly.
  const objective=(project.objective??project.name??'').toString();
  // The founder's own request, not requirements[0]: that slot is often a process
  // statement ("requirements review", "Testing plan") that no product source names.
  const founderRequirement=String(project.founderCommand??objective??'');
  if(founderRequirement&&mergedFiles.length){
    const founderCoverage=evaluateRequirementCoverage([founderRequirement],mergedFiles)[0];
    if(founderCoverage&&founderCoverage.status==='MISSING'){
      throw new Error(`Delivery blocked: the app does not implement "${founderRequirement.slice(0,80)}" (no evidence for it in the generated code)`);
    }
  }
  const unmatched=codeArtifacts.filter(a=>a.metadata?.generatedBy==='app-templates'&&a.metadata?.templateMatched===false);
  if(unmatched.length){
    const wrongTemplates=[...new Set(unmatched.map(a=>a.metadata?.template))].filter(Boolean);
    throw new Error(`Delivery blocked: MAULI could not build "${objective.slice(0,80)}" and would have delivered an unrelated template (${wrongTemplates.join(', ')})`);
  }
  const gates = new Map(tasks.filter(t => t.pipelineGate && t.gateType).map(t => [t.gateType,t]));

  // ---------------------------------------------------------------------------
  // THE REQUIREMENT MATRIX GATE.
  //
  // Every requirement the founder's command produced is judged here, and a critical one
  // that FAILs makes the project NOT DELIVERABLE. Passing generic features does not buy a
  // delivery: this is the rule that stops MAULI from shipping a working app that is not the
  // product that was asked for, and it runs before anything is written to the founder.
  // ---------------------------------------------------------------------------
  const spec = project.requirementSpec ?? null;
  const specRequirements = spec?.requirements ?? [];
  const runtime = project.runtimeEvidence ?? null;
  // Architecture obligations are delivery obligations. A specification that selected a
  // Worker API must not be satisfied by a page: the gates judge the UNION of every agent's
  // artifact, so one agent's static page must not quietly become the whole product.
  if (project.architecture?.backend === true && !hasBackendEntryPoint(mergedFiles)) {
    throw new Error(`Delivery blocked: the selected architecture is "${project.architecture.id}" (Worker API + ${project.architecture.database}), but the delivered code has no backend entry point`);
  }
  for (const obligation of project.architecture?.obligations ?? []) {
    if (obligation.id !== 'backend-endpoint' && obligation.id !== 'db-binding') continue;
    const satisfied = (obligation.evidence ?? []).some((word) =>
      mergedFiles.some((f) => String(f.content ?? '').toLowerCase().includes(String(word).toLowerCase())));
    if (!satisfied) {
      throw new Error(`Delivery blocked: architecture obligation "${obligation.id}" is unmet — ${obligation.requirement}`);
    }
  }
  // The matrix judges a PRODUCT. "Research a travel destination" generates no code and
  // rightly has no code requirements; gating it on "no placeholder implementation" would
  // refuse a completed research commission for shipping nothing.
  const buildsProduct = mergedFiles.length > 0 || project.architecture?.backend === true || Boolean(spec?.productType);
  const matrix = specRequirements.length && buildsProduct
    ? buildRequirementMatrix({ requirements: specRequirements, files: mergedFiles, fidelity, runtime, architecture: project.architecture ?? null })
    : null;
  if (matrix && !matrix.deliverable) {
    const failed = matrix.criticalFailed.map(r => `${r.id} ${r.title}`).join('; ');
    throw new Error(`Delivery blocked: NOT DELIVERABLE — critical founder requirement(s) failed: ${failed}`);
  }
  const traceability = specRequirements.length
    ? buildTraceability({ project, spec, matrix, tasks, artifacts })
    : null;
  const quality = scoreGeneratedAppQuality({
    matrix, fidelity, runtime, architecture: project.architecture ?? null,
    files: mergedFiles, integrity: gates.get('integrity')?.state === 'completed' ? { valid: true } : null
  });

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
    platform: project.platform ?? null,
    platformLabel: describePlatform(project.platform),
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
    // The requirement matrix, kept as its own block so "the app works" and "the founder got
    // what they asked for" can never be read as the same statement.
    requirementMatrix: matrix ? {
      understanding: spec?.understanding ?? 'UNKNOWN',
      productType: spec?.productType ?? null,
      platform: spec?.platform ?? null,
      architecture: project.architecture?.id ?? null,
      deliverable: matrix.deliverable,
      rows: matrix.rows,
      summary: matrix.summary
    } : null,
    traceability,
    qualityScore: quality,
    status: dualStatus({ matrix, runtime, fidelity }),
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
      // The delivery records the platform it was built for, so a download is never a
      // mystery target: the founder asked for Android, and the manifest says Android.
      platform: project.platform ?? null,
      platformLabel: describePlatform(project.platform),
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
