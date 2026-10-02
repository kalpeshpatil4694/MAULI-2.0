import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// THE A–L SCENARIO MATRIX.
//
// Every founder command produces a project, and every project must be judged on what it
// actually owes. These tests pin the EXPECTED VERDICT for each shape of project:
//
//   A Backend + D1 · B Backend + Auth · C Backend + external API · D Backend + realtime
//   E Browser-only · F Runtime executor unavailable · G Deployment failure
//   H Wrong deployment URL · I Wrong project identity · J Critical requirement without evidence
//   K Runtime failure → repair → redeploy → retest · L Successful full delivery
//
// A scenario's verdict is only meaningful if it is the SAME verdict the pipeline gate, the
// delivery guard and the dashboard read — so these tests judge through the real engine and
// the real store, not a stand-in.
// ---------------------------------------------------------------------------

import { store } from '../src/store.js';
import { createProject } from '../src/projects.js';
import { registerArtifact } from '../src/artifacts.js';
import { buildFinalDelivery } from '../src/delivery.js';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import {
  evaluateRuntimeAcceptance, runtimeObligations, RUNTIME_STATUS, hasBackendEntryPoint,
  requiredTestsForRequirement
} from '../src/production-runtime.js';
import {
  normalizeDeployment, assertRuntimeIdentity, categorizeDeploymentError,
  isGeneratedAppUrl, DEPLOYMENT_STATUS, runtimeDeploymentKind
} from '../src/generated-deployment.js';
import {
  recordRuntimeAcceptance, recordGeneratedDeployment, runtimeAcceptanceSummary,
  projectsNeedingRuntimeAcceptance, ensureGeneratedDeployment
} from '../src/runtime-evidence.js';
import { repairUntilRuntimeAcceptance } from '../scripts/repair-loop.mjs';
import { stageProject } from '../scripts/deploy-executor.mjs';
import { mkdtemp, readFile as readFileFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONTROL_PLANE = 'https://mauli-2-0.kalpeshpatil4694.workers.dev';
const EXECUTOR_ENV = { MAULI_RUNTIME_EXECUTOR: 'https://runner.example/accept', MAULI_BASE: CONTROL_PLANE };
const BACKEND_FILES = [
  { path: 'worker/index.js', content: 'export default { async fetch(request) { const url = new URL(request.url); return new Response(JSON.stringify({ ok: true, path: url.pathname }), { headers: { "content-type": "application/json" } }); } };' },
  { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Orders</h1><script src="app.js"></script></body></html>' },
  { path: 'www/app.js', content: 'document.addEventListener("DOMContentLoaded",function(){fetch("/api/orders").then(function(r){return r.json();});});' }
];

const specFor = (command) => extractRequirementSpec({ command, platform: 'web' });

/**
 * A run in which every required test was really observed, over real HTTP.
 *
 * The flags here are the ones the gate reads to tell a real deployed observation from a
 * fixture: `deployed:true` on the journey and the live proof, `called:true` on an external
 * service, and per-probe core-feature rows. A fixture that omits them is refused — which is
 * the point: a run that cannot say WHERE it observed something cannot claim production.
 */
function greenRun(spec, architecture, { projectId, url, artifactId, overrides = {} } = {}) {
  const obligations = runtimeObligations({ architecture, spec, files: BACKEND_FILES, hasBackend: true });
  const tests = {};
  for (const id of obligations.requiredTests) {
    tests[id] = {
      status: 'PASS', detail: `${id} observed against the deployed application`,
      request: `GET /api/${id}`, responseStatus: 200, persisted: ['create', 'update', 'delete', 'refresh'].includes(id),
      // Network-observed, not executed in the harness that produced this run.
      deployed: true, called: true
    };
  }
  for (const [id, test] of Object.entries(overrides)) tests[id] = test;
  const coreFeature = obligations.coreFeature
    ? {
      label: obligations.coreFeature.label,
      featureKeys: obligations.coreFeature.featureKeys,
      basis: obligations.coreFeature.basis,
      status: 'PASS',
      probes: obligations.coreFeature.probes.map((p) => ({
        probeId: p.id, status: 'PASS', executable: p.executable, detail: `${p.label} — observed over real HTTP`,
        request: `POST /api/orders`, responseStatus: 201, persisted: true, requirementIds: []
      }))
    }
    : null;
  return {
    status: 'passed', transport: 'deployed-http', projectId, artifactId,
    deployment: { url, deploymentId: 'dep_1', deployedAt: '2026-10-02T00:00:00.000Z', environment: 'production' },
    environment: `deployed worker at ${url} + D1`, testedAt: '2026-10-02T00:00:00.000Z',
    tests, failures: [], evidence: [], rowsInDb: 4, coreFeature
  };
}

/** Build a real project: spec, architecture, generated code, and a deployment record. */
function projectWithDeployment(name, command, { url = 'https://orders-app.mauli.generated.workers.dev', deploy = true } = {}) {
  const spec = specFor(command);
  const architecture = selectArchitecture(spec);
  const project = createProject({ name, objective: command, founderCommand: command, requirements: ['orders'], requirementSpec: spec, architecture });
  const artifact = registerArtifact({ projectId: project.id, taskId: null, type: 'code-workspace', content: { files: BACKEND_FILES } });
  if (deploy) {
    recordGeneratedDeployment(project.id, {
      status: 'DEPLOYED', url, deploymentId: 'dep_1', deployedAt: '2026-10-02T00:00:00.000Z',
      environment: 'production', artifactId: artifact.id
    });
  }
  return { project: store.get('projects', project.id), artifact, spec, architecture, url };
}

function verdict(project, { env = EXECUTOR_ENV, acceptance = null } = {}) {
  return runtimeAcceptanceSummary(project, { env });
}

// =========================================================================== A
test('A — Backend + D1: a deployed product with real HTTP evidence PASSES', () => {
  const ctx = projectWithDeployment('A backend d1', 'Build a team coffee order app with staff login');
  recordRuntimeAcceptance(ctx.project.id, greenRun(ctx.spec, ctx.architecture, {
    projectId: ctx.project.id, url: ctx.url, artifactId: ctx.artifact.id
  }), {}, { env: EXECUTOR_ENV });

  const summary = verdict(store.get('projects', ctx.project.id));
  assert.equal(summary.label, 'PASS', summary.reason ?? '');
  assert.equal(summary.deploymentStatus, 'DEPLOYED');
  assert.equal(summary.runtimeUrl, ctx.url);
  assert.equal(summary.transport, 'deployed-http');
  assert.equal(summary.database, 'PASS', 'D1 persistence must be evidenced, not assumed');
  assert.equal(summary.finalDelivery, 'READY');
  assert.equal(summary.criticalFailed, 0);
});

// =========================================================================== B
test('B — Backend + Auth: the full auth journey is evidenced, and a broken one FAILS', () => {
  const ctx = projectWithDeployment('B backend auth', 'Build a coffee order app where staff register and log in');
  const obligations = runtimeObligations({ architecture: ctx.architecture, spec: ctx.spec, files: BACKEND_FILES, hasBackend: true });
  for (const id of ['unauthorized', 'register', 'duplicate-register', 'login', 'invalid-login', 'session', 'logout', 'post-logout']) {
    assert.ok(obligations.requiredTests.includes(id), `auth architecture must owe ${id}`);
  }

  const broken = greenRun(ctx.spec, ctx.architecture, {
    projectId: ctx.project.id, url: ctx.url, artifactId: ctx.artifact.id,
    overrides: { 'post-logout': { status: 'FAIL', detail: 'GET /api/orders after logout → 200, the session still worked', request: 'GET /api/orders (after logout)', responseStatus: 200 } }
  });
  const report = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture: ctx.architecture, spec: ctx.spec,
    requirements: ctx.spec.requirements, acceptance: broken,
    fidelity: { passed: true, violations: [] }, hasBackend: true,
    deployment: ctx.project.runtimeDeployment, projectId: ctx.project.id, executorConfigured: true
  });
  assert.equal(report.status, RUNTIME_STATUS.FAILED);
  assert.match(report.blockingReason, /post-logout|session still worked/i);

  const fixed = greenRun(ctx.spec, ctx.architecture, { projectId: ctx.project.id, url: ctx.url, artifactId: ctx.artifact.id });
  const ok = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture: ctx.architecture, spec: ctx.spec,
    requirements: ctx.spec.requirements, acceptance: fixed,
    fidelity: { passed: true, violations: [] }, hasBackend: true,
    deployment: ctx.project.runtimeDeployment, projectId: ctx.project.id, executorConfigured: true
  });
  assert.equal(ok.status, RUNTIME_STATUS.PASSED, ok.blockingReason ?? '');
  assert.equal(ok.authentication, 'PASS');
});

// =========================================================================== C
test('C — Backend + external API: no credential is DEPENDENCY_REQUIRED, never a fake success', () => {
  const spec = specFor('Build a weather dashboard that shows live forecasts for my city');
  const architecture = selectArchitecture(spec);
  assert.ok(spec.externalServices.length > 0);
  const report = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture, spec, requirements: spec.requirements,
    acceptance: null, fidelity: { passed: true, violations: [] }, hasBackend: true,
    deployment: normalizeDeployment({ status: 'DEPLOYED', url: 'https://weather-app.mauli.generated.workers.dev', projectId: null }),
    projectId: null, executorConfigured: true, credentials: {}
  });
  assert.equal(report.status, RUNTIME_STATUS.BLOCKED);
  assert.equal(report.blockingCode, 'dependency-required');
  assert.equal(report.external, 'DEPENDENCY_REQUIRED');
  assert.match(report.blockingReason, /credential/i);
});

// =========================================================================== D
test('D — Backend + realtime: a live requirement owes a two-client proof', () => {
  const spec = specFor('Build a live counter dashboard that updates in real time for every user');
  const architecture = selectArchitecture(spec);
  const obligations = runtimeObligations({ architecture, spec, files: BACKEND_FILES, hasBackend: true });
  assert.ok(obligations.requiredTests.includes('realtime'), 'a live requirement must owe the realtime proof');

  const base = {
    files: BACKEND_FILES, architecture, spec, requirements: spec.requirements,
    fidelity: { passed: true, violations: [] }, hasBackend: true, executorConfigured: true,
    deployment: normalizeDeployment({ status: 'DEPLOYED', url: 'https://live-app.mauli.generated.workers.dev' })
  };
  const obligationsIds = obligations.requiredTests.filter((id) => id !== 'realtime');
  const tests = {};
  for (const id of obligationsIds) tests[id] = { status: 'PASS', detail: 'observed', request: `GET /api/${id}`, responseStatus: 200, deployed: true, called: true };
  const coreFeature = {
    label: obligations.coreFeature?.label ?? 'n/a', featureKeys: obligations.coreFeature?.featureKeys ?? [],
    basis: 'requirement-specification', status: 'PASS',
    probes: (obligations.coreFeature?.probes ?? []).map((p) => ({
      probeId: p.id, status: 'PASS', executable: p.executable, detail: `${p.label} — observed over real HTTP`,
      request: 'POST /api/counters', responseStatus: 201, persisted: true, requirementIds: []
    }))
  };
  const without = evaluateRuntimeAcceptance({ ...base, acceptance: { status: 'passed', transport: 'deployed-http', projectId: 'p', deployment: { url: 'https://live-app.mauli.generated.workers.dev' }, testedAt: '2026-10-02T00:00:00.000Z', tests, coreFeature } });
  assert.equal(without.status, RUNTIME_STATUS.BLOCKED);
  assert.match(without.blockingReason, /second connected client live|realtime/i);

  tests.realtime = { status: 'PASS', detail: 'a write made through the API reached two independently connected clients', deployed: true };
  const with_ = evaluateRuntimeAcceptance({ ...base, acceptance: { status: 'passed', transport: 'deployed-http', projectId: 'p', deployment: { url: 'https://live-app.mauli.generated.workers.dev' }, testedAt: '2026-10-02T00:00:00.000Z', tests, coreFeature } });
  assert.equal(with_.status, RUNTIME_STATUS.PASSED, with_.blockingReason ?? '');
  assert.equal(with_.realtime, 'PASS');
});

// =========================================================================== E
test('E — Browser-only: no Worker/D1 is demanded, and the app is still held to its own bar', () => {
  const spec = specFor('Build a simple calculator web app');
  const architecture = selectArchitecture(spec);
  assert.equal(architecture.backend, false);
  const obligations = runtimeObligations({ architecture, spec, files: [{ path: 'www/app.js', content: '' }], hasBackend: false });
  assert.equal(obligations.deploymentRequired, false, 'a browser-only app owes no deployment');
  assert.equal(runtimeDeploymentKind({ architecture }), 'browser');
  assert.ok(!obligations.requiredTests.includes('deployment'));
  assert.ok(!obligations.requiredTests.includes('database'));

  const report = evaluateRuntimeAcceptance({
    files: [{ path: 'www/app.js', content: 'document.getElementById("x").textContent = "1";' }],
    architecture, spec, requirements: spec.requirements,
    acceptance: {
      status: 'passed', transport: 'dom-runtime', projectId: 'p_local',
      deployment: { url: null }, testedAt: '2026-10-02T00:00:00.000Z',
      tests: { 'ui-interaction': { status: 'PASS', detail: 'the app executed and its controls changed the DOM 3 time(s)' }, 'user-journey': { status: 'PASS', detail: 'all 4 journey steps passed' } }
    },
    fidelity: { passed: true, violations: [] }, hasBackend: false
  });
  assert.equal(report.status, RUNTIME_STATUS.PASSED, report.blockingReason ?? '');
});

// =========================================================================== F
test('F — Runtime executor unavailable: a deployed backend is BLOCKED, never skipped or passed', () => {
  const ctx = projectWithDeployment('F no executor', 'Build a team coffee order app with staff login');
  const report = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture: ctx.architecture, spec: ctx.spec,
    requirements: ctx.spec.requirements, acceptance: null,
    fidelity: { passed: true, violations: [] }, hasBackend: true,
    deployment: ctx.project.runtimeDeployment, projectId: ctx.project.id,
    executorConfigured: false
  });
  assert.equal(report.status, RUNTIME_STATUS.BLOCKED);
  assert.equal(report.blockingCode, 'runtime-executor-unavailable');
  assert.match(report.blockingReason, /never a skip and never a PASS/i);

  // The same project with no acceptance and no executor must also be BLOCKED through the store.
  assert.equal(verdict(store.get('projects', ctx.project.id), { env: {} }).label, 'BLOCKED');
});

// =========================================================================== G
test('G — Deployment failure: status, category, a safe message and no secret', () => {
  const categorized = categorizeDeploymentError('error: authentication failed, invalid API token cf-0123456789abcdefghijklmnopqrstuvwxyz012345');
  assert.equal(categorized.errorCategory, 'credentials');
  assert.ok(!/cf-0123456789abcdefghijklmnopqrstuvwxyz012345/.test(categorized.errorMessage), 'a credential must never be recorded');
  assert.ok(categorized.errorMessage.includes('[redacted]'));

  const ctx = projectWithDeployment('G deploy failed', 'Build a team coffee order app with staff login', { deploy: false });
  recordGeneratedDeployment(ctx.project.id, {
    status: 'FAILED', errorCategory: 'build', errorMessage: 'esbuild: Unexpected token in worker/index.js',
    attemptedAt: '2026-10-02T00:05:00.000Z', projectId: ctx.project.id
  });
  const report = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture: ctx.architecture, spec: ctx.spec,
    requirements: ctx.spec.requirements, acceptance: null,
    fidelity: { passed: true, violations: [] }, hasBackend: true,
    deployment: store.get('projects', ctx.project.id).runtimeDeployment, projectId: ctx.project.id, executorConfigured: true
  });
  assert.equal(report.status, RUNTIME_STATUS.BLOCKED);
  assert.equal(report.blockingCode, 'deployment-failed');
  assert.match(report.blockingReason, /build: esbuild: Unexpected token/);

  // And the founder-facing projection says the same thing rather than "not run".
  const summary = verdict(store.get('projects', ctx.project.id));
  assert.equal(summary.deploymentStatus, 'FAILED');
  assert.equal(summary.deploymentError.category, 'build');
});

// =========================================================================== H
test('H — Wrong deployment URL: MAULI\'s own URL and another project\'s URL are both refused', () => {
  assert.equal(isGeneratedAppUrl(CONTROL_PLANE, { deployment: null, controlPlaneUrls: [CONTROL_PLANE] }), false);
  const dep = normalizeDeployment({ status: 'DEPLOYED', url: 'https://orders-app.mauli.generated.workers.dev', projectId: 'p1' });
  const identity = assertRuntimeIdentity({ projectId: 'p1', deployment: dep, controlPlaneUrls: [CONTROL_PLANE], required: true });
  assert.equal(identity.ok, true);
  const wrongProject = assertRuntimeIdentity({
    projectId: 'p2',
    deployment: normalizeDeployment({ status: 'DEPLOYED', url: 'https://orders-app.mauli.generated.workers.dev', projectId: 'p1' }),
    controlPlaneUrls: [CONTROL_PLANE], required: true
  });
  assert.equal(wrongProject.ok, false);
  assert.ok(wrongProject.violations.some((v) => v.why.includes('belongs to project p1')));

  const controlPlaneUrl = assertRuntimeIdentity({
    projectId: 'p1',
    deployment: normalizeDeployment({ status: 'DEPLOYED', url: CONTROL_PLANE, projectId: 'p1' }),
    controlPlaneUrls: [CONTROL_PLANE], required: true
  });
  assert.equal(controlPlaneUrl.ok, false);
  assert.ok(controlPlaneUrl.violations.some((v) => /control-plane/.test(v.why)), 'MAULI\'s own URL must never pass as the generated app');
});

// =========================================================================== I
test('I — Wrong project identity: a run produced for another project is refused at the write', () => {
  const mine = projectWithDeployment('I identity', 'Build a team coffee order app with staff login');
  const theirs = greenRun(mine.spec, mine.architecture, {
    projectId: 'project_someone_else', url: mine.url, artifactId: mine.artifact.id
  });
  assert.throws(() => recordRuntimeAcceptance(mine.project.id, theirs), /produced for project project_someone_else/);

  // And a run that names this project but points at another project's URL is refused too.
  const swapped = greenRun(mine.spec, mine.architecture, {
    projectId: mine.project.id, url: 'https://someone-elses-app.mauli.generated.workers.dev', artifactId: mine.artifact.id
  });
  recordRuntimeAcceptance(mine.project.id, swapped, {}, { env: EXECUTOR_ENV });
  const summary = verdict(store.get('projects', mine.project.id));
  assert.equal(summary.label, 'BLOCKED');
  assert.match(summary.reason, /identity|not this generated project's runtime URL/i);
});

// =========================================================================== J
test('J — Critical requirement without runtime evidence blocks the runtime gate', () => {
  const ctx = projectWithDeployment('J missing evidence', 'Build a team coffee order app with staff login');
  const run = greenRun(ctx.spec, ctx.architecture, { projectId: ctx.project.id, url: ctx.url, artifactId: ctx.artifact.id });
  // A critical requirement whose runtime test was never executed at all.
  const critical = ctx.spec.requirements.find((r) => r.critical) ?? ctx.spec.requirements[0];
  assert.ok(critical, 'the specification must expose at least one requirement');
  const demanded = requiredTestsForRequirement({ title: critical.title, category: critical.category }, ctx.architecture);
  assert.ok(demanded.length > 0, `${critical.title} must demand a runtime test`);
  for (const id of demanded) delete run.tests[id];

  const report = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture: ctx.architecture, spec: ctx.spec,
    requirements: ctx.spec.requirements, acceptance: run,
    fidelity: { passed: true, violations: [] }, hasBackend: true,
    deployment: ctx.project.runtimeDeployment, projectId: ctx.project.id, executorConfigured: true
  });
  assert.equal(report.status, RUNTIME_STATUS.BLOCKED);
  assert.ok(report.criticalFailed.length > 0, 'the unevidenced requirement must be listed');
  assert.equal(verdict(store.get('projects', ctx.project.id), { env: EXECUTOR_ENV, acceptance: run }).label, 'BLOCKED');
});

// =========================================================================== K
test('K — runtime failure → repair → redeploy → retest: the old PASS is stale', () => {
  const ctx = projectWithDeployment('K repair', 'Build a team coffee order app with staff login');
  recordRuntimeAcceptance(ctx.project.id, greenRun(ctx.spec, ctx.architecture, {
    projectId: ctx.project.id, url: ctx.url, artifactId: ctx.artifact.id
  }), {}, { env: EXECUTOR_ENV });
  assert.equal(verdict(store.get('projects', ctx.project.id)).label, 'PASS');

  // The repair regenerates the application: a NEW code artifact replaces the old one, and a
  // new deployment URL goes with it. The previous PASS described bytes that no longer exist.
  const repairedFiles = [...BACKEND_FILES, { path: 'www/repair.js', content: '// repaired' }];
  const repaired = registerArtifact({ projectId: ctx.project.id, taskId: null, type: 'code-workspace', content: { files: repairedFiles } });
  store.put('artifacts', { ...repaired, createdAt: new Date(Date.parse(ctx.artifact.createdAt) + 60000).toISOString(), id: repaired.id });
  recordGeneratedDeployment(ctx.project.id, {
    status: 'DEPLOYED', url: 'https://orders-app-v2.mauli.generated.workers.dev',
    deploymentId: 'dep_2', deployedAt: '2026-10-02T01:00:00.000Z', artifactId: repaired.id
  });
  const stale = verdict(store.get('projects', ctx.project.id));
  assert.equal(stale.label, 'BLOCKED');
  assert.match(stale.reason, /regenerated|deployed at|not this generated project's/i);

  // Retesting the new deployment clears it — with a run that names the NEW artifact and URL.
  recordRuntimeAcceptance(ctx.project.id, greenRun(ctx.spec, ctx.architecture, {
    projectId: ctx.project.id, url: 'https://orders-app-v2.mauli.generated.workers.dev', artifactId: repaired.id
  }), {}, { env: EXECUTOR_ENV });
  assert.equal(verdict(store.get('projects', ctx.project.id)).label, 'PASS');
});

// =========================================================================== L
test('L — a full green project delivers, and any missing link blocks it instead', () => {
  const ctx = projectWithDeployment('L delivery', 'Build a team coffee order app with staff login');
  recordRuntimeAcceptance(ctx.project.id, greenRun(ctx.spec, ctx.architecture, {
    projectId: ctx.project.id, url: ctx.url, artifactId: ctx.artifact.id
  }), {}, { env: EXECUTOR_ENV });

  const project = store.get('projects', ctx.project.id);
  const complete = (id, extra = {}) => store.put('tasks', {
    id, projectId: project.id, title: id, state: 'completed', verificationId: `verification-${id}`,
    executor: 'internal.plan', sequence: 1, ...extra
  });
  for (const gate of ['build', 'test', 'requirements', 'security', 'functional-fidelity', 'production-runtime', 'qa', 'integrity']) {
    complete(`task_gate_${project.id}_${gate}`, { pipelineGate: true, gateType: gate, result: { passed: true } });
  }
  complete('task_l_final_qa', { finalProjectVerification: true });

  const delivery = buildFinalDelivery(project, { enforceGates: true, env: EXECUTOR_ENV });
  assert.equal(delivery.content.deliveryStatus, 'FINAL DELIVERY READY');
  assert.equal(delivery.content.productionRuntime.status, 'passed');
  assert.equal(delivery.metadata.productionRuntime.finalDelivery, 'READY');

  // The same project, minus the runtime evidence, is BLOCKED — no ZIP, no "ready".
  const bare = projectWithDeployment('L blocked', 'Build a team coffee order app with staff login');
  assert.throws(
    () => buildFinalDelivery(bare.project, { enforceGates: true, env: EXECUTOR_ENV }),
    /Delivery blocked/
  );
});

// =========================================================================== automatic, per project
test('acceptance is automatic per project — no configured project id anywhere', () => {
  const one = projectWithDeployment('Auto one', 'Build a team coffee order app with staff login');
  const two = projectWithDeployment('Auto two', 'Build a personal notes web app to save and list notes');
  recordRuntimeAcceptance(one.project.id, greenRun(one.spec, one.architecture, {
    projectId: one.project.id, url: one.url, artifactId: one.artifact.id
  }), {}, { env: EXECUTOR_ENV });

  const pending = projectsNeedingRuntimeAcceptance({ limit: 50 }).map((p) => p.id);
  assert.ok(!pending.includes(one.project.id), 'a project with passing evidence is not swept again');
  assert.ok(pending.includes(two.project.id), 'a project with generated code and no evidence is swept automatically');
});

test('a deploy that cannot happen is recorded as BLOCKED, never as a success', async () => {
  const ctx = projectWithDeployment('Auto deploy', 'Build a team coffee order app with staff login', { deploy: false });
  const outcome = await ensureGeneratedDeployment(ctx.project.id, {});
  assert.equal(outcome.deployed, false);
  const deployment = normalizeDeployment(store.get('projects', ctx.project.id).runtimeDeployment);
  assert.equal(deployment.status, DEPLOYMENT_STATUS.NOT_DEPLOYED);
  assert.match(outcome.reason, /MAULI_DEPLOY_EXECUTOR/);
});

// =========================================================================== repair loop
test('the repair loop re-runs the whole acceptance after a rebuild, never reuses a verdict', async () => {
  const builds = [];
  const runs = [];
  // Attempt 0 ships a backend that cannot log in; attempt 1 fixes it and is redeployed.
  const broken = [{ path: 'worker/index.js', content: 'export default { fetch(){ return new Response("{}", { status: 500 }); } };' }];
  const fixed = [{ path: 'worker/index.js', content: 'export default { fetch(request){ return Response.json({ ok: true, path: new URL(request.url).pathname }); } };' }];

  const outcome = await repairUntilRuntimeAcceptance(
    async (attempt) => { builds.push(attempt); return attempt === 0 ? broken : fixed; },
    {
      maxAttempts: 2,
      accept: async (files, { attempt }) => {
        const brokenBuild = files === broken;
        runs.push(attempt);
        return {
          passed: !brokenBuild,
          report: brokenBuild
            ? { status: 'failed', blockingCode: 'runtime-failed', blockingReason: 'POST /api/login → 500', failedTests: [{ test: 'login', detail: '500' }] }
            : { status: 'passed', blockingCode: null, blockingReason: null, failedTests: [] }
        };
      }
    }
  );
  assert.equal(outcome.passed, true);
  assert.equal(outcome.attempts, 1);
  assert.deepEqual(builds, [0, 1], 'the rebuild happens exactly once and the acceptance runs for both builds');
  assert.deepEqual(runs, [0, 1], 'a verdict is never reused: attempt 1 is judged by its own run');
  assert.equal(outcome.repairs.length, 1);
  assert.match(outcome.repairs[0].causes[0], /POST \/api\/login/);
});

test('the repair loop stops at its bound and reports failure rather than spinning', async () => {
  const outcome = await repairUntilRuntimeAcceptance(
    async () => [{ path: 'worker/index.js', content: 'export default { fetch(){ return new Response(""); } };' }],
    { maxAttempts: 1, accept: async () => ({ passed: false, report: { status: 'failed', blockingCode: 'runtime-failed', blockingReason: 'still broken' } }) }
  );
  assert.equal(outcome.passed, false);
  assert.equal(outcome.attempts, 1);
  assert.equal(outcome.runs.length, 1);
});

test('deployment executor isolates each project database and rejects path traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mauli-stage-test-'));
  const written = await stageProject([
    { path: 'worker/index.js', content: 'ok' },
    { path: '../outside.txt', content: 'must-not-write' },
    { path: 'nested/../../outside2.txt', content: 'must-not-write' }
  ], { root });
  assert.equal(written, 1);
  assert.equal(await readFileFs(join(root, 'worker/index.js'), 'utf8'), 'ok');
  await assert.rejects(() => readFileFs(join(root, '../outside.txt'), 'utf8'));
});
