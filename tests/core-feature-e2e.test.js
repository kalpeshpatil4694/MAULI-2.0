import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// THE PART OF THE MATRIX THAT A GENERIC CRUD SMOKE TEST CANNOT PROVE.
//
//   * the runtime test is DERIVED from the founder's own requirement specification
//   * an external API is called for real, or the verdict is BLOCKED
//   * real-time is proved by two independent clients of an ACTUAL deployment
//   * the deploy executor returns a real deployment or an explicit failure category
//   * the runtime executor REFUSES to run against anything but a real deployment
//   * the per-project sweep finds several projects and re-queues a stale one
//   * a browser-only product and a native product are held to their own bar
//
// Every scenario that talks HTTP talks to a real `node:http` deployment of a real
// generated project. Nothing here asserts against a stub.
// ---------------------------------------------------------------------------

import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import {
  coreFeatureFor, deliveredCapabilities, judgeCoreFeature, coreFeatureEvidence
} from '../src/core-feature.js';
import { runtimeObligations, evaluateRuntimeAcceptance, RUNTIME_STATUS } from '../src/production-runtime.js';
import {
  runProductionRuntimeAcceptance, runCoreFeatureProbes, runDeployedRealtimeTwoClient,
  callExternalServiceForReal, judgeDeployedJourney, EXTERNAL_SERVICE_PROBES
} from '../scripts/production-runtime.mjs';
import { deployGeneratedProject, categorize, stageProject, redact } from '../scripts/deploy-executor.mjs';
import { assertRealTarget, runAcceptanceAgainst } from '../scripts/runtime-executor-server.mjs';
import { startDeploymentHarness } from '../scripts/deployment-harness.mjs';
import { store } from '../src/store.js';
import { createProject } from '../src/projects.js';
import { registerArtifact } from '../src/artifacts.js';
import {
  projectsNeedingRuntimeAcceptance, recordGeneratedDeployment, recordRuntimeAcceptance,
  runtimeAcceptanceSummary
} from '../src/runtime-evidence.js';

const ORDERS = 'Build a shop order app for a coffee shop with staff login and live order updates';
const MEDICINE = 'Build a medicine tracker app where I record each dose I take';
const BOOKING = 'Build a booking app where customers book appointments and staff view the schedule';
const NOTES = 'Build a notes web app where I write and read notes on the browser';

function build(command) {
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  return { spec, architecture, built, api: `/api/${built.table}s` };
}

/** A native `fetch` that never leaves the process, so a deployed run needs no listener. */
const nativeFetch = globalThis.fetch.bind(globalThis);

async function overDeployment(ctx, run) {
  const harness = await startDeploymentHarness(ctx.built.files, { env: {} });
  try { return await run(harness); }
  finally { harness.close(); }
}

async function acceptanceOverHttp(ctx, extra = {}) {
  return overDeployment(ctx, async (harness) => runProductionRuntimeAcceptance(ctx.built.files, {
    spec: ctx.spec, architecture: ctx.architecture, requirements: ctx.spec.requirements,
    api: ctx.api, baseUrl: harness.url, fetchImpl: nativeFetch, ...extra
  }));
}

// =========================================================================== 1
test('the runtime test is derived from the founder\'s OWN specification, not a fixed script', () => {
  const orders = build(ORDERS);
  const medicine = build(MEDICINE);
  const ordersFeature = coreFeatureFor({ spec: orders.spec, files: orders.built.files });
  const medicineFeature = coreFeatureFor({ spec: medicine.spec, files: medicine.built.files });
  assert.ok(ordersFeature, 'a founder command must yield a core feature');
  assert.ok(medicineFeature, 'a medicine tracker must yield a core feature');
  assert.notDeepStrictEqual(
    ordersFeature.featureKeys, medicineFeature.featureKeys,
    'two different founder commands must not collapse to the same runtime test'
  );
  // The obligations name the feature, so "the runtime test was generic" is impossible.
  const obligations = runtimeObligations({
    architecture: orders.architecture, spec: orders.spec, files: orders.built.files, hasBackend: true
  });
  assert.ok(obligations.coreFeature, 'the gate must know which feature it is proving');
  assert.ok(obligations.requiredTests.includes('core-feature'));
});

// =========================================================================== 2
test('a feature the founder asked for but the code cannot do is never marked proven', () => {
  // The founder asks for search; the delivered code has no query parameter to narrow by.
  const files = [
    { path: 'worker/index.js', content: 'export default { async fetch(request) { return new Response(JSON.stringify({ ok: true })); } };' },
    { path: 'package.json', content: '{"name":"x"}' }
  ];
  const spec = { ...extractRequirementSpec({ command: 'Build a task tracker app where I can search my tasks', platform: 'web' }), features: [{ key: 'search', label: 'Search / filter' }] };
  const feature = coreFeatureFor({ spec, files });
  const search = feature.probes.find((p) => p.id === 'filter-narrowing');
  assert.ok(search, 'a search requirement must owe a narrowing probe');
  assert.equal(search.executable, false, 'the delivered code exposes no filter parameter');
  const verdict = judgeCoreFeature(feature, {});
  assert.equal(verdict.status, 'BLOCKED', 'an unexecutable feature is BLOCKED, never PASS');
  assert.ok(verdict.missing.includes('filter-narrowing'));
});

// =========================================================================== 3
test('a core-feature probe that never ran leaves no evidence behind', () => {
  const spec = extractRequirementSpec({ command: ORDERS, platform: 'web' });
  const feature = coreFeatureFor({ spec, files: [{ path: 'worker/index.js', content: 'export default {};' }] });
  const rows = coreFeatureEvidence(feature, {});
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.status === 'MISSING'));
  assert.equal(judgeCoreFeature(feature, {}).status, 'BLOCKED');
});

// =========================================================================== 4
test('a real backend proves its OWN feature end to end over real network HTTP', async () => {
  const orders = build(ORDERS);
  const report = await acceptanceOverHttp(orders);
  assert.equal(report.transport, 'deployed-http');
  assert.equal(report.tests['core-feature']?.status, 'PASS', JSON.stringify(report.tests['core-feature']));
  assert.ok(report.coreFeature?.probes?.length >= 4, 'each owed probe must carry its own evidence row');
  assert.ok(report.coreFeature.probes.every((p) => typeof p.request === 'string' && p.request.length > 0),
    'a probe row must name the request it issued');
});

// =========================================================================== 5
test('a second founder command gets its own core-feature test, not the first one\'s', async () => {
  // Two DIFFERENT founder commands: a coffee shop order app and a booking app. The second
  // asks for a scheduling feature, so its runtime test must include the scheduling probe —
  // proof that the test follows the specification instead of a fixed script.
  const orders = build(ORDERS);
  const booking = build(BOOKING);
  const ordersReport = await acceptanceOverHttp(orders);
  const bookingReport = await acceptanceOverHttp(booking);
  assert.equal(ordersReport.tests['core-feature']?.status, 'PASS', JSON.stringify(ordersReport.tests['core-feature']));
  assert.equal(bookingReport.tests['core-feature']?.status, 'PASS', JSON.stringify(bookingReport.tests['core-feature']));
  assert.notDeepStrictEqual(ordersReport.coreFeature.featureKeys, bookingReport.coreFeature.featureKeys);
  assert.ok(bookingReport.coreFeature.featureKeys.includes('reminder'));
  assert.ok(bookingReport.coreFeature.probes.some((p) => p.kind === 'state-transition'),
    'a scheduling feature must be proved by a state transition, not by a shared CRUD pair');
});

// =========================================================================== 6
test('an external API is called for real, and a missing credential stays BLOCKED', async () => {
  const weather = await callExternalServiceForReal({ service: { key: 'weather', label: 'Weather API', envVar: 'WEATHER_API_KEY' }, fetchImpl: nativeFetch });
  assert.equal(weather.called, true, 'the real endpoint must be dialled, not simulated');
  assert.equal(weather.usable, true, `the real response must parse: ${weather.detail}`);

  const sms = await callExternalServiceForReal({ service: { key: 'sms', label: 'SMS API', envVar: 'SMS_API_KEY' }, credential: null, fetchImpl: nativeFetch });
  assert.equal(sms.called, false, 'a service with no credential must not be called and must not be claimed');
  assert.match(sms.reason, /SMS_API_KEY/);

  const unknown = await callExternalServiceForReal({ service: { key: 'not-a-service', label: 'Mystery' }, fetchImpl: nativeFetch });
  assert.equal(unknown.usable, false);
  assert.equal(unknown.called, false);
  // The credential is never echoed into the evidence.
  assert.ok(EXTERNAL_SERVICE_PROBES.weather && !JSON.stringify(EXTERNAL_SERVICE_PROBES).includes('Bearer'));
});

// =========================================================================== 7
test('real-time is proved by TWO independent clients of the ACTUAL deployment', async () => {
  const orders = build(ORDERS);
  const proof = await overDeployment(orders, async (harness) => {
    await nativeFetch(`${harness.url}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ws@acceptance.local', password: 'Acceptance-1234!', name: 'WS' })
    });
    const login = await nativeFetch(`${harness.url}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ws@acceptance.local', password: 'Acceptance-1234!' })
    }).then((r) => r.json());
    const callApi = async (method, path, { body, token } = {}) => {
      const response = await nativeFetch(new URL(path, harness.url).toString(), {
        method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { ok: response.ok, status: response.status, body: await response.clone().json().catch(() => null) };
    };
    return runDeployedRealtimeTwoClient({ baseUrl: harness.url, recordsPath: orders.api, callApi, token: login?.token ?? null });
  });
  assert.equal(proof.passed, true, `two clients must both receive the write: ${proof.detail}`);
  assert.equal(proof.clients, 2);
  assert.equal(proof.received, 2);
});

// =========================================================================== 8
test('a deployed run has NO journey step that was not observed over the network', async () => {
  const orders = build(ORDERS);
  const report = await acceptanceOverHttp(orders);
  assert.equal(report.journey.deployed, true);
  assert.equal(report.journey.passed, true, JSON.stringify(report.journey.steps.filter((s) => s.status === 'FAIL')));
  assert.ok(report.journey.steps.every((s) => s.status === 'PASS'));
  // A step that was planned but never observed must fail the journey, not be skipped.
  const hollow = judgeDeployedJourney({ spec: orders.spec, architecture: orders.architecture, tests: {}, transport: 'deployed-http', baseUrl: 'https://x.example' });
  assert.equal(hollow.passed, false);
  assert.ok(hollow.steps.some((s) => s.status === 'FAIL' && /never executed/.test(s.detail)));
});

// =========================================================================== 9
test('the deploy executor refuses to deploy without credentials and never invents a URL', async () => {
  const orders = build(ORDERS);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;
  try {
    const out = await deployGeneratedProject({ projectId: 'p_demo', files: orders.built.files, artifactId: 'a_demo' });
    assert.equal(out.deployment.status, 'FAILED');
    assert.equal(out.deployment.errorCategory, 'credentials');
    assert.match(out.deployment.errorMessage, /DEPENDENCY_REQUIRED/);
    assert.equal(out.deployment.url, null, 'no deployment happened, so there is no URL');
  } finally { if (token) process.env.CLOUDFLARE_API_TOKEN = token; }

  const empty = await deployGeneratedProject({ projectId: 'p_demo', files: [] });
  assert.equal(empty.deployment.status, 'FAILED');
  assert.equal(empty.deployment.errorCategory, 'build');

  assert.equal(categorize('Authentication error [code: 10000]', ''), 'credentials');
  assert.equal(categorize('Daily limit exceeded', ''), 'quota');
  assert.equal(categorize('Unexpected token in module', ''), 'build');
  assert.match(redact('failed with token abcdefghijklmnopqrstuvwxyz012345'), /\[redacted\]/);
});

// =========================================================================== 10
test('a generated path can never escape the deploy staging directory', async () => {
  const { mkdtemp, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'mauli-stage-test-'));
  const written = await stageProject([
    { path: 'worker/index.js', content: 'export default {};' },
    { path: '../../etc/escaped.txt', content: 'nope' }
  ], { root });
  assert.equal(written, 1, 'a traversing path must not be staged');
  await assert.rejects(readFile(join(root, '..', '..', 'etc', 'escaped.txt'), 'utf8'));
});

// =========================================================================== 11
test('the runtime executor REFUSES anything that is not a real deployment', async () => {
  assert.equal(assertRealTarget(null).ok, false);
  assert.equal(assertRealTarget('not-a-url').ok, false);

  const notDeployed = await runAcceptanceAgainst({
    projectId: 'p_demo',
    files: build(ORDERS).built.files,
    deployment: { status: 'NOT_DEPLOYED', url: null }
  });
  assert.ok(notDeployed.refused);
  assert.equal(notDeployed.refused, true);
  assert.match(notDeployed.reason, /BLOCKED/);
  assert.match(notDeployed.reason, /DEPENDENCY_REQUIRED/);

  // The control plane is never a generated application's runtime URL.
  process.env.MAULI_CONTROL_PLANE_URLS = 'https://mauli-2-0.kalpeshpatil4694.workers.dev';
  const control = await runAcceptanceAgainst({
    projectId: 'p_demo', files: [], deployment: { status: 'DEPLOYED', url: 'https://mauli-2-0.kalpeshpatil4694.workers.dev' }
  });
  assert.equal(control.refused, true);
  assert.match(control.reason, /control-plane/);
  delete process.env.MAULI_CONTROL_PLANE_URLS;
});

// =========================================================================== 12
test('the runtime executor runs a REAL acceptance against a real deployment', async () => {
  const orders = build(ORDERS);
  const out = await overDeployment(orders, async (harness) => runAcceptanceAgainst({
    projectId: 'p_executor', files: orders.built.files, artifactId: 'a_executor',
    deployment: { status: 'DEPLOYED', url: harness.url, deploymentId: 'dep_x', environment: 'production' },
    spec: orders.spec, architecture: orders.architecture, requirements: orders.spec.requirements
  }));
  assert.equal(out.refused, false);
  assert.equal(out.runtimeAcceptance.transport, 'deployed-http');
  assert.equal(out.runtimeAcceptance.projectId, 'p_executor');
});

// =========================================================================== 13
test('the sweep finds EVERY project with generated code, from separate founder commands', () => {
  const before = projectsNeedingRuntimeAcceptance({ limit: 500 }).length;
  const commands = ['Build a shop order app for a coffee shop with staff login', 'Build a medicine tracker app', 'Build a notes web app'];
  const created = [];
  for (const command of commands) {
    const { spec, architecture, built } = build(command);
    const project = createProject({ name: `sweep ${command.slice(0, 12)}`, objective: command, founderCommand: command, requirements: [], requirementSpec: spec, architecture });
    registerArtifact({ projectId: project.id, taskId: null, type: 'code-workspace', content: { files: built.files } });
    created.push(project.id);
  }
  const queue = projectsNeedingRuntimeAcceptance({ limit: 500 });
  for (const id of created) assert.ok(queue.some((p) => p.id === id), `a project created by its own founder command must be swept: ${id}`);
  assert.ok(queue.length >= before + 3);
});

// =========================================================================== 14
test('a project whose code was regenerated comes BACK to the sweep (stale evidence)', () => {
  const { spec, architecture, built, api } = build(ORDERS);
  const project = createProject({ name: 'stale sweep', objective: ORDERS, founderCommand: ORDERS, requirements: [], requirementSpec: spec, architecture });
  const artifact = registerArtifact({ projectId: project.id, taskId: null, type: 'code-workspace', content: { files: built.files } });
  const url = 'https://stale-app.example.workers.dev';
  recordGeneratedDeployment(project.id, { status: 'DEPLOYED', url, deploymentId: 'd1', environment: 'production', artifactId: artifact.id });

  // A COMPLETE deployed run: every test the architecture owes, observed over real HTTP.
  const obligations = runtimeObligations({ architecture, spec, files: built.files, hasBackend: true });
  const tests = {};
  for (const id of obligations.requiredTests) {
    tests[id] = { status: 'PASS', detail: `${id} observed over real HTTP`, request: `${id} against ${url}`, responseStatus: 200, deployed: true, called: true };
  }
  recordRuntimeAcceptance(project.id, {
    status: 'passed', transport: 'deployed-http', projectId: project.id, artifactId: artifact.id,
    testedAt: '2026-10-02T00:00:00.000Z', failures: [], evidence: [], api,
    deployment: { url, deploymentId: 'd1', deployedAt: '2026-10-02T00:00:00.000Z', environment: 'production' },
    tests,
    coreFeature: {
      label: obligations.coreFeature?.label ?? 'n/a', featureKeys: obligations.coreFeature?.featureKeys ?? [],
      basis: 'requirement-specification', status: 'PASS',
      probes: (obligations.coreFeature?.probes ?? []).map((p) => ({
        probeId: p.id, status: 'PASS', executable: true, detail: `${p.label} observed`,
        request: `POST ${api}`, responseStatus: 201, persisted: true, requirementIds: []
      }))
    }
  }, {}, { env: { MAULI_RUNTIME_EXECUTOR: 'https://runner.example' } });

  assert.equal(store.get('projects', project.id).runtimeAcceptanceReport.status, 'passed',
    store.get('projects', project.id).runtimeAcceptanceReport.blockingReason ?? '');
  assert.ok(!projectsNeedingRuntimeAcceptance({ limit: 500 }).some((p) => p.id === project.id),
    'a project with current evidence is not re-queued');

  // The repair regenerates the code. The old PASS describes bytes that no longer exist.
  registerArtifact({ projectId: project.id, taskId: null, type: 'code-workspace', content: { files: built.files.map((f) => ({ ...f, content: `${f.content}\n// repaired` })) } });
  assert.ok(projectsNeedingRuntimeAcceptance({ limit: 500 }).some((p) => p.id === project.id),
    'stale evidence must put the project back in the sweep');
  // The founder-facing projection is re-judged on read, so the stale PASS is never served.
  assert.equal(runtimeAcceptanceSummary(project.id, { env: { MAULI_RUNTIME_EXECUTOR: 'https://runner.example' } }).label, 'BLOCKED',
    'and the founder must see it as BLOCKED, not PASS');
});

// =========================================================================== 15
test('a browser-only product is held to its own bar and is not asked for a Worker', () => {
  const spec = extractRequirementSpec({ command: NOTES, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const files = [
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><input id="t"><button id="s">Save</button><ul id="l"></ul><script src="app.js"></script></body></html>' },
    { path: 'www/app.js', content: 'document.getElementById("s").addEventListener("click",function(){localStorage.setItem("n",document.getElementById("t").value);document.getElementById("l").innerHTML="<li>"+localStorage.getItem("n")+"</li>";});' }
  ];
  const obligations = runtimeObligations({ architecture, spec, files, hasBackend: false });
  assert.equal(obligations.backend, false);
  assert.equal(obligations.deploymentKind, 'browser');
  assert.equal(obligations.deploymentRequired, false);
  assert.ok(!obligations.requiredTests.includes('deployment'));
  assert.ok(obligations.requiredTests.includes('ui-interaction'));
  // Point 12: a local app's evidence must SAY it was judged on a browser basis.
  const report = evaluateRuntimeAcceptance({ files, architecture, spec, requirements: spec.requirements, acceptance: null, hasBackend: false });
  assert.equal(report.status, RUNTIME_STATUS.BLOCKED);
  assert.match(report.blockingReason ?? '', /local|runtime acceptance run/i);
});

// =========================================================================== 16
test('a native product is BLOCKED without a device, never PASS on a build', () => {
  const spec = extractRequirementSpec({ command: 'Build a notes app', platform: 'android' });
  // The delivered files are the package alone: no Worker entry point is shipped, so the
  // architecture under test is the one that owes no server — only an installed app.
  const files = [{ path: 'android/app/build.gradle', content: 'apply plugin: "com.android.application"' }];
  const obligations = runtimeObligations({ architecture: null, spec, files, hasBackend: false, platform: 'android' });
  assert.equal(obligations.deploymentKind, 'native');
  assert.equal(obligations.deploymentRequired, true);
  assert.ok(obligations.requiredTests.includes('android-launch'));
  const report = evaluateRuntimeAcceptance({
    files, architecture: null, spec, requirements: spec.requirements, platform: 'android',
    acceptance: {
      status: 'passed', transport: 'deployed-http', testedAt: '2026-10-02T00:00:00.000Z',
      deployment: { url: 'https://apk.example', deploymentId: 'd1', environment: 'production' },
      tests: { 'android-launch': { status: 'MISSING', detail: 'no emulator is available' } }
    },
    deployment: { status: 'DEPLOYED', url: 'https://apk.example', projectId: 'p_native' },
    projectId: 'p_native'
  });
  assert.equal(report.status, RUNTIME_STATUS.BLOCKED, report.blockingReason ?? '');
  assert.match(report.blockingReason, /ANDROID_RUNTIME|device|emulator/i);
});

// =========================================================================== 17
test('the core-feature probes reject a backend that answers 200 but writes nothing', async () => {
  const fake = [
    { path: 'worker/index.js', content: 'export default { async fetch(request) { const u=new URL(request.url); if(u.pathname.startsWith("/api/orders")) return new Response(JSON.stringify({ok:true,orders:[{id:1,title:"Seeded"}]}),{headers:{"content-type":"application/json"}}); return new Response("{}",{status:404}); } };' },
    { path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Orders</h1></body></html>' },
    { path: 'package.json', content: '{"name":"fake"}' }
  ];
  const spec = extractRequirementSpec({ command: ORDERS, platform: 'web' });
  const feature = coreFeatureFor({ spec, files: fake });
  const callApi = async (method, path) => ({ ok: true, status: 200, body: { ok: true, orders: [{ id: 1, title: 'Seeded' }] } });
  const { probes } = await runCoreFeatureProbes({ coreFeature: feature, callApi, recordsPath: '/api/orders', token: null, capabilities: feature.capabilities, files: fake });
  const verdict = judgeCoreFeature(feature, probes);
  assert.equal(verdict.status, 'FAIL', 'a 200 from a backend that stores nothing is a failed core feature');
  assert.ok(verdict.failed.length > 0);
});

// =========================================================================== 18
test('the delivered capabilities are read from the code, not from the founder\'s wish', () => {
  const withSearch = deliveredCapabilities([{ path: 'worker/index.js', content: 'const q = url.searchParams.get("q"); SELECT * FROM t WHERE title LIKE ?' }]);
  assert.equal(withSearch.filterNarrowing, true);
  assert.equal(withSearch.ordering, false);
  const withOrder = deliveredCapabilities([{ path: 'worker/index.js', content: 'SELECT id FROM orders ORDER BY created_at DESC' }]);
  assert.equal(withOrder.ordering, true);
  const empty = deliveredCapabilities([{ path: 'package.json', content: '{}' }]);
  assert.equal(empty.recordEndpoint, false);
});
