import test from 'node:test';
import assert from 'node:assert/strict';

import { GATES, ensureProjectPipeline } from '../src/pipeline-gates.js';
import { listExecutors } from '../src/executor-registry.js';
import {
  RUNTIME_PIPELINE_ORDER, RUNTIME_BLOCKING, evaluateRuntimeAcceptance,
  runtimeObligations, requiredTestsForRequirement, runtimeRequirementEvidence,
  fakeRuntimeSignals, noFalsePassViolations, describeRuntimeAcceptance,
  describeStoredRuntimeAcceptance, isRuntimeAcceptanceReport, hasBackendEntryPoint
} from '../src/production-runtime.js';
import {
  recordRuntimeAcceptance, runtimeAcceptanceSummary, currentRuntimeAcceptance, judgeRuntimeAcceptance
} from '../src/runtime-evidence.js';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { buildRequirementMatrix } from '../src/requirement-matrix.js';
import { store } from '../src/store.js';
import { createProject } from '../src/projects.js';
import { registerArtifact } from '../src/artifacts.js';

// --------------------------------------------------------------------------- fixtures
const BACKEND_FILES = [
  { path: 'worker/index.js', content: 'export default { fetch(request) { return new Response("{\"ok\":true}"); } };' },
  { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Orders</h1><script src="app.js"></script></body></html>' }
];
const BACKEND_COMMAND = 'Build a team coffee order app with staff login';
// Production acceptance is judged against a REAL deployment of the generated project. These
// are the identity fixtures every backend scenario shares: the project's own URL (never
// MAULI's control plane), the deployment id, and the artifact whose bytes were deployed.
const FIXTURE_PROJECT_ID = 'mauli_runtime_fixture';
const DEPLOYED_URL = 'https://orders-app-mauli-2-0.kalpeshpatil4694.workers.dev';
const DEPLOYED = {
  status: 'DEPLOYED', url: DEPLOYED_URL, deploymentId: 'dep_mauli_runtime_fixture',
  deployedAt: '2026-10-02T00:00:00.000Z', environment: 'production',
  projectId: FIXTURE_PROJECT_ID, artifactId: 'artifact_fixture'
};

/** The product MAULI actually generates for this command — what the gates really judge. */
async function builtBackend() {
  const { generateFullStackApp } = await import('../src/fullstack-codegen.js');
  const spec = extractRequirementSpec({ command: BACKEND_COMMAND, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: BACKEND_COMMAND });
  return { spec, architecture, files: built.files };
}

function backendSpec() {
  return extractRequirementSpec({ command: BACKEND_COMMAND, platform: 'web' });
}

/** A run where every test the architecture owes was observed and passed, over real HTTP. */
function passingRun(architecture, spec, { projectId = FIXTURE_PROJECT_ID, url = DEPLOYED_URL, transport = 'deployed-http' } = {}) {
  const obligations = runtimeObligations({ architecture, spec, files: BACKEND_FILES, hasBackend: true });
  const tests = {};
  for (const id of obligations.requiredTests) {
    // `deployed` and `called` are what the gate reads to tell a real observation from a
    // fixture. A run that cannot say WHERE it observed something cannot claim production.
    tests[id] = { status: 'PASS', detail: `${id} observed against the generated application`, request: `GET /probe/${id}`, responseStatus: 200, deployed: transport === 'deployed-http', called: true };
  }
  const coreFeature = obligations.coreFeature
    ? {
      label: obligations.coreFeature.label,
      featureKeys: obligations.coreFeature.featureKeys,
      basis: 'requirement-specification',
      status: 'PASS',
      probes: obligations.coreFeature.probes.map((p) => ({
        probeId: p.id, status: 'PASS', executable: p.executable, detail: `${p.label} — observed over real HTTP`,
        request: 'POST /api/orders', responseStatus: 201, persisted: true, requirementIds: []
      }))
    }
    : null;
  return {
    status: 'passed',
    transport,
    projectId,
    artifactId: DEPLOYED.artifactId,
    environment: transport === 'deployed-http' ? `deployed worker at ${url} + D1` : 'production-like worker runtime + D1',
    deployment: { url: transport === 'deployed-http' ? url : null, deploymentId: DEPLOYED.deploymentId, deployedAt: DEPLOYED.deployedAt, commit: 'abc1234', environment: 'production' },
    testedAt: '2026-10-02T00:00:00.000Z',
    tests,
    failures: [],
    evidence: [],
    rowsInDb: 3,
    coreFeature
  };
}

function judge(acceptance, {
  spec = backendSpec(), architecture = selectArchitecture(backendSpec()), files = BACKEND_FILES,
  credentials = {}, deployment = DEPLOYED, projectId = FIXTURE_PROJECT_ID,
  executorConfigured = true, controlPlaneUrls = ['https://mauli-2-0.kalpeshpatil4694.workers.dev']
} = {}) {
  const requirements = spec.requirements.map((r) => ({ id: r.id, title: r.title, category: r.category, critical: r.critical }));
  return evaluateRuntimeAcceptance({
    files, architecture, spec, requirements, acceptance,
    fidelity: { passed: true, violations: [], score: 100 },
    credentials, hasBackend: hasBackendEntryPoint(files),
    deployment, projectId, executorConfigured, controlPlaneUrls,
    expectedArtifactId: DEPLOYED.artifactId
  });
}

// --------------------------------------------------------------------------- 1. the chain
test('production runtime sits between functional fidelity and QA in every gate list', () => {
  assert.deepEqual(GATES, RUNTIME_PIPELINE_ORDER);
  assert.equal(GATES.indexOf('production-runtime'), GATES.indexOf('functional-fidelity') + 1);
  assert.ok(GATES.indexOf('production-runtime') < GATES.indexOf('qa'), 'QA must chain behind production runtime');
  assert.ok(GATES.indexOf('qa') < GATES.indexOf('integrity'));
  assert.ok(listExecutors().some((e) => e.name === 'internal.pipeline-gate'), 'the gate executor must be registered');
});

test('the pipeline creates the production-runtime gate in order', () => {
  const project = createProject({
    name: 'Runtime gate ordering',
    objective: BACKEND_COMMAND,
    founderCommand: BACKEND_COMMAND,
    requirements: ['orders'],
    requirementSpec: backendSpec(),
    architecture: selectArchitecture(backendSpec())
  });
  const generated = {
    title: 'Generate application',
    description: 'Generate source code',
    requiredCapabilities: ['frontend'],
    acceptance: [{ field: 'type', equals: 'code' }],
    executor: 'internal.code',
    maxAttempts: 1,
    sequence: 100
  };
  const task = store.put('tasks', {
    id: 'task_runtime_gate_order', projectId: project.id, state: 'completed',
    verificationId: 'verification-runtime-gate-order', ...generated
  });
  registerArtifact({
    projectId: project.id, taskId: task.id, type: 'code-workspace',
    content: { files: BACKEND_FILES }
  });
  store.put('tasks', {
    id: 'task_runtime_gate_qa', projectId: project.id, state: 'completed', verificationId: 'verification-qa',
    title: 'Final project verification and QA', description: 'QA',
    requiredCapabilities: ['testing', 'verification'], acceptance: [{ field: 'type', equals: 'plan' }],
    executor: 'internal.plan', maxAttempts: 1, sequence: 999, finalProjectVerification: true
  });
  ensureProjectPipeline(project.id);
  const gates = store.list('tasks').filter((t) => t.projectId === project.id && t.pipelineGate).sort((a, b) => a.sequence - b.sequence);
  assert.deepEqual(gates.map((t) => t.gateType), ['build', 'test', 'requirements', 'security', 'functional-fidelity', 'production-runtime', 'qa', 'integrity']);
  assert.equal(gates.find((t) => t.gateType === 'production-runtime')?.dependsOn[0], gates.find((t) => t.gateType === 'functional-fidelity')?.id);
});

// --------------------------------------------------------------------------- 2. obligations
test('the obligations are the superset of what the specification will demand as evidence', () => {
  const spec = backendSpec();
  const architecture = selectArchitecture(spec);
  const obligations = runtimeObligations({ architecture, spec, files: BACKEND_FILES, hasBackend: true });
  for (const requirement of spec.requirements) {
    for (const id of requiredTestsForRequirement(requirement, architecture)) {
      assert.ok(obligations.requiredTests.includes(id),
        `${requirement.id} ${requirement.title} demands ${id}, which the obligations do not require`);
    }
  }
  // The concrete defect this rule exists for: a critical security requirement demanded
  // `invalid-input` while the architecture-only obligation set never asked the run for it,
  // so every app that owed input validation was permanently BLOCKED.
  assert.ok(obligations.requiredTests.includes('invalid-input'));
  assert.ok(obligations.requiredTests.includes('read-missing'));
  assert.ok(obligations.requiredTests.includes('duplicate-register'));
});

test('a browser-only architecture owes the local vocabulary and never a D1 round trip', () => {
  const local = { id: 'browser-only', backend: false, database: 'local' };
  const spec = extractRequirementSpec({ command: 'Build a simple calculator web app', platform: 'web' });
  const obligations = runtimeObligations({ architecture: local, spec, files: [{ path: 'www/app.js', content: 'const x = 1;' }], hasBackend: false });
  assert.equal(obligations.backend, false);
  assert.deepEqual(obligations.requiredTests.slice().sort(), ['ui-interaction', 'user-journey']);
  for (const id of ['create', 'read', 'invalid-input', 'deployment', 'api-contract', 'database', 'fake-check']) {
    assert.ok(!obligations.requiredTests.includes(id), `${id} is a backend test and cannot be demanded of a local app`);
  }
  // A data requirement on a local app is proven by the device store.
  const tracker = extractRequirementSpec({ command: 'Build a personal notes web app to save and list notes', platform: 'web' });
  const dataRequired = requiredTestsForRequirement(tracker.requirements.find((r) => r.category === 'data'), local);
  assert.ok(dataRequired.includes('local-persistence'));
  assert.ok(!dataRequired.includes('create'));
});

// --------------------------------------------------------------------------- 3. the verdict
test('a backend project with no acceptance run is BLOCKED, never passed', () => {
  const report = judge(null);
  assert.equal(report.status, 'blocked');
  assert.equal(report.blockingCode, RUNTIME_BLOCKING.EVIDENCE_MISSING);
  assert.match(report.blockingReason, /no production runtime acceptance run exists/i);
  assert.ok(report.criticalFailed.length > 0, 'critical requirements must be listed as without evidence');
});

test('a backend project that was never deployed is BLOCKED before anything is run', () => {
  const spec = backendSpec();
  const architecture = selectArchitecture(spec);
  const report = judge(passingRun(architecture, spec), { spec, architecture, deployment: null });
  assert.equal(report.status, 'blocked');
  assert.equal(report.blockingCode, RUNTIME_BLOCKING.NO_DEPLOYMENT);
  assert.match(report.blockingReason, /has not been deployed/i);
});

test('a complete acceptance run passes and evidences every critical requirement', () => {
  const spec = backendSpec();
  const architecture = selectArchitecture(spec);
  const report = judge(passingRun(architecture, spec), { spec, architecture });
  assert.equal(report.status, 'passed', report.blockingReason ?? '');
  assert.deepEqual(report.criticalFailed, []);
  assert.ok(report.criticalPassed.length > 0);
  assert.equal(report.testedAt, '2026-10-02T00:00:00.000Z');
  for (const row of report.requirements) {
    if (row.critical) assert.equal(row.status, 'PASS', `${row.requirementId} ${row.description}: ${row.failureReason ?? ''}`);
  }
});

test('an executed-and-failed runtime test is a FAILED acceptance with the exact reason', () => {
  const spec = backendSpec();
  const architecture = selectArchitecture(spec);
  const run = passingRun(architecture, spec);
  run.tests['read-missing'] = { status: 'FAIL', detail: 'the deleted record was still returned by GET /api/orders/9' };
  const report = judge(run, { spec, architecture });
  assert.equal(report.status, 'failed');
  assert.equal(report.blockingCode, RUNTIME_BLOCKING.RUNTIME_FAILED);
  assert.match(report.blockingReason, /read-missing/);
  assert.equal(report.blockingReason.includes('the deleted record was still returned'), true);
});

test('a failed authentication flow is a no-false-PASS violation, not a warning', () => {
  const spec = backendSpec();
  const architecture = selectArchitecture(spec);
  const run = passingRun(architecture, spec);
  run.tests.login = { status: 'FAIL', detail: 'POST /api/login returned 200 with no session token' };
  const report = judge(run, { spec, architecture });
  assert.equal(report.status, 'failed');
  assert.equal(report.blockingCode, RUNTIME_BLOCKING.NO_FALSE_PASS);
  assert.ok(report.noFalsePass.some((v) => v.code === 'auth-flow-failed'));
});

test('a missing external credential is BLOCKED / DEPENDENCY_REQUIRED, never a fake success', () => {
  const spec = extractRequirementSpec({ command: 'Build a weather dashboard with forecasts', platform: 'web' });
  const architecture = selectArchitecture(spec);
  assert.ok(spec.externalServices.length > 0, 'the weather service must be recognised as an external dependency');
  const obligations = runtimeObligations({ architecture, spec, files: BACKEND_FILES, hasBackend: true });
  const tests = {};
  for (const id of obligations.requiredTests) tests[id] = { status: 'PASS', detail: 'observed' };
  const report = evaluateRuntimeAcceptance({
    files: BACKEND_FILES, architecture, spec,
    requirements: spec.requirements.map((r) => ({ id: r.id, title: r.title, category: r.category, critical: r.critical })),
    acceptance: { status: 'passed', testedAt: '2026-10-02T00:00:00.000Z', tests },
    fidelity: { passed: true, violations: [] }, credentials: {}, hasBackend: true
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.blockingCode, RUNTIME_BLOCKING.DEPENDENCY_REQUIRED);
  assert.equal(report.external, 'DEPENDENCY_REQUIRED');
  assert.match(report.blockingReason, /WEATHER_API_KEY/);
});

// --------------------------------------------------------------------------- 4. no false PASS
test('placeholder, fake and hardcoded-success signals are refused', () => {
  const signals = fakeRuntimeSignals([
    { path: 'www/app.js', content: '// TODO wire the rest of the feature\nconst records = [];' },
    { path: 'www/index.html', content: '<p>Coming Soon</p>' },
    { path: 'worker/index.js', content: 'const answer = () => Promise.resolve({ ok: true, status: 200 });' }
  ]);
  const codes = signals.map((s) => s.code);
  assert.ok(codes.includes('todo-marker'));
  assert.ok(codes.includes('coming-soon'));
  assert.ok(codes.includes('hardcoded-success'));

  const violations = noFalsePassViolations({
    files: [{ path: 'www/index.html', content: '<p>Coming Soon</p>' }],
    architecture: null, fidelity: null, hasBackend: false, runtime: false
  });
  assert.ok(violations.some((v) => v.code === 'coming-soon'));
});

test('a browser-only page for a backend-required architecture is a no-false-PASS violation', () => {
  const violations = noFalsePassViolations({
    files: [{ path: 'www/index.html', content: '<main>orders</main>' }],
    architecture: { id: 'worker-api', backend: true },
    fidelity: { passed: true, violations: [] },
    hasBackend: false,
    runtime: false
  });
  assert.ok(violations.some((v) => v.code === 'browser-only-for-backend'));
});

test('a critical requirement with no runtime run is BLOCKED, never PASS', () => {
  const spec = backendSpec();
  const rows = runtimeRequirementEvidence({ requirements: spec.requirements, acceptance: null, architecture: selectArchitecture(spec) });
  for (const row of rows) {
    if (row.critical && row.status !== 'NOT APPLICABLE') {
      assert.equal(row.status, 'BLOCKED', `${row.requirementId} must not be called PASS without a run`);
      assert.equal(row.runtimeEvidence, null);
      assert.match(row.failureReason, /no runtime acceptance run/i);
    }
  }
  const structural = rows.find((r) => r.status === 'NOT APPLICABLE');
  assert.ok(structural, 'a structural requirement is reported NOT APPLICABLE with its reason');
});

// --------------------------------------------------------------------------- 5. the store
test('recording an acceptance run persists the run, the legacy projection and the verdict', async () => {
  const { spec, architecture, files } = await builtBackend();
  const project = createProject({
    name: 'Runtime evidence store',
    objective: BACKEND_COMMAND,
    founderCommand: BACKEND_COMMAND,
    requirements: ['orders'],
    requirementSpec: spec,
    architecture
  });
  // The deployment arrives WITH the run: before the run the project owns no URL at all.
  store.put('projects', { ...project, runtimeDeployment: { status: 'NOT_DEPLOYED' }, id: project.id });
  const artifact = registerArtifact({ projectId: project.id, taskId: null, type: 'code-workspace', content: { files } });

  // Identity travels with the run: it names the artifact it actually tested, so a later
  // regeneration invalidates it instead of leaving a standing PASS behind.
  const run = passingRun(architecture, spec, { projectId: project.id, url: DEPLOYED_URL });
  run.artifactId = artifact.id;
  run.secret = 'sk-live-should-not-be-persisted';
  run.tests.login = { ...run.tests.login, accessToken: 'Bearer should-not-be-persisted' };
  recordRuntimeAcceptance(project.id, run, {}, { env: { MAULI_RUNTIME_EXECUTOR: 'https://runner.example/accept' } });

  const stored = store.get('projects', project.id);
  assert.ok(isRuntimeAcceptanceReport(stored.runtimeAcceptance));
  assert.equal(stored.runtimeAcceptance.secret, '[redacted]');
  assert.equal(stored.runtimeAcceptance.tests.login.accessToken, '[redacted]');
  assert.ok(stored.runtimeAcceptedAt);
  assert.equal(stored.runtimeEvidence.executed, true);
  assert.equal(stored.runtimeEvidence.evidence.create, true);
  assert.equal(stored.runtimeEvidence.evidence.auth_login, true);
  assert.equal(stored.runtimeAcceptanceReport.status, 'passed');

  // Re-judged on read, so the executor configuration is part of the answer: a deployed backend
  // with no runtime executor is BLOCKED, never a cached PASS.
  const summary = runtimeAcceptanceSummary(project.id, { env: { MAULI_RUNTIME_EXECUTOR: 'https://runner.example/accept' } });
  assert.equal(summary.label, 'PASS');
  assert.equal(summary.testedAt, '2026-10-02T00:00:00.000Z');
  assert.equal(summary.criticalFailed, 0);
  assert.equal(summary.blockingReason, null);
  assert.equal(currentRuntimeAcceptance(stored).tests['read-missing'].status, 'PASS');
});

test('a project that has never been run reports BLOCKED with the exact reason', async () => {
  const { spec, architecture, files } = await builtBackend();
  const project = createProject({
    name: 'Never run',
    objective: BACKEND_COMMAND,
    founderCommand: BACKEND_COMMAND,
    requirements: ['orders'],
    requirementSpec: spec,
    architecture
  });
  store.put('projects', { ...project, runtimeDeployment: { ...DEPLOYED, projectId: project.id }, id: project.id });
  registerArtifact({ projectId: project.id, taskId: null, type: 'code-workspace', content: { files } });

  const summary = runtimeAcceptanceSummary(project.id, { env: { MAULI_RUNTIME_EXECUTOR: 'https://runner.example/accept' } });
  assert.equal(summary.status, 'BLOCKED');
  assert.equal(summary.label, 'BLOCKED');
  assert.match(summary.blockingReason, /no production runtime acceptance run/i);
  // The deployment IS recorded — so the blocker is the missing run, not a missing URL.
  assert.equal(summary.runtimeUrl, DEPLOYED_URL);
  assert.equal(summary.deploymentStatus, 'DEPLOYED');

  // The cheap list projection never invents a PASS either.
  const listed = describeStoredRuntimeAcceptance(store.get('projects', project.id));
  assert.equal(listed.label, 'BLOCKED');
  const local = describeStoredRuntimeAcceptance({ id: 'p', architecture: { id: 'browser-only', backend: false } });
  assert.equal(local.label, 'LOCAL');
  assert.match(local.reason, /no server to deploy/i);
  // The project's OWN projection must agree with the list projection. runtimeAcceptanceSummary
  // judged a browser-only project with no run as BLOCKED while /api/state called the same
  // project LOCAL, so the live command card printed "Production Runtime: BLOCKED" for an app
  // that needs no server at all.
  const browserOnly = createProject({
    name: 'Local app', objective: 'Build a single-user note pad', founderCommand: 'Build a single-user note pad',
    requirements: ['notes'], architecture: { id: 'local-data', backend: false, database: 'local' }
  });
  registerArtifact({
    projectId: browserOnly.id, taskId: null, type: 'code-workspace',
    content: {
      files: [
        { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Notes</h1><input id="note"><button id="add" onclick="save()">Add</button><ul id="list"></ul><script src="app.js"></script></body></html>' },
        { path: 'www/app.js', content: 'function save(){var i=document.getElementById("note"),l=document.getElementById("list");if(!i.value.trim())return;var li=document.createElement("li");li.textContent=i.value;l.appendChild(li);localStorage.setItem("notes",l.innerHTML);i.value="";}' },
        { path: 'www/styles.css', content: 'body { font-family: sans-serif; padding: 24px; }' }
      ]
    }
  });
  const browserSummary = runtimeAcceptanceSummary(browserOnly.id);
  assert.equal(browserSummary.label, 'LOCAL');
  assert.equal(browserSummary.status, 'not-run');
  assert.equal(browserSummary.finalDelivery, 'BLOCKED', 'a local app that has not completed is not READY');
  assert.match(browserSummary.reason, /no server to deploy/i);
  // Once the project actually completed, Final Delivery is READY: the scheduler only marks a
  // project completed after the gates passed, and a browser-only project passes on its own
  // local bar (UI interaction + device persistence), with no server to deploy.
  store.put('projects', { ...store.get('projects', browserOnly.id), state: 'completed', finalDeliveryId: 'artifact_local', id: browserOnly.id });
  const completedSummary = runtimeAcceptanceSummary(browserOnly.id);
  assert.equal(completedSummary.label, 'LOCAL');
  assert.equal(completedSummary.finalDelivery, 'READY', 'a completed local app must read READY, not BLOCKED');
  assert.equal(describeRuntimeAcceptance(null).label, 'BLOCKED');
});

test('the store refuses an object that is not shaped like an acceptance run', () => {
  const project = createProject({ name: 'Invalid report', objective: BACKEND_COMMAND, founderCommand: BACKEND_COMMAND, requirements: ['orders'] });
  assert.throws(() => recordRuntimeAcceptance(project.id, { status: 'passed' }), /not a valid acceptance run/);
  assert.throws(() => recordRuntimeAcceptance(project.id, { status: 'great', tests: { a: {} } }), /not a valid acceptance run/);
  assert.throws(() => recordRuntimeAcceptance('project_does_not_exist', { status: 'passed', tests: { a: { status: 'PASS' } } }), /does not exist/);
  // A valid-but-empty report is not evidence either.
  assert.equal(isRuntimeAcceptanceReport({ status: 'passed', tests: {} }), false);
});

// --------------------------------------------------------------------------- 6. the matrix
test('the requirement matrix blocks a critical requirement that has no runtime evidence', () => {
  const spec = backendSpec();
  const architecture = selectArchitecture(spec);
  const base = {
    requirements: spec.requirements,
    files: BACKEND_FILES,
    architecture,
    fidelity: { passed: true, violations: [], score: 100 },
    runtimeRequired: true
  };
  const without = buildRequirementMatrix({ ...base, acceptance: null });
  assert.equal(without.deliverable, false);
  assert.ok(without.rows.some((r) => r.critical && r.status === 'BLOCKED'));
  assert.equal(without.summary.runtimeVerified, 0);

  const withRun = buildRequirementMatrix({ ...base, acceptance: passingRun(architecture, spec) });
  assert.ok(withRun.summary.runtimeVerified > 0, 'the run must be visible as runtime-verified rows');
  assert.ok(withRun.rows.every((r) => r.runtimeTest !== undefined), 'every row carries the runtime test that evidences it');
  for (const row of withRun.rows) {
    if (row.critical && row.status === 'PASS') assert.ok(row.runtimeEvidence, `${row.id} passed without naming its evidence`);
  }
});

// --------------------------------------------------------------------------- 7. local execution
test('a browser-only app earns its own acceptance run through the UI, not an endpoint', async () => {
  const { runProductionRuntimeAcceptance } = await import('../scripts/production-runtime.mjs');
  const spec = extractRequirementSpec({ command: 'Build a simple calculator web app', platform: 'web' });
  const architecture = selectArchitecture(spec);
  assert.equal(architecture.backend, false, 'a calculator must not be given a server it does not need');
  const files = [
    { path: 'www/index.html', content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Calculator</h1><input id="a"><input id="b"><button id="add" onclick="doAdd()">Add</button><p id="out"></p><script src="app.js"></script></body></html>' },
    { path: 'www/app.js', content: 'function doAdd(){try{var a=document.getElementById("a"),b=document.getElementById("b"),o=document.getElementById("out");o.textContent=String(Number(a.value||0)+Number(b.value||0));localStorage.setItem("last",o.textContent);}catch(e){document.getElementById("out").textContent="Invalid input";}}' },
    { path: 'www/styles.css', content: 'body { font-family: sans-serif; padding: 24px; } button { padding: 10px; }' },
    { path: 'package.json', content: '{"name":"mauli-calculator","version":"1.0.0","private":true}' }
  ];
  const run = await runProductionRuntimeAcceptance(files, {
    spec, architecture, objective: 'Build a simple calculator web app',
    requirements: Array.isArray(spec.requirements) ? spec.requirements : []
  });
  assert.equal(run.tests['ui-interaction'].status, 'PASS', run.tests['ui-interaction'].detail ?? '');
  assert.equal(run.tests['user-journey'].status, 'PASS', run.tests['user-journey'].detail ?? '');

  const requirements = spec.requirements.map((r) => ({ id: r.id, title: r.title, category: r.category, critical: r.critical }));
  const report = evaluateRuntimeAcceptance({ files, architecture, spec, requirements, acceptance: run, fidelity: null, hasBackend: false, credentials: {} });
  assert.equal(report.status, 'passed', report.blockingReason ?? '');
  assert.deepEqual(report.criticalFailed, []);
  assert.equal(report.database, 'PASS');
});
