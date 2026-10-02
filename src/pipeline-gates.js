import { registerExecutor } from './executor-registry.js';
import { store } from './store.js';
import { addTaskToProject } from './projects.js';
import { selectAgents, seedAgents } from './agents.js';
import { listProjectArtifacts } from './artifacts.js';
import { analyzeGeneratedApp, evaluateRequirementCoverage } from './generated-app-quality.js';
import { buildRequirementMatrix, scoreGeneratedAppQuality, dualStatus } from './requirement-matrix.js';
import { hasBackendEntryPoint, describeRuntimeAcceptance, runtimeExecutorConfigured } from './production-runtime.js';
import { runtimeAcceptanceFor, ensureRuntimeAcceptance } from './runtime-evidence.js';
import { DEPLOYMENT_STATUS, normalizeDeployment, runtimeDeploymentKind } from './generated-deployment.js';
import { now } from './core.js';

// Build → Tests → Requirements → Security → Functional Fidelity → Production Runtime → QA
// → Integrity → Final Delivery. The two extra gates exist so that "the app works" and "the
// app was actually RUN against a real database and a real user journey" are separate,
// mandatory steps between Security and QA — not a check hidden inside QA that a completed
// project could carry a warning for.
export const GATES = ['build','test','requirements','security','functional-fidelity','production-runtime','qa','integrity'];
export const CAP = {
  build:['testing','verification'], test:['testing','verification'], requirements:['verification'],
  // Security used to require ['security','verification']. No single agent holds both —
  // the Security Agent has security, the QA Agent has verification — so the security gate
  // was unassignable by design, and qa + integrity (which chain behind it) blocked too.
  security:['security'],
  // Both new gates are verification work: they read evidence and judge it. `verification`
  // alone is deliberate — requiring two capabilities no single agent holds is exactly the
  // unassignable-gate defect the security entry above documents.
  'functional-fidelity':['verification'], 'production-runtime':['verification'],
  qa:['testing','verification'], integrity:['verification']
};

function artifacts(projectId){ return listProjectArtifacts(projectId).filter(a => a.type === 'code-workspace' || a.type === 'final-delivery'); }
function codeArtifacts(projectId){ return listProjectArtifacts(projectId).filter(a => a.type === 'code-workspace'); }
function validFiles(projectId){
  return codeArtifacts(projectId).some(a => Array.isArray(a.content?.files) && a.content.files.length > 0 &&
    a.content.files.every(f => f && typeof f.path === 'string' && f.path.trim() && typeof f.content === 'string'));
}
function latestCodeArtifact(projectId){
  return codeArtifacts(projectId).sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')))[0]??null;
}
// A project's code is the UNION of its code-workspace artifacts: the frontend agent ships
// www/, the backend agent ships server.js, the database agent ships the schema. Fidelity
// judged against only the newest artifact missed what the other agents wired in — the
// exact gap that let a persistence-free app pass because the persistence lived in an
// artifact the gate never looked at.
function mergedCodeArtifacts(projectId){
  const seen=new Set(); const merged=[];
  for(const a of codeArtifacts(projectId)){
    for(const f of (a.content?.files??[])){
      if(!f||typeof f.path!=='string'||typeof f.content!=='string'||seen.has(f.path)) continue;
      seen.add(f.path); merged.push({path:f.path,content:f.content});
    }
  }
  return merged;
}
function gateTasksOf(tasks){ return tasks.filter(t => t.pipelineGate); }
function syncTask(list, updated){ const index = list.findIndex(t => t.id === updated.id); if(index >= 0) list[index] = updated; else list.push(updated); return updated; }
function gateAgent(type){ seedAgents(); return selectAgents(CAP[type] ?? ['verification'], null, { requireAllTools:false })[0] ?? null; }

// tasksArg lets the scheduler hand over its per-project task index: re-scanning the whole
// task table for every project on every tick was a large slice of the free plan's 10 ms
// CPU budget per cron trigger. When provided, created/converted tasks are synced back
// into that index so the caller's view stays authoritative without another full scan.
export function ensureProjectPipeline(projectId, tasksArg){
  const project = store.get('projects', projectId); if(!project) return null;
  const tasks = Array.isArray(tasksArg) ? tasksArg : store.list('tasks').filter(t => t.projectId === projectId);
  const finalQa = tasks.find(t => t.finalProjectVerification);
  if(!finalQa) return null;
  // Historical duplicates must be collapsed, not just avoided. Before gates were created
  // once, concurrent ticks left several rows with the same gateType; each chain pointed at
  // the next chain's rows, so the leftovers could never settle and the project stayed
  // "active" forever. One canonical row per gate survives: a completed one wins (its work
  // is done), otherwise the newest. The rest are cancelled and every dependent is rewired
  // to the survivor, so the chain has exactly one path to the delivery gate.
  const byGateType = new Map();
  for(const gate of gateTasksOf(tasks)){
    if(!gate.gateType) continue;
    const list = byGateType.get(gate.gateType) ?? [];
    list.push(gate);
    byGateType.set(gate.gateType, list);
  }
  const collapsed = [];
  for(const [type, list] of byGateType){
    if(list.length < 2) continue;
    const rank = t => (t.state === 'completed' ? 0 : t.state === 'cancelled' ? 1 : 2);
    const ordered = list.slice().sort((a, b) => rank(a) - rank(b)
      || String(b.createdAt ?? b.updatedAt ?? '').localeCompare(String(a.createdAt ?? a.updatedAt ?? '')));
    const [keep, ...rest] = ordered;
    byGateType.set(type, [keep]);
    for(const duplicate of rest){
      for(const task of tasks){
        const deps = task.dependsOn ?? [];
        if(!deps.includes(duplicate.id)) continue;
        const rewired = [...new Set(deps.map(dep => (dep === duplicate.id ? keep.id : dep)))];
        syncTask(tasks, store.put('tasks',{...task,dependsOn:rewired,id:task.id}));
      }
      syncTask(tasks, store.put('tasks',{
        ...duplicate, state:'cancelled', collapsedDuplicate:true,
        blockedReason:`Duplicate ${type} gate collapsed into ${keep.id}`, id:duplicate.id
      }));
      collapsed.push(duplicate.id);
    }
  }
  const existing = new Map([...byGateType].map(([type, list]) => [type, list[0]]));
  // Two scheduler ticks can run concurrently — the cron tick and an explicit trigger such
  // as a founder command or an approval — each holding a task list read at a slightly
  // different moment. Before creating a gate, re-read the project's gate rows so a
  // concurrent create is recognised instead of duplicated (production showed three
  // "Pipeline gate: build" tasks for one project, which kept the chain from settling).
  let freshGates = null;
  const beforeCreate = () => {
    if (!freshGates) {
      try { freshGates = store.list('tasks').filter(t => t.projectId === projectId && t.pipelineGate && t.gateType); }
      catch (_) { freshGates = []; }
    }
    return freshGates;
  };
  const generation = tasks.filter(t => !t.pipelineGate && !t.finalProjectVerification);
  let previousIds = generation.map(t => t.id);
  const created = [];

  for(const type of GATES){
    const gateSequence = 900 + GATES.indexOf(type);
    if(type === 'qa'){
      const qa = syncTask(tasks, store.put('tasks', {
        ...finalQa, pipelineGate:true, gateType:'qa',
        title:'Final project QA gate', executor:'internal.pipeline-gate',
        requiredCapabilities:CAP.qa, acceptance:[{field:'type',equals:'plan'}],
        dependsOn:[...previousIds], sequence:gateSequence, id:finalQa.id
      }));
      existing.set('qa',qa); previousIds=[qa.id]; continue;
    }
    if(existing.has(type)){
      const existingGate = existing.get(type);
      if(existingGate.sequence !== gateSequence) existing.set(type, syncTask(tasks, store.put('tasks',{...existingGate,sequence:gateSequence,id:existingGate.id})));
      previousIds=[existing.get(type).id]; continue;
    }
    const racedLive=beforeCreate().filter(t => t.gateType === type && t.state !== 'cancelled');
    const raced=racedLive.find(t => t.state === 'completed') ?? racedLive[0];
    if(raced){ existing.set(type, syncTask(tasks, raced)); previousIds=[raced.id]; continue; }
    const agent=gateAgent(type);
    const task=addTaskToProject(projectId, {
      // Deterministic id: even if two ticks pass the re-read at the same instant, the
      // second write upserts this same row instead of adding a duplicate gate.
      id:`task_gate_${projectId}_${type}`,
      title:`Pipeline gate: ${type}`,
      description:`Mandatory ${type} gate for project ${projectId}`,
      requiredCapabilities:CAP[type], risk:'low',
      acceptance:[{field:'type',equals:'plan'}],
      assignedAgentId:agent?.id??null, toolNames:[], requiredTools:[],
      executor:'internal.pipeline-gate', maxAttempts:2, sequence:gateSequence,
      dependsOn:[...previousIds], pipelineGate:true, gateType:type
    });
    if(task){ created.push(task); tasks.push(task); previousIds=[task.id]; existing.set(type,task); }
  }

  const qa=existing.get('qa'), integrity=existing.get('integrity');
  if(integrity && qa && !integrity.dependsOn?.includes(qa.id))
    syncTask(tasks, store.put('tasks',{...integrity,dependsOn:[qa.id],id:integrity.id}));
  return {created,collapsed,gates:gateTasksOf(tasks).map(t=>({id:t.id,type:t.gateType,state:t.state,dependsOn:t.dependsOn??[]}))};
}

function prior(projectId,type){ return store.list('tasks').find(t => t.projectId === projectId && t.pipelineGate && t.gateType === type); }

function parsePackage(files){
  const pkg=files.find(f=>f.path==='package.json');
  if(!pkg) return {exists:false,valid:false,buildScript:false,testScript:false};
  try{
    const value=JSON.parse(pkg.content);
    return {exists:true,valid:true,buildScript:typeof value?.scripts?.build==='string'&&value.scripts.build.trim().length>0,
      testScript:typeof value?.scripts?.test==='string'&&value.scripts.test.trim().length>0};
  }catch(_){ return {exists:true,valid:false,buildScript:false,testScript:false}; }
}

// One place that answers "does every requirement have evidence?", so the functional fidelity
// and QA gates cannot drift apart on it.
function evidenceComplete(pid,merged,matrix,project){
  if(matrix) return matrix.rows.every(r=>r.status!=='FAIL'&&r.status!=='BLOCKED');
  const coverage=evaluateRequirementCoverage(project?.requirements??[],merged);
  return coverage.filter(c=>c.status==='MISSING').length===0;
}
function evidenceGap(pid,merged,matrix,project){
  if(matrix){
    const bad=matrix.rows.filter(r=>r.status==='FAIL'||r.status==='BLOCKED');
    return bad.length?('Requirement(s) without evidence: '+bad.slice(0,6).map(r=>`${r.id} ${r.title} (${r.failureReason??r.basis})`).join(' | ')):'';
  }
  const unmet=evaluateRequirementCoverage(project?.requirements??[],merged).filter(c=>c.status==='MISSING');
  return unmet.length?('No source evidence for: '+unmet.slice(0,5).map(c=>c.requirement).join(' | ')):'';
}

function qualityProblems(code){
  const problems=[];
  for(const a of code){
    if(a.metadata?.stub===true || a.metadata?.placeholder===true) problems.push(`${a.id}:placeholder-artifact`);
    for(const f of (a.content?.files??[])){
      if(typeof f?.content!=='string') continue;
      if(/AI generation unavailable|app placeholder|TODO\b|FIXME\b|coming soon/i.test(f.content))
        problems.push(`${a.id}:${f.path}:placeholder-marker`);
    }
  }
  return problems;
}

function securityProblems(code){
  return code.flatMap(a=>(a.content?.files??[]).map(f=>({path:f.path,content:f.content})))
    .filter(f=>/\beval\s*\(|new\s+Function\s*\(|child_process|execSync\s*\(|rm\s+-rf|curl\s+[^\n|]*\|\s*(sh|bash)|-----BEGIN (RSA|PRIVATE) KEY-----/i.test(f.content));
}

async function sha256(textValue){
  const bytes=new TextEncoder().encode(String(textValue??''));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function gateResult(task,gateEnv=null){
  const pid=task.projectId, type=task.gateType, arts=artifacts(pid), code=codeArtifacts(pid);
  let passed=true, checks=[];
  const check=(name,value,reason)=>{ checks.push({name,passed:Boolean(value),...(value?{}:{reason})}); if(!value) passed=false; };
  // The founder asked for per-requirement statuses (IMPLEMENTED / INTEGRATED /
  // RUNTIME VERIFIED / FAILED / BLOCKED). The Worker cannot execute the generated app,
  // so its honest statuses are keyword evidence ('IMPLEMENTED') or the absence of it
  // ('FAILED'); the Node verifier upgrades INTEGRATED/RUNTIME VERIFIED and CI publishes
  // the full matrix. BLOCKED covers generation infrastructure that never ran.
  const requirementStatuses=()=>{
    const project=store.get('projects',pid);
    const requirements=Array.isArray(project?.requirements)?project.requirements:[];
    if(!requirements.length) return [];
    const coverage=evaluateRequirementCoverage(requirements,mergedCodeArtifacts(pid));
    return coverage.map(c=>({
      requirement:c.requirement,
      status:c.status==='IMPLEMENTED'?'IMPLEMENTED':'FAILED',
      matched:c.matched,
      evidence:'static fidelity gate (executed source: HTML/JS/CSS)'
    }));
  };

  // The structured specification's own matrix. Requirement ids, criticality and per-row
  // evidence come from the founder's command, not from plan prose, so the gate reports on
  // exactly what was asked for.
  // The functional fidelity of the MERGED code, computed once per gate result. REQ-009 ("No
  // stub, mock or fake-success implementation") is evidenced by this gate, not by a word in
  // the source, so the matrix must be handed the verdict — without it every spec-driven
  // project reported a critical requirement FAIL and only escaped notice because a gate's
  // `passed:false` was never enforced.
  let fidelityCache=null;
  const fidelityFor=()=>{
    if(fidelityCache) return fidelityCache;
    const project=store.get('projects',pid);
    fidelityCache=analyzeGeneratedApp(mergedCodeArtifacts(pid),{objective:project?.objective??'',requirements:project?.requirements??[]});
    return fidelityCache;
  };

  // The structured specification's own matrix. Requirement ids, criticality and per-row
  // evidence come from the founder's command, not from plan prose, so the gate reports on
  // exactly what was asked for. Runtime enforcement is the production-runtime gate's job:
  // this matrix judges the source, that gate judges the executed run.
  const specMatrix=()=>{
    const project=store.get('projects',pid);
    const spec=project?.requirementSpec;
    if(!spec?.requirements?.length) return null;
    const files=mergedCodeArtifacts(pid);
    if(!files.length) return null;
    return buildRequirementMatrix({
      requirements:spec.requirements, files, architecture:project?.architecture??null,
      runtime:project?.runtimeEvidence??null, fidelity:fidelityFor()
    });
  };

  // The production runtime acceptance the pipeline judges: the stored run, judged by the
  // engine against the architecture, the requirements and the available credentials.
  // `env` is needed for one thing only — whether an external service's credential binding is
  // present. Its value is never read and never recorded.
  const runtimeContext=()=>{
    const project=store.get('projects',pid);
    const files=mergedCodeArtifacts(pid);
    const externalServices=project?.requirementSpec?.externalServices??[];
    const credentials=Object.fromEntries(
      externalServices.map(s=>[s.envVar,Boolean(gateEnv?.[s.envVar]??(project?.runtimeCredentials??{})[s.envVar])])
    );
    const {acceptance,report}=runtimeAcceptanceFor({
      project, files, hasBackend:hasBackendEntryPoint(files), credentials, env:gateEnv,
      // Same fidelity verdict the functional-fidelity gate used: without it the no-false-PASS
      // rules would judge a placeholder app as clean here while that gate refused it.
      fidelity:files.length?analyzeGeneratedApp(files,{objective:project?.objective??'',requirements:project?.requirements??[]}):null
    });
    return {
      project, files, acceptance, report, credentials,
      deployment:normalizeDeployment(project?.runtimeDeployment??null),
      // The same rule the engine uses to decide what this project owes a deployment, so the
      // gate cannot demand a Worker URL from a browser-only app (or skip one for a backend).
      deploymentRequired:runtimeDeploymentKind({architecture:project?.architecture??null,platform:project?.platform??null})!=='browser',
      runtimeRequired:project?.architecture?.backend===true||hasBackendEntryPoint(files),
      status:describeRuntimeAcceptance(report)
    };
  };

  if(type==='build'){
    const latest=latestCodeArtifact(pid), files=latest?.content?.files??[], pkg=parsePackage(files);
    check('generated_artifact_present',arts.length>0,'No generated artifact exists');
    check('source_files_valid',validFiles(pid),'Generated source files are missing or invalid');
    check('package_json_valid',!pkg.exists||pkg.valid,'package.json is invalid JSON');
    check('placeholder_free',qualityProblems(code).length===0,'Placeholder/stub markers remain in generated code');
    check('build_contract_present',!pkg.valid||pkg.buildScript||files.some(f=>f.path==='www/index.html'),'No build contract or static web entry point was found');
  } else if(type==='test'){
    const b=prior(pid,'build'), latest=latestCodeArtifact(pid), files=latest?.content?.files??[], pkg=parsePackage(files);
    check('build_gate_passed',b?.state==='completed','Build gate has not passed');
    check('artifact_structure_test',validFiles(pid),'Artifact structure test failed');
    check('test_contract_present',Boolean(pkg.testScript||latest?.content?.tests?.length||files.some(f=>f.path==='www/index.html'||f.path==='README.md')), 'No test/static validation contract was found');  }else if(type==='requirements'){
    const t=prior(pid,'test'), p=store.get('projects',pid);
    check('test_gate_passed',t?.state==='completed','Test gate has not passed');
    check('objective_present',Boolean(String(p?.objective??'').trim()),'Project objective is missing');
    check('requirements_recorded',Array.isArray(p?.requirements)&&p.requirements.length>0,'Project requirements are missing');
    // A command that was never understood cannot be verified. The gate says so here rather
    // than letting the QA gate discover it and report a generic failure.
    const spec=p?.requirementSpec;
    check('specification_extracted',!spec||spec.understanding!=='BLOCKED',spec?.understanding==='BLOCKED'?'The founder command could not be understood: no product or feature was identified':'');
    check('architecture_selected',!spec||Boolean(p?.architecture?.id),'No architecture was selected for this specification');
    const matrix=specMatrix();
    check('requirement_matrix_built',!spec?.requirements?.length||Boolean(matrix),'The requirement matrix could not be built');
    check('no_critical_requirement_failed',!matrix||matrix.deliverable,matrix?.criticalFailed?.length?('Critical requirement(s) failed: '+matrix.criticalFailed.map(r=>r.id+' '+r.title).join('; ')):'');
  } else if(type==='security'){
    const r=prior(pid,'requirements'), risky=securityProblems(code);
    check('requirements_gate_passed',r?.state==='completed','Requirement verification has not passed');
    check('unsafe_patterns_absent',risky.length===0,risky.length?`Unsafe pattern found in: ${risky.map(x=>x.path).slice(0,5).join(', ')}`:'Unsafe patterns detected');
    check('placeholder_free',qualityProblems(code).length===0,'Placeholder/stub markers remain in generated code');
  } else if(type==='functional-fidelity'){
    // "Code exists" is not "the feature works". This is the static half of that claim, and it
    // is the gate the Production Runtime gate chains behind, so a demo can never reach the
    // runtime stage with a message that a warning was ignored.
    const s=prior(pid,'security'), project=store.get('projects',pid), merged=mergedCodeArtifacts(pid);
    check('security_gate_passed',s?.state==='completed','Security gate has not passed');
    const fidelity=fidelityFor();
    check('functional_fidelity',fidelity.passed,fidelity.passed?'Generated app passed the static functional fidelity gate':('Not a working app: '+fidelity.violations.map(v=>v.code).join(', ')));
    // Evidence is judged once, on the founder's own requirement set. A spec-driven project is
    // judged by its structured matrix (REQ ids + evidence vocabulary); only a legacy project
    // with no specification falls back to keyword coverage of the plan's prose lines. Judging
    // the prose lines as well made process statements ("Testing plan") a MISSING requirement
    // for every project, which is the kind of permanent false failure that gets gates ignored.
    const matrix=specMatrix();
    check('requirement_evidence',evidenceComplete(pid,merged,matrix,project),
      evidenceGap(pid,merged,matrix,project));
    check('no_critical_requirement_failed',!matrix||matrix.deliverable,matrix?.criticalFailed?.length?('Critical requirement(s) failed: '+matrix.criticalFailed.map(r=>r.id+' '+r.title).join(', ')):'');
  } else if(type==='production-runtime'){
    // Point 8. The mandatory gate: the generated application must have been RUN against a
    // real database and a real user journey, and every critical requirement must have a
    // passing runtime test behind it. Missing evidence BLOCKS — it is never a warning, and
    // QA, Integrity and Final Delivery all chain behind this gate.
    const f=prior(pid,'functional-fidelity');
    // Produce the evidence first, then judge it. The Worker cannot execute generated code, so
    // MAULI_RUNTIME_EXECUTOR names the Node/HTTP runner that does; with no runner configured
    // this is an honest no-op and the checks below report BLOCKED with the exact reason.
    await ensureRuntimeAcceptance(pid,gateEnv);
    const ctx=runtimeContext();
    check('functional_fidelity_gate_passed',f?.state==='completed'&&(f?.result?.passed??true)!==false,'The functional fidelity gate has not passed');
    // ── deployment, before anything can be called runtime evidence ──────────
    // A backend product that was never deployed has nothing to run against. This check is
    // explicit so the gate names WHICH link is missing rather than reporting a generic
    // "no acceptance run", and so a FAILED deploy carries its category and a safe message.
    if(ctx.deploymentRequired){
      const dep=ctx.deployment;
      check('generated_project_deployed',dep.status!==DEPLOYMENT_STATUS.FAILED,
        `The generated project failed to deploy (${dep.errorCategory??'unknown'}): ${dep.errorMessage??'see the deployment record'}`);
      check('deployment_url_captured',dep.status===DEPLOYMENT_STATUS.DEPLOYED&&Boolean(dep.url),
        dep.errorMessage?`Deployment failed: ${dep.errorMessage}`:'The generated project has not been deployed, so there is no URL to run real HTTP requests against');
      check('deployment_identity_matches_project',!dep.url||Boolean(dep.projectId===pid||ctx.report.status!=='passed'),
        `The deployment URL ${dep.url??''} is not recorded as belonging to this project`);
      check('runtime_executor_available',!runtimeExecutorConfigured(gateEnv)&&ctx.runtimeRequired?false:true,
        'MAULI_RUNTIME_EXECUTOR is not configured, so no real HTTP runtime acceptance can be produced for this deployed backend project');
    }
    if(ctx.runtimeRequired){
      check('runtime_acceptance_recorded',Boolean(ctx.acceptance),'No production runtime acceptance run has been recorded for this project');
      check('production_runtime_passed',ctx.report.status==='passed',ctx.report.blockingReason??'Production runtime acceptance did not pass');
      check('critical_requirements_runtime_verified',ctx.report.criticalFailed.length===0,ctx.report.criticalFailed.length?('Critical requirement(s) without passing runtime evidence: '+ctx.report.criticalFailed.join(', ')):'');
      check('no_false_pass',ctx.report.noFalsePass.length===0,ctx.report.noFalsePass.length?('No false PASS: '+ctx.report.noFalsePass.map(v=>`${v.code} (${v.detail})`).join('; ')):'');
      check('external_dependencies_declared',ctx.report.dependenciesRequired.length===0,ctx.report.dependenciesRequired.map(d=>d.reason).join('; '));
      // Point 4: production acceptance for a deployed backend is real network HTTP. A run
      // that executed the source in-process is a local fixture and never counts.
      check('real_http_acceptance_run',ctx.acceptance?.transport==='deployed-http',
        `the acceptance run used the "${ctx.acceptance?.transport??'none'}" transport; a deployed backend project must be tested over real HTTP against ${ctx.deployment.url??'its deployed URL'}`);
    } else {
      // Browser-only / local architecture (point 9). There is no server to deploy and no D1 to
      // round-trip, so the bar is the one this architecture actually owes — and it is not
      // lowered: the UI must have bound controls that change real state, records must persist
      // and read back, and every critical requirement must have evidence. When a recorded
      // runtime acceptance run exists (the Node/CI executor produces one for local apps too),
      // it is used and must have passed; otherwise the executed-source evidence is the basis,
      // and the gate says so instead of implying a run happened.
      const merged=mergedCodeArtifacts(pid);
      const fid=analyzeGeneratedApp(merged,{objective:ctx.project?.objective??'',requirements:ctx.project?.requirements??[]});
      const interaction=fid.stats?.interactionCount??0;
      check('local_ui_interaction',interaction>0,'The generated UI has no bound control that changes real state');
      const spec=ctx.project?.requirementSpec??null;
      const needsPersistence=((spec?.dataRequirements??[]).length>0)||(spec?.features??[]).some(f=>['create','read','update','delete'].includes(f.key));
      check('local_persistence',!needsPersistence||fid.stats?.hasPersistence===true,'The product stores records but the delivered code never persists them or reads them back');
      const localMatrix=specMatrix();
      check('critical_requirements_have_evidence',!localMatrix||localMatrix.deliverable,localMatrix?.criticalFailed?.length?('Critical requirement(s) without evidence: '+localMatrix.criticalFailed.map(r=>`${r.id} ${r.title}`).join('; ')):'');
      check('no_false_pass',ctx.report.noFalsePass.length===0,ctx.report.noFalsePass.length?('No false PASS: '+ctx.report.noFalsePass.map(v=>`${v.code} (${v.detail})`).join('; ')):'');
      if(ctx.acceptance) check('runtime_acceptance_passed',ctx.report.status==='passed',ctx.report.blockingReason??'The recorded runtime acceptance did not pass');
    }
    // A local application has no run to point at, so the gate reports the basis it actually
    // judged on rather than reusing a verdict that would read as "BLOCKED" while passing.
    const staticBasis=!ctx.runtimeRequired&&!ctx.acceptance;
    const runtimeAcceptance=staticBasis
      ?{status:passed?'passed':'blocked',label:passed?'PASS':'BLOCKED',environment:ctx.report.environment,
        basis:'executed-source fidelity + requirement coverage (local architecture: no server to deploy)',
        criticalPassed:ctx.report.criticalPassed?.length??0,criticalFailed:0,missingTests:[],failedTests:[],
        blockingReason:passed?null:(checks.find(c=>!c.passed)?.reason??null)}
      :ctx.status;
    return {
      type:'plan', taskId:task.id, gate:type, passed, checks,
      runtimeAcceptance,
      runtimeStatus:runtimeAcceptance.status,
      // How the runtime verdict was reached. Never left implicit: "static evidence" and
      // "executed acceptance run" are different claims, and the founder can tell them apart.
      runtimeBasis:ctx.acceptance?'recorded production runtime acceptance run':(ctx.runtimeRequired?'no runtime acceptance run recorded':'executed-source fidelity + requirement coverage (this architecture owes no server to deploy)'),
      blockingReason:passed?null:(ctx.report.blockingReason??checks.find(c=>!c.passed)?.reason??null),
      requirementRuntimeEvidence:ctx.report.requirements,
      requirementStatuses:requirementStatuses(),
      verifiedAt:now(),
      summary:passed?'production-runtime gate passed.':`production-runtime gate BLOCKED: ${ctx.report.blockingReason??checks.find(c=>!c.passed)?.reason??'see checks'}`
    };
  } else if(type==='qa'){
    const s=prior(pid,'functional-fidelity'), pr=prior(pid,'production-runtime');
    const generation=store.list('tasks').filter(t=>t.projectId===pid&&!t.pipelineGate&&!t.finalProjectVerification);
    check('security_gate_passed',prior(pid,'security')?.state==='completed','Security gate has not passed');
    // A gate row can be 'completed' while its own verdict is `passed:false` — verification
    // checks the execution, not the verdict. Reading only the state would let QA pass behind
    // a refused functional-fidelity or production-runtime gate.
    const gateRefused=g=>g?.state!=='completed'||(g?.result?.passed??true)===false;
    check('functional_fidelity_gate_passed',!gateRefused(s),s?.result?.passed===false?('Functional fidelity gate refused the app: '+(s?.result?.summary??s?.result?.blockingReason??'see gate checks')):'The functional fidelity gate has not passed');
    // Point 8: a failed/blocked Production Runtime gate must keep QA from passing. The chain
    // already prevents QA from starting, but the check is explicit so a completed QA row can
    // never be read as "runtime was fine".
    check('production_runtime_gate_passed',!gateRefused(pr),pr?.result?.passed===false?('Production Runtime gate BLOCKED: '+(pr?.result?.blockingReason??pr?.result?.summary??'see gate checks')):(pr?.result?.blockingReason??'The production runtime gate has not passed'));
    check('all_project_tasks_complete',generation.every(t=>t.state==='completed'),'One or more generation tasks are incomplete');
    check('artifacts_present',arts.length>0,'No project artifact available for QA');
    check('artifact_files_valid',validFiles(pid),'Artifact files failed QA structure checks');
    check('placeholder_free',qualityProblems(code).length===0,'QA found placeholder/stub markers');
    // "Code exists" is not "the feature works". A generated app that is only markup, a
    // demo, a placeholder or a dead button must never reach delivery. The runtime proof is
    // produced by scripts/verify-generated-app.mjs; this is the static gate the Worker can
    // always run. Fidelity and coverage judge the MERGED code of every agent, and the
    // per-requirement statuses are recorded as gate evidence.
    const project=store.get('projects',pid);
    const merged=mergedCodeArtifacts(pid);
    const fidelity=fidelityFor();
    check('functional_fidelity',fidelity.passed,fidelity.passed?'Generated app passed functional fidelity checks':('Not a working app: '+fidelity.violations.map(v=>v.code).join(', ')));
    // Same single judgement as the functional fidelity gate — see evidenceComplete().
    const matrix=specMatrix();
    check('requirement_evidence',evidenceComplete(pid,merged,matrix,project),
      evidenceGap(pid,merged,matrix,project));
    const quality=scoreGeneratedAppQuality({matrix,fidelity,architecture:project?.architecture??null,files:merged,integrity:{valid:false}});
    const status=dualStatus({matrix,runtime:project?.runtimeEvidence??null,fidelity});
    check('no_critical_requirement_failed',!matrix||matrix.deliverable,matrix?.criticalFailed?.length?('Critical requirement(s) failed: '+matrix.criticalFailed.map(r=>r.id).join(', ')):'');
  } else if(type==='integrity'){
    const q=prior(pid,'qa'), ids=arts.map(a=>a.id);
    const files=code.flatMap(a=>(a.content?.files??[]).map(f=>({artifactId:a.id,path:f.path,content:f.content})));
    const manifest=[];
    for(const f of files) manifest.push({artifactId:f.artifactId,path:f.path,sha256:await sha256(f.content),bytes:new TextEncoder().encode(f.content).byteLength});
    check('qa_gate_passed',q?.state==='completed','QA gate has not passed');
    check('artifact_ids_unique',new Set(ids).size===ids.length,'Duplicate artifact IDs detected');
    check('artifact_metadata_valid',arts.every(a=>a.projectId===pid&&a.type&&a.createdAt),'Artifact metadata is incomplete');
    check('file_manifest_valid',manifest.length>0&&manifest.every(x=>x.path&&/^[a-f0-9]{64}$/.test(x.sha256)),'Artifact file manifest could not be generated');
    return {type:'plan',taskId:task.id,gate:type,passed,checks,requirementStatuses:requirementStatuses(),verifiedAt:now(),manifest,summary:passed?`${type} gate passed.`:`${type} gate failed.`};
  }
  // Requirement-matrix evidence rides on every gate result so the project's QA record always
  // carries REQ ids, the quality score and the two independent statuses.
  return {
    type:'plan', taskId:task.id, gate:type, passed, checks,
    requirementStatuses:requirementStatuses(),
    requirementMatrix:typeof matrix!=='undefined'&&matrix?{rows:matrix.rows,deliverable:matrix.deliverable,summary:matrix.summary}:null,
    qualityScore:typeof quality!=='undefined'&&quality?quality:null,
    status:typeof status!=='undefined'&&status?status:null,
    verifiedAt:now(),
    summary:passed?`${type} gate passed.`:`${type} gate failed.`
  };
}

registerExecutor('internal.pipeline-gate', async ({task,env}) => gateResult(task,env), {
  description:'Mandatory MAULI delivery pipeline gate with build/test contracts, security checks, functional fidelity, production runtime acceptance, QA and artifact integrity evidence',
  scope:'internal',
  risk:'low'
});
