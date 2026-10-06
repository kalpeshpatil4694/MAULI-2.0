// MAULI 2.0 — PRODUCTION RUNTIME ACCEPTANCE.
//
// The question this module answers, in code, for every project before Final Delivery:
//
//   "Founder ने command दिल्यावर MAULI ने तयार केलेला application त्याच्या वास्तविक
//    requirements प्रमाणे deploy होतो, चालतो, data persist करतो, user journey पूर्ण करतो
//    आणि प्रत्येक critical requirement साठी runtime evidence देतो का?"
//
// If the answer is NO for any critical requirement, the application is BLOCKED: no QA
// PASS, no Integrity PASS, no Final Delivery, no ZIP.
//
// What was missing before this module existed: static fidelity, build, requirement checks
// and the generated-runtime journey were all real, but none of them was MANDATORY for
// delivery. `project.runtimeEvidence` was READ by src/delivery.js and src/pipeline-gates.js
// and never WRITTEN by anything, so the runtime branch of the requirement matrix could only
// ever see `null`. A project could therefore reach `completed` with zero runtime evidence
// and a `REQUIREMENT NOT VERIFIED` badge — "QA Passed" to anyone reading quickly.
//
// This module is deliberately split from the executor:
//   * it is pure and Worker-safe (no node imports, no eval), so the Worker can apply the
//     gate and the dashboard can render the same verdict;
//   * the EXECUTION lives in scripts/production-runtime.mjs, which runs the real smoke test
//     against the generated backend in Node/CI (or against a deployed endpoint over real
//     HTTP) and produces the structured acceptance report this module judges.
//
// A report is never trusted because it exists. It is trusted when it is shaped like an
// acceptance run, carries the stages the architecture actually owes, and every critical
// requirement has a named runtime test behind it.

// The deployment record is the input that makes "it ran" mean "it ran WHERE". Both modules
// are pure and Worker-safe, so the Worker applies exactly the rules CI's executor reported.
import {
  DEPLOYMENT_STATUS, DEPLOYMENT_BLOCKING, normalizeDeployment, assertRuntimeIdentity,
  runtimeDeploymentKind
} from './generated-deployment.js';
// Point 8: the runtime test is derived from the project's OWN requirements, not a fixed
// generic script. This turns the specification's feature list into the probes that must be
// attempted against the deployment before those requirements may read RUNTIME VERIFIED.
import { coreFeatureFor, judgeCoreFeature, coreFeatureEvidence } from './core-feature.js';

export const PRODUCTION_RUNTIME_VERSION = 3;

// The mandatory order the pipeline must respect:
//   Build → Tests → Requirements → Security → Functional Fidelity → Production Runtime
//         → QA → Integrity → Final Delivery
// Exported so the gate order and this module cannot drift apart.
export const RUNTIME_PIPELINE_ORDER = [
  'build', 'test', 'requirements', 'security', 'functional-fidelity',
  'production-runtime', 'qa', 'integrity'
];

export const RUNTIME_STATUS = { PASSED: 'passed', FAILED: 'failed', BLOCKED: 'blocked' };

// Why a project is not allowed to deliver. Exported so tests, the gate and the dashboard
// all name the same reasons (point 8: "exact reason द्या").
export const RUNTIME_BLOCKING = {
  NO_CODE: 'runtime-no-generated-code',
  EVIDENCE_MISSING: 'runtime-evidence-missing',
  EVIDENCE_INCOMPLETE: 'runtime-evidence-incomplete',
  RUNTIME_FAILED: 'runtime-failed',
  DEPENDENCY_REQUIRED: 'dependency-required',
  NO_FALSE_PASS: 'no-false-pass-violation',
  // The deployment contract. These are distinct from "no evidence": they say WHAT is
  // missing before an acceptance run can even mean anything.
  DEPLOYMENT_FAILED: 'deployment-failed',
  NO_DEPLOYMENT: 'deployment-missing',
  NO_DEPLOYMENT_URL: 'deployment-url-missing',
  IDENTITY_MISMATCH: 'runtime-identity-mismatch',
  EXECUTOR_UNAVAILABLE: 'runtime-executor-unavailable',
  ANDROID_RUNTIME_UNAVAILABLE: 'android-runtime-unavailable'
};

// ---------------------------------------------------------------------------
// The smoke-test stages (spec item 2). Each stage is a real observation, not a label:
//   DEPLOYED WORKER → Health → API Contract → Authentication → Core Business Operation
//   → D1 Persistence → Read/Update/Delete → Error Handling → User Journey → Runtime Evidence
// ---------------------------------------------------------------------------
export const RUNTIME_STAGES = [
  { id: 'deployment', label: 'Deployed worker endpoint answers', scope: 'backend' },
  { id: 'health', label: 'Health response is valid', scope: 'backend' },
  { id: 'api-contract', label: 'API endpoints match the generated contract', scope: 'backend' },
  { id: 'authentication', label: 'Authentication flow works end to end', scope: 'auth' },
  { id: 'core-operation', label: 'Critical business workflow runs', scope: 'data' },
  { id: 'core-feature', label: 'The product\'s own core feature works end to end', scope: 'data' },
  { id: 'database', label: 'Real database persistence', scope: 'backend' },
  { id: 'crud-lifecycle', label: 'create → read → update → read → delete → read missing', scope: 'data' },
  { id: 'error-handling', label: 'Errors surface instead of a fabricated success', scope: 'always' },
  { id: 'user-journey', label: 'The founder journey completes', scope: 'always' },
  { id: 'android-runtime', label: 'The packaged app runs on a real device or emulator', scope: 'native' },
  { id: 'evidence', label: 'Runtime evidence recorded per critical requirement', scope: 'always' }
];

// Test ids the executor records. The gate refuses to call a run "passed" unless the ids the
// architecture owes are present AND passed.
export const RUNTIME_TESTS = [
  'deployment', 'health', 'api-contract',
  'unauthorized', 'register', 'duplicate-register', 'login', 'invalid-login', 'session',
  'invalid-input', 'create', 'read', 'update', 'delete', 'read-missing', 'refresh',
  'database', 'core-feature',
  'realtime', 'logout', 'post-logout', 'error-path', 'fake-check', 'user-journey',
  'ui-interaction', 'local-persistence', 'external-service',
  'android-launch'
];

const TEST_LABEL = {
  deployment: 'the deployed entry point answers a request',
  health: 'the health/read probe returns a usable response',
  'api-contract': 'the API returns the fields the generated frontend expects',
  unauthorized: 'a protected route refuses an unauthenticated request',
  register: 'registration stores a new user',
  'duplicate-register': 'registering the same address twice is rejected (409)',
  login: 'login verifies the stored hash and returns a session',
  'invalid-login': 'a wrong password is rejected (401), not accepted',
  session: 'the session token authorises a protected read',
  'invalid-input': 'invalid input is rejected before it reaches the database',
  'core-feature': 'the product\'s own core feature — the one the founder actually asked for — runs end to end in the deployed application',
  create: 'a record is created and the new id is returned',
  read: 'the created record is readable back',
  update: 'an update changes the stored record',
  delete: 'a delete removes the stored record',
  'read-missing': 'reading the deleted record returns nothing (404/absent)',
  refresh: 'data written earlier is still present on a later request',
  database: 'the real database holds the rows the API wrote through it',
  realtime: 'a write reaches a second connected client live',
  logout: 'logout invalidates the session',
  'post-logout': 'the old session is refused after logout (401)',
  'error-path': 'an unknown route answers 4xx instead of a fabricated 200',
  'fake-check': 'no fake/mock/hardcoded response is used as production success',
  'user-journey': 'the founder journey completes end to end',
  'ui-interaction': 'the UI has bound controls that change real state',
  'local-persistence': 'records persist on the device and survive a reload',
  'external-service': 'the external service is called for real',
  'android-launch': 'the built app installs and launches on a real device or emulator'
};

export function testLabel(id) { return TEST_LABEL[id] ?? id; }

// Requirement wording → the runtime tests that can evidence it. Derived from the category
// the extractor assigned plus the requirement's own title, so `REQ-001 User registration`
// demands the register + duplicate-register tests rather than "something about users".
const CATEGORY_TESTS = {
  product: ['create', 'read', 'user-journey'],
  platform: [],
  data: ['create', 'read', 'refresh'],
  api: ['deployment', 'api-contract', 'create'],
  auth: ['unauthorized', 'register', 'login', 'session', 'logout'],
  realtime: ['realtime'],
  external: ['external-service', 'error-path'],
  security: ['invalid-input', 'error-path'],
  acceptance: ['refresh', 'user-journey']
};

/**
 * The runtime tests a single requirement must evidence.
 * Falls back to the category's tests, narrowed by the requirement's own title so
 * "User registration" and "Logout" do not demand the same proof.
 */
export function requiredTestsForRequirement(requirement, architecture = null) {
  const title = String(requirement?.title ?? '').toLowerCase();
  const category = requirement?.category ?? 'product';
  const tests = new Set();

  // Point 8. A "Core feature: …" row is the founder's OWN feature, so its evidence is the
  // probe derived from that feature — not the generic CRUD round trip every product shares.
  // Without this a search/filter or reporting requirement was marked RUNTIME VERIFIED by a
  // create+read pair that never once searched or computed anything.
  if (/^core feature:/.test(title)) tests.add('core-feature');

  if (category === 'auth' || /\b(register|login|log ?in|sign ?up|logout|session|unauthor)/.test(title)) {
    if (/register|sign ?up|registration/.test(title)) { tests.add('register'); tests.add('duplicate-register'); }
    if (/login|log ?in|sign ?in|session/.test(title)) { tests.add('login'); tests.add('invalid-login'); tests.add('session'); }
    if (/logout|log ?out|sign ?out/.test(title)) { tests.add('logout'); tests.add('post-logout'); }
    if (/unauthor|401|rejected|protected/.test(title)) tests.add('unauthorized');
    if (tests.size === 0) { tests.add('register'); tests.add('login'); }
  } else if (category === 'realtime') {
    tests.add('realtime');
  } else if (category === 'external') {
    tests.add('external-service');
  } else if (category === 'data') {
    tests.add('create'); tests.add('read'); tests.add('refresh');
  } else if (category === 'api') {
    tests.add('deployment'); tests.add('api-contract'); tests.add('create');
  } else if (category === 'security') {
    if (/stub|mock|fake|placeholder/.test(title)) tests.add('fake-check');
    else { tests.add('invalid-input'); tests.add('error-path'); }
  } else if (category === 'acceptance') {
    if (/refresh|persist|reload/.test(title)) tests.add('refresh');
    else tests.add('user-journey');
  } else {
    for (const id of CATEGORY_TESTS[category] ?? []) tests.add(id);
  }
  // A local (no-backend) app evidences its product requirements through the device journey,
  // never through an HTTP endpoint it does not have. The vocabulary is TRANSLATED rather
  // than trimmed: a requirement to "create a record" is proven by the UI creating one and
  // writing it to the device store, which is exactly what `ui-interaction` and
  // `local-persistence` record — while `create`/`read`/`invalid-input` are backend tests the
  // executor never performs for a browser-only app, and demanding them would block forever.
  if (architecture && architecture.backend === false) {
    const local = new Set();
    for (const id of tests) {
      if (['ui-interaction', 'local-persistence', 'user-journey'].includes(id)) { local.add(id); continue; }
      // A browser-only app proves its core feature through the UI and its own store, which
      // is exactly what ui-interaction/local-persistence record.
      if (id === 'core-feature') { local.add('ui-interaction'); local.add('user-journey'); continue; }
      if (['create', 'read', 'update', 'delete'].includes(id)) { local.add('ui-interaction'); continue; }
      if (['refresh', 'database', 'local-persistence'].includes(id)) { local.add('ui-interaction'); local.add('local-persistence'); continue; }
      if (['invalid-input', 'error-path', 'fake-check'].includes(id)) { local.add('ui-interaction'); continue; }
      // Everything else is server-only and simply does not apply to this architecture.
    }
    // A requirement whose whole vocabulary is server-only contributes nothing here; the
    // fallback is the local app's own floor, which the executor always records.
    if (local.size === 0) { local.add('ui-interaction'); local.add('user-journey'); }
    return [...local];
  }
  return [...tests];
}

/**
 * Exactly which stages and tests this architecture owes.
 * A browser-only app is not forced to invent D1 endpoints; a backend app is not allowed to
 * substitute a page for them (spec item 9).
 */
export function runtimeObligations({ architecture = null, spec = null, files = [], hasBackend = false, platform = null, deployment = null, requirements = [] } = {}) {
  const backend = architecture ? architecture.backend === true : Boolean(hasBackend);
  const deploymentKind = runtimeDeploymentKind({ architecture, platform });
  const auth = architecture?.auth === true || spec?.authentication?.required === true;
  const realtime = architecture?.realtime === true || spec?.realtime?.required === true;
  const externalServices = spec?.externalServices ?? [];
  const data = ((spec?.dataRequirements ?? []).length > 0) || (spec?.features ?? []).some((f) => ['create', 'read', 'update', 'delete'].includes(f.key));

  const stages = new Set();
  const tests = new Set();

  // Point 8: what this product's OWN core feature is, and therefore what must be probed.
  // Derived from the specification + the delivered code; null when the founder asked for
  // no feature, in which case nothing extra is owed and nothing extra can be claimed.
  const coreFeature = coreFeatureFor({ spec, files, requirements: Array.isArray(spec?.requirements) ? spec.requirements : requirements });

  if (backend) {
    for (const id of ['deployment', 'health', 'api-contract', 'core-operation', 'database', 'crud-lifecycle', 'error-handling', 'user-journey', 'evidence']) stages.add(id);
    for (const id of ['deployment', 'health', 'api-contract', 'create', 'read', 'update', 'delete', 'read-missing', 'refresh', 'database', 'error-path', 'fake-check', 'user-journey']) tests.add(id);
    if (coreFeature) { stages.add('core-feature'); tests.add('core-feature'); }
    if (auth) {
      stages.add('authentication');
      for (const id of ['unauthorized', 'register', 'duplicate-register', 'login', 'invalid-login', 'session', 'logout', 'post-logout']) tests.add(id);
    }
  } else {
    for (const id of ['core-operation', 'error-handling', 'user-journey', 'evidence']) stages.add(id);
    // The executor records exactly these three for a browser-only app. `fake-check`,
    // `create` and `read` are backend tests it never performs without a server; requiring
    // them here would block every local app on evidence nobody was ever asked to produce.
    // Fake detection for a local app is still done — statically, by the no-false-PASS rules
    // over the delivered source, which run whether or not an acceptance run exists.
    for (const id of ['ui-interaction', 'user-journey']) tests.add(id);
    if (data) tests.add('local-persistence');
  }
  if (realtime && backend) tests.add('realtime');
  if (externalServices.length) tests.add('external-service');
  // Point 12. An APK/AAB that merely BUILDS is not runtime evidence: the packaged app has
  // to install and launch somewhere and reach its API. With no device or emulator the
  // honest verdict is ANDROID_RUNTIME = BLOCKED, so the test is owed and never silently met.
  if (deploymentKind === 'native') {
    stages.add('android-runtime');
    tests.add('android-launch');
  }

  // The obligations must be the SUPERSET of what any requirement in this specification will
  // demand as evidence. Deriving them from the architecture alone left `invalid-input` (and,
  // for a local app, `error-path`) out of the required set while a critical security
  // requirement demanded exactly that test — so every app that owed input validation was
  // permanently BLOCKED by a test nobody had asked the run to perform.
  if (Array.isArray(spec?.requirements) && spec.requirements.length) {
    const arch = architecture ?? { backend };
    for (const requirement of spec.requirements) {
      for (const testId of requiredTestsForRequirement(requirement, arch)) tests.add(testId);
    }
  }

  return {
    backend,
    auth,
    realtime,
    data,
    // What kind of deployment this project owes: a real Worker URL, an installed package,
    // or no server at all. `deploymentRequired` is what the gate checks the record against.
    deploymentKind,
    deploymentRequired: deploymentKind === 'backend' || deploymentKind === 'native',
    deploymentStatus: normalizeDeployment(deployment).status,
    // The founder's own feature, the probes it owes, and the capabilities the delivered
    // code actually exposes. Printed by the gate so "the runtime test was generic" is
    // visibly impossible.
    coreFeature: coreFeature
      ? {
        label: coreFeature.label,
        featureKeys: coreFeature.featureKeys,
        basis: coreFeature.basis,
        requirementIds: coreFeature.requirementIds,
        probes: coreFeature.probes.map((p) => ({ id: p.id, kind: p.kind, label: p.label, executable: p.executable }))
      }
      : null,
    externalServices: externalServices.map((s) => ({ key: s.key, label: s.label, envVar: s.envVar })),
    environment: backend ? 'production-like worker + D1' : 'generated app + device store',
    stages: RUNTIME_STAGES.filter((s) => stages.has(s.id)).map((s) => s.id),
    tests: RUNTIME_TESTS.filter((t) => tests.has(t)),
    requiredStages: [...stages],
    requiredTests: [...tests]
  };
}

// ---------------------------------------------------------------------------
// Point 3 + 14: things that must NEVER count as production runtime success.
// These are static signals, because the Worker cannot execute the app; the executor also
// re-checks them at runtime (a fetch that resolves a literal never reaches the network).
// ---------------------------------------------------------------------------
const FAKE_SIGNALS = [
  { code: 'fake-api', re: /fetch\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{?\s*return\s*(?:Promise\.resolve\s*\(\s*)?\{/i, why: 'fetch is replaced by a function that returns a literal response' },
  { code: 'hardcoded-success', re: /Promise\.resolve\s*\(\s*\{\s*(?:ok|success|status)\s*:/i, why: 'a resolved literal is used as an API response' },
  { code: 'hardcoded-records', re: /(?:const|let|var)\s+\w*(?:records|items|orders|users)\w*\s*=\s*\[\s*\{[^}]*\}\s*\]\s*;?\s*(?:function|const|let|var)?\s*(?:render|list)/i, why: 'a hardcoded array is rendered as the record list' },
  { code: 'todo-marker', re: /\bTODO\b|\bFIXME\b/, why: 'unfinished-work markers ship in the product' },
  { code: 'coming-soon', re: /coming soon/i, why: '"coming soon" stands in for a feature' },
  { code: 'placeholder', re: /\bsetTimeout\s*\([^)]*\)\s*;?\s*\/\/\s*(?:simulate|fake|pretend)/i, why: 'a timer simulates work that never happens' },
  { code: 'mock-api-url', re: /https?:\/\/(?:localhost|127\.0\.0\.1)?\/?examples?\/(?:api|v\d)|jsonplaceholder|mockapi|reqres\.in/i, why: 'a mock API host stands in for the product backend' }
];

/**
 * Static fake/mock detection over the delivered source. Returns violations (empty = clean).
 * Read from `no-false-pass` rules and by the executor's `fake-check` test.
 */
export function fakeRuntimeSignals(files = []) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const violations = [];
  for (const file of list) {
    if (/^package\.json$/i.test(file.path) || /(^|\/)README(\.md|\.txt)?$/i.test(file.path)) continue;
    if (!/\.(?:html?|[cm]?js|css|json|sql)$/i.test(file.path)) continue;
    const raw = String(file.content);
    // Everything except the markers is scanned with comments removed, so an example inside a
    // comment is not read as the product's own code. A TODO/FIXME or a "coming soon" is
    // different: it is text the founder's USERS see, and stripping the comment that carries
    // it is exactly how an unfinished feature used to walk straight through this rule.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // A browser-only product has no server, so its data layer lives on the device and its
    // handler answers from the store it just wrote. That is the product doing the work, not
    // a fabricated API response — so the "hardcoded success" signal only applies to a file
    // that ALSO writes nothing anywhere. Remove the store writes and this file is flagged.
    const writesPersistedState = /(?:localStorage|sessionStorage)\.(?:setItem|removeItem)\s*\(|\bindexedDB\b|\.prepare\s*\(\s*['"`](?:INSERT|UPDATE|DELETE)|\bDB\s*\.\s*prepare\s*\(/i.test(code);
    for (const signal of FAKE_SIGNALS) {
      if (signal.code === 'hardcoded-success' && writesPersistedState) continue;
      const haystack = signal.code === 'todo-marker' || signal.code === 'coming-soon' ? raw : code;
      if (signal.re.test(haystack)) violations.push({ code: signal.code, path: file.path, why: signal.why });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Requirement → runtime evidence (points 6 and 7).
// ---------------------------------------------------------------------------
/**
 * One row per requirement: the runtime test that evidences it, what was observed, and — when
 * it failed — why. `runtimeEvidence` is null when no runtime test ran, which the gate and
 * the matrix treat as BLOCKED, never as PASS.
 */
export function runtimeRequirementEvidence({ requirements = [], acceptance = null, architecture = null } = {}) {
  const tests = acceptance?.tests ?? null;
  // Point 8 asks for a row, not a badge: which endpoint was called, what was sent, what came
  // back, what the database did, which journey step this was, when, and against WHICH
  // deployment. Every one of those is read out of the run the executor already produced.
  const testedUrl = typeof acceptance?.deployment === 'string'
    ? acceptance.deployment
    : (acceptance?.deployment?.url ?? null);
  const testedAt = acceptance?.testedAt ?? null;
  const journeySteps = new Map((acceptance?.journey?.steps ?? []).map((s) => [s.id, s]));
  const deploymentRef = acceptance?.deployment?.deploymentId ?? acceptance?.deploymentId ?? testedUrl;

  return (Array.isArray(requirements) ? requirements : []).map((requirement) => {
    const required = requiredTestsForRequirement(requirement, architecture);
    const observed = [];
    let status = 'BLOCKED';
    let failureReason = null;

    if (required.length === 0) {
      // A requirement with no runtime test vocabulary (product type, platform) is structural:
      // it is satisfied by the delivered target, and a runtime test cannot observe it.
      return {
        requirementId: requirement.id ?? null,
        description: requirement.title ?? String(requirement.id ?? ''),
        critical: requirement.critical === true,
        category: requirement.category ?? 'product',
        runtimeTest: null,
        runtimeEvidence: 'structural requirement — satisfied by the delivered target',
        status: 'NOT APPLICABLE',
        failureReason: null
      };
    }
    if (!tests) {
      return {
        requirementId: requirement.id ?? null,
        description: requirement.title ?? String(requirement.id ?? ''),
        critical: requirement.critical === true,
        category: requirement.category ?? 'product',
        runtimeTest: required.join(', '),
        runtimeEvidence: null,
        status: 'BLOCKED',
        failureReason: `no runtime acceptance run exists for ${required.map(testLabel).join('; ')}`
      };
    }
    for (const id of required) {
      const test = tests[id];
      if (!test) { failureReason = `${testLabel(id)} was never executed`; observed.push({ test: id, status: 'MISSING' }); continue; }
      observed.push({ test: id, status: test.status, detail: test.detail ?? null });
      if (test.status !== 'PASS') failureReason = failureReason ?? `${testLabel(id)} failed${test.detail ? `: ${test.detail}` : ''}`;
    }
    const missing = observed.some((o) => o.status === 'MISSING');
    const failed = observed.some((o) => o.status === 'FAIL');
    status = failed ? 'FAIL' : missing ? 'BLOCKED' : 'PASS';
    // The single richest observed test is the one quoted in the row: the endpoint/action,
    // the request that was issued and the response that came back.
    const primary = observed.filter((o) => o.status === 'PASS').pop() ?? observed[0] ?? null;
    const primaryTest = primary ? tests?.[primary.test] : null;
    const journeyStep = primary ? (journeySteps.get(primary.test) ?? journeySteps.get('core-operation') ?? null) : null;
    const persistedTests = observed.filter((o) => tests?.[o.test]?.persisted === true);
    return {
      requirementId: requirement.id ?? null,
      description: requirement.title ?? String(requirement.id ?? ''),
      critical: requirement.critical === true,
      category: requirement.category ?? 'product',
      runtimeTest: required.join(', '),
      runtimeEvidence: observed.map((o) => `${o.test}:${o.status}`).join(', '),
      status,
      failureReason: status === 'PASS' ? null : failureReason,
      // ── the evidence itself, so a founder can audit the claim ──────────────
      endpoint: primaryTest?.request ?? null,
      response: primaryTest ? `HTTP ${primaryTest.responseStatus ?? '—'}${primaryTest.detail ? ` — ${primaryTest.detail}` : ''}` : null,
      responseStatus: primaryTest?.responseStatus ?? null,
      databaseEvidence: persistedTests.length
        ? persistedTests.map((o) => `${o.test}: persisted in the database`).join('; ')
        : (primaryTest?.persisted === false ? 'the write was not observed in the database' : null),
      journeyStep: journeyStep ? `${journeyStep.id}: ${journeyStep.status}` : null,
      runtimeTimestamp: testedAt,
      deploymentUrl: testedUrl,
      deploymentRef
    };
  });
}

// ---------------------------------------------------------------------------
// Point 14: the explicit no-false-PASS contract.
// ---------------------------------------------------------------------------
export const NO_FALSE_PASS_RULES = [
  { code: 'placeholder', why: 'placeholder implementation ships in the product' },
  { code: 'critical-todo', why: 'TODO/FIXME marks critical functionality as unfinished' },
  { code: 'coming-soon', why: 'a feature is announced instead of built' },
  { code: 'fake-api', why: 'a fake API is used' },
  { code: 'hardcoded-success', why: 'a hardcoded success response is used' },
  { code: 'fake-persistence', why: 'persistence is faked' },
  { code: 'mocked-result', why: 'a mocked production result is reported' },
  { code: 'browser-only-for-backend', why: 'a backend-required project shipped a browser-only page' },
  { code: 'requirement-evidence-missing', why: 'a requirement has no evidence' },
  { code: 'runtime-evidence-missing', why: 'runtime evidence is missing' },
  { code: 'journey-failed', why: 'the critical user journey failed' },
  { code: 'api-contract-mismatch', why: 'the API contract does not match the generated frontend' },
  { code: 'persistence-failed', why: 'database persistence failed' },
  { code: 'auth-flow-failed', why: 'the authentication flow failed' },
  // ── point 16: the full "never call this a PASS" contract ──────────────────────
  { code: 'no-actual-deployment', why: 'the generated project was never deployed' },
  { code: 'no-actual-url', why: 'the deployment produced no runtime URL' },
  { code: 'no-deployed-backend', why: 'a backend is required but no backend was deployed' },
  { code: 'executor-unavailable', why: 'no runtime executor was available to produce evidence' },
  { code: 'no-actual-http-test', why: 'the acceptance run did not issue real HTTP requests' },
  { code: 'no-d1-verification', why: 'D1 is required but was not verified against a real deployment' },
  { code: 'no-auth-journey', why: 'authentication is required but its full journey was not run' },
  { code: 'no-external-api-test', why: 'an external API is required but was never called for real' },
  { code: 'no-realtime-e2e', why: 'real-time is required but no two-client proof was produced' },
  { code: 'generated-tested-mismatch', why: 'the app that was tested is not the app that was generated' },
  { code: 'wrong-deployment-url', why: 'the deployment URL belongs to another project' },
  { code: 'mock-response', why: 'a mocked response was reported as production behaviour' },
  { code: 'android-runtime-missing', why: 'a native build was not run on a device or emulator' },
  { code: 'core-feature-unproven', why: "the product's own core feature was never proved in the deployed application" },
  { code: 'realtime-not-deployed', why: 'a real-time requirement was not proved between two clients of the actual deployment' },
  { code: 'journey-not-deployed', why: 'the founder journey was not executed against the actual deployment' },
  { code: 'external-api-not-called', why: 'an external API was required but no real call was issued to it' }
];

/**
 * Evaluate every no-false-PASS rule that can be judged from what the gate has: the delivered
 * source, the selected architecture, and the acceptance report (when one exists).
 * @returns {Array<{code:string, why:string, detail:string}>}
 */
export function noFalsePassViolations({
  files = [], architecture = null, fidelity = null, acceptance = null, evidence = [], hasBackend = false, runtime = true
} = {}) {
  const violations = [];
  const add = (code, detail) => {
    const rule = NO_FALSE_PASS_RULES.find((r) => r.code === code);
    violations.push({ code, why: rule?.why ?? code, detail: String(detail ?? '') });
  };

  for (const signal of fakeRuntimeSignals(files)) {
    if (signal.code === 'todo-marker') add('critical-todo', `${signal.path}: ${signal.why}`);
    else if (signal.code === 'coming-soon') add('coming-soon', `${signal.path}: ${signal.why}`);
    else if (signal.code === 'placeholder') add('placeholder', `${signal.path}: ${signal.why}`);
    else if (signal.code === 'hardcoded-records') add('fake-persistence', `${signal.path}: ${signal.why}`);
    else if (signal.code === 'mock-api-url') add('fake-api', `${signal.path}: ${signal.why}`);
    else add('fake-api', `${signal.path}: ${signal.why}`);
  }
  if (fidelity && fidelity.passed === false) {
    add('placeholder', 'the functional fidelity gate found a demo/placeholder signal: ' + (fidelity.violations ?? []).map((v) => v.code).join(', '));
  }
  const backendOwed = architecture ? architecture.backend === true : Boolean(hasBackend);
  if (backendOwed && !hasBackend) add('browser-only-for-backend', 'the selected architecture owes a Worker API but the delivered code has no backend entry point');

  // Acceptance-derived rules require an acceptance run. Without one the honest verdict is
  // BLOCKED ("no runtime evidence"), which the caller reports as its own blocking code —
  // not a FAILED masquerading as a defect in the product. `runtime:false` asks for exactly
  // the static half, so that ordering is possible.
  if (!runtime) return violations;

  if (acceptance) {
    const tests = acceptance.tests ?? {};
    if (tests['api-contract']?.status === 'FAIL') add('api-contract-mismatch', tests['api-contract'].detail ?? 'API contract mismatch');
    if (backendOwed && tests.database?.status && tests.database.status !== 'PASS') add('persistence-failed', tests.database.detail ?? 'database persistence failed');
    if (backendOwed && tests.create?.status && tests.create.status !== 'PASS') add('fake-persistence', tests.create.detail ?? 'no record was created');
    if (tests.login?.status === 'FAIL' || tests['post-logout']?.status === 'FAIL' || tests.unauthorized?.status === 'FAIL') {
      add('auth-flow-failed', [tests.unauthorized, tests.login, tests['post-logout']].filter((t) => t?.status === 'FAIL').map((t) => t.detail ?? '').join('; '));
    }
    if (tests['user-journey']?.status === 'FAIL') add('journey-failed', tests['user-journey'].detail ?? 'the critical user journey failed');
    if (tests['fake-check']?.status === 'FAIL') add('mocked-result', tests['fake-check'].detail ?? 'a mocked/fake response was used as production success');
    // Point 8: a failed core-feature probe is a defect in the product, not a missing file.
    if (tests['core-feature']?.status === 'FAIL') add('core-feature-unproven', tests['core-feature'].detail ?? "the product's own core feature failed at runtime");
    // Point 11: a real-time obligation must be proved by two clients of the DEPLOYMENT.
    // The in-process Durable Object shim is a fixture, so a run that never issued a
    // network WebSocket cannot claim the real-time requirement.
    if (tests.realtime && tests.realtime.status === 'MISSING') add('realtime-not-deployed', tests.realtime.detail ?? 'no two-client proof against the deployment');
    // Point 7: the founder journey must be the one that ran against the deployment. Only a
    // product that OWES a server can be held to that; a browser-only product has no
    // deployment to journey through and is judged on its own executed UI evidence instead.
    if (backendOwed && tests['user-journey'] && acceptance.transport === 'deployed-http' && tests['user-journey'].deployed !== true) {
      add('journey-not-deployed', tests['user-journey'].detail ?? 'the journey was executed against the local runtime instead of the deployment');
    }
    // Point 10: an external service that is required must have been called for real.
    if (tests['external-service'] && tests['external-service'].status !== 'PASS' && tests['external-service'].called !== true) {
      add('external-api-not-called', tests['external-service'].detail ?? 'no real call was issued to the external API');
    }
  }
  for (const row of (Array.isArray(evidence) ? evidence : [])) {
    // A BLOCKED row means "not executed yet", which is reported separately as missing
    // evidence. Only an executed-and-failed row is a no-false-PASS violation.
    if (row.status === 'FAIL') add('requirement-evidence-missing', `${row.requirementId ?? ''} ${row.failureReason ?? ''}`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// The acceptance verdict.
// ---------------------------------------------------------------------------
/**
 * Judge a project's production runtime acceptance.
 *
 * @param {object} input
 * @param {Array}  input.files        merged generated source
 * @param {object} [input.architecture]
 * @param {object} [input.spec]
 * @param {Array}  [input.requirements] extracted requirements (REQ ids)
 * @param {object} [input.acceptance] structured run report (see scripts/production-runtime.mjs)
 * @param {object} [input.fidelity]   analyzeGeneratedApp() output
 * @param {object} [input.credentials] map of env-var NAME → boolean availability (never values)
 * @param {boolean}[input.hasBackend] code contains a backend entry point
 * @returns {object} the runtime evidence store record (spec item 15)
 */
export function evaluateRuntimeAcceptance({
  files = [], architecture = null, spec = null, requirements = [], acceptance = null,
  fidelity = null, credentials = {}, hasBackend = false,
  deployment = null, projectId = null, platform = null,
  executorConfigured = null, controlPlaneUrls = [], expectedArtifactId = null, currentArtifactId = null
} = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const deploymentRecord = normalizeDeployment(deployment);
  const obligations = runtimeObligations({ architecture, spec, files: list, hasBackend, platform, deployment: deploymentRecord, requirements });
  const evidence = runtimeRequirementEvidence({ requirements, acceptance, architecture });
  // Point 8: the core-feature verdict is read out of the run's own per-probe rows. A run
  // that never attempted the probes leaves them absent, which is BLOCKED — the generic CRUD
  // result cannot stand in for the product's actual feature.
  const coreFeatureSpec = coreFeatureFor({ spec, files: list, requirements });
  const coreFeatureVerdict = coreFeatureSpec && acceptance
    ? judgeCoreFeature(coreFeatureSpec, acceptance.coreFeature?.probes ?? {})
    : (coreFeatureSpec ? { status: 'BLOCKED', rows: coreFeatureEvidence(coreFeatureSpec, {}), passed: 0, failed: [], missing: coreFeatureSpec.probes.map((p) => p.id), detail: 'the acceptance run probed none of the product\'s own core-feature behaviours' } : null);

  const missingTests = obligations.requiredTests.filter((id) => !acceptance?.tests?.[id]);
  const failedTests = obligations.requiredTests
    .filter((id) => acceptance?.tests?.[id]?.status === 'FAIL')
    .map((id) => ({ test: id, detail: acceptance.tests[id].detail ?? '' }));
  // A test that ran but was not proven (e.g. the app was never executed) is neither a pass
  // nor a failure — it is missing evidence, and missing evidence blocks.
  const unprovenTests = obligations.requiredTests
    .filter((id) => acceptance?.tests?.[id] && acceptance.tests[id].status !== 'PASS' && acceptance.tests[id].status !== 'FAIL')
    .map((id) => ({ test: id, detail: acceptance.tests[id].detail ?? '' }));

  // External dependencies without credentials are a declared dependency, never a fake pass.
  const unmetDependencies = obligations.externalServices
    .filter((s) => !credentials?.[s.envVar] && !credentials?.[s.key])
    .map((s) => ({ key: s.key, label: s.label, envVar: s.envVar, reason: `${s.label} has no credential (${s.envVar}) configured, so calling it for real is impossible` }));

  const noFalsePass = noFalsePassViolations({ files: list, architecture, fidelity, hasBackend, runtime: false });

  const report = {
    version: PRODUCTION_RUNTIME_VERSION,
    status: RUNTIME_STATUS.BLOCKED,
    environment: obligations.environment,
    // The deployment RECORD, not a sentence. The URL the run used, when it was deployed, which
    // artifact was deployed, and — when it failed — the category and a safe message.
    deploymentRecord,
    deploymentKind: obligations.deploymentKind,
    deployment: acceptance?.deployment ?? (obligations.backend
      ? (deploymentRecord.url ?? 'not deployed for acceptance')
      : 'generated app executed in the local runtime'),
    runtimeUrl: deploymentRecord.url,
    transport: acceptance?.transport ?? null,
    testedAt: acceptance?.testedAt ?? null,
    health: acceptance?.tests?.health?.status ?? (obligations.backend ? 'NOT TESTED' : 'N/A'),
    api: acceptance?.tests?.['api-contract']?.status ?? (obligations.backend ? 'NOT TESTED' : 'N/A'),
    database: obligations.backend ? (acceptance?.tests?.database?.status ?? 'NOT TESTED') : (acceptance?.tests?.['local-persistence']?.status ?? 'N/A'),
    authentication: obligations.auth ? (acceptance?.tests?.login?.status ?? 'NOT TESTED') : 'N/A',
    userJourney: acceptance?.tests?.['user-journey']?.status ?? 'NOT TESTED',
    realtime: obligations.realtime ? (acceptance?.tests?.realtime?.status ?? 'NOT TESTED') : 'N/A',
    // Point 8, founder-visible: which feature this product is, and whether IT passed.
    coreFeature: obligations.coreFeature,
    coreFeatureResult: coreFeatureVerdict
      ? { status: coreFeatureVerdict.status, detail: coreFeatureVerdict.detail, probes: coreFeatureVerdict.rows }
      : null,
    external: obligations.externalServices.length ? (unmetDependencies.length ? 'DEPENDENCY_REQUIRED' : 'PASS') : 'N/A',
    stages: obligations.stages,
    requiredTests: obligations.requiredTests,
    executedTests: acceptance ? Object.keys(acceptance.tests ?? {}) : [],
    missingTests,
    failedTests,
    unprovenTests,
    dependenciesRequired: unmetDependencies,
    requirements: evidence,
    criticalFailed: evidence.filter((r) => r.critical && (r.status === 'FAIL' || r.status === 'BLOCKED')).map((r) => r.requirementId),
    criticalPassed: evidence.filter((r) => r.critical && r.status === 'PASS').map((r) => r.requirementId),
    noFalsePass,
    failures: [],
    evidence: [],
    blockingReason: null,
    blockingCode: null,
    /** The founder-facing line the dashboard and delivery both print. */
    question: 'Does the delivered app deploy, run, persist data, complete the user journey and give runtime evidence for every critical requirement?'
  };

  // Static no-false-PASS violations are judged first: a placeholder or a browser-only page
  // that owed a backend is a defect in the delivered product regardless of any run.
  const staticViolations = noFalsePassViolations({ files: list, architecture, fidelity, hasBackend, runtime: false });
  if (staticViolations.length) {
    report.noFalsePass = staticViolations;
    report.status = RUNTIME_STATUS.FAILED;
    report.blockingCode = RUNTIME_BLOCKING.NO_FALSE_PASS;
    report.blockingReason = `No false PASS: ${staticViolations.map((v) => `${v.code} (${v.detail})`).join('; ')}`;
    report.failures.push(...staticViolations.map((v) => v.code));
    return report;
  }
  if (list.length === 0) {
    report.blockingCode = RUNTIME_BLOCKING.NO_CODE;
    report.blockingReason = 'No generated code exists to run a production smoke test against.';
    report.failures.push(report.blockingReason);
    return report;
  }
  // A missing credential is a declared dependency — the honest, actionable reason. It is
  // reported before the general "no evidence" case because it names exactly what to fix.
  if (unmetDependencies.length) {
    report.blockingCode = RUNTIME_BLOCKING.DEPENDENCY_REQUIRED;
    report.blockingReason = unmetDependencies.map((d) => d.reason).join('; ');
    report.failures.push(report.blockingReason);
    return report;
  }
  // ── the deployment contract ───────────────────────────────────────────────
  // A backend project's acceptance run means nothing without the URL it ran against, and
  // nothing at all without the project the URL belongs to. Each of these is BLOCKED (not
  // FAILED) because nothing has been proven wrong with the product yet — the proof was
  // never produced. Deployment failure names the category and a safe, secret-free message.
  if (obligations.deploymentRequired) {
    if (deploymentRecord.status === DEPLOYMENT_STATUS.FAILED) {
      report.blockingCode = RUNTIME_BLOCKING.DEPLOYMENT_FAILED;
      report.blockingReason = `The generated project failed to deploy — ${deploymentRecord.errorCategory ?? 'unknown error'}: ${deploymentRecord.errorMessage ?? 'the deploy runner reported a failure'}`;
      report.failures.push(report.blockingReason);
      return report;
    }
    if (deploymentRecord.status !== DEPLOYMENT_STATUS.DEPLOYED) {
      report.blockingCode = RUNTIME_BLOCKING.NO_DEPLOYMENT;
      report.blockingReason = `The generated project has not been deployed (deployment status: ${deploymentRecord.status}). A backend product is proved by running its own deployed URL, not its source.`;
      report.failures.push(report.blockingReason);
      return report;
    }
    if (!deploymentRecord.url) {
      report.blockingCode = RUNTIME_BLOCKING.NO_DEPLOYMENT_URL;
      report.blockingReason = 'The deployment reported DEPLOYED but produced no URL, so there is nothing to send real HTTP requests to.';
      report.failures.push(report.blockingReason);
      return report;
    }
    // Point 13: an unconfigured executor must never mean a silent skip. For a project that
    // owes a deployed backend it is an explicit BLOCKED, named as a dependency.
    if (executorConfigured === false) {
      report.blockingCode = RUNTIME_BLOCKING.EXECUTOR_UNAVAILABLE;
      report.blockingReason = 'No runtime executor is configured (MAULI_RUNTIME_EXECUTOR), so no real HTTP run can be produced for this deployed backend project. This is BLOCKED, never a skip and never a PASS.';
      report.failures.push(report.blockingReason);
      return report;
    }
  }
  // Point 17: project ↔ artifact ↔ deployment ↔ evidence ↔ matrix ↔ delivery must be one
  // chain. A run produced for another project, a URL that is not this project's, or a
  // source-level run standing in for a deployed one, is BLOCKED.
  const identity = assertRuntimeIdentity({
    projectId, acceptance, deployment: deploymentRecord,
    controlPlaneUrls, expectedArtifactId, currentArtifactId, required: obligations.deploymentRequired
  });
  if (!identity.ok) {
    report.blockingCode = RUNTIME_BLOCKING.IDENTITY_MISMATCH;
    report.blockingReason = `Generated project identity check failed: ${identity.violations.map((v) => `${v.code} (${v.why})`).join('; ')}`;
    report.failures.push(...identity.violations.map((v) => v.code));
    return report;
  }
  // Point 12: a native build that was never installed is not runtime evidence.
  if (obligations.deploymentKind === 'native' && acceptance && acceptance.tests?.['android-launch']?.status !== 'PASS') {
    report.blockingCode = RUNTIME_BLOCKING.ANDROID_RUNTIME_UNAVAILABLE;
    report.blockingReason = `ANDROID_RUNTIME is BLOCKED: the package${acceptance.tests['android-launch'] ? ' was built but never launched on a device or emulator' : ' was built but no device or emulator is available to run it on'}. An APK/AAB build is not runtime evidence.`;
    report.failures.push(report.blockingReason);
    return report;
  }
  if (!acceptance) {
    report.blockingCode = RUNTIME_BLOCKING.EVIDENCE_MISSING;
    report.blockingReason = obligations.backend
      ? 'No production runtime acceptance run exists for this project. The generated Worker must be executed against a real D1 (create → read → update → read → delete → read-missing), its auth flow exercised, and the result recorded before delivery.'
      : 'No runtime acceptance run exists for this project. The generated app must be executed (UI interaction, persistence, core journey) before delivery.';
    report.failures.push(report.blockingReason);
    return report;
  }

  // The run exists, so the runtime half of the contract applies: a static JSON body, a
  // failed journey or a contract mismatch is a FAILED acceptance, not a blocked one.
  const runtimeViolations = noFalsePassViolations({ files: list, architecture, fidelity, acceptance, evidence, hasBackend, runtime: true });
  report.noFalsePass = runtimeViolations;
  if (runtimeViolations.length) {
    report.status = RUNTIME_STATUS.FAILED;
    report.blockingCode = RUNTIME_BLOCKING.NO_FALSE_PASS;
    report.blockingReason = `No false PASS: ${runtimeViolations.map((v) => `${v.code} (${v.detail})`).join('; ')}`;
    report.failures.push(...runtimeViolations.map((v) => v.code));
    return report;
  }

  report.evidence = [];
  for (const id of obligations.requiredTests) {
    const test = acceptance.tests?.[id];
    report.evidence.push({
      test: id,
      label: testLabel(id),
      status: test?.status ?? 'MISSING',
      detail: test?.detail ?? null,
      request: test?.request ?? null,
      responseStatus: test?.responseStatus ?? null,
      persisted: test?.persisted ?? null
    });
  }

  if (failedTests.length) {
    report.status = RUNTIME_STATUS.FAILED;
    report.blockingCode = RUNTIME_BLOCKING.RUNTIME_FAILED;
    report.blockingReason = `Production runtime test(s) failed: ${failedTests.map((f) => `${f.test} (${f.detail})`).join('; ')}`;
    report.failures.push(...failedTests.map((f) => f.test));
    return report;
  }
  if (missingTests.length || unprovenTests.length) {
    report.blockingCode = RUNTIME_BLOCKING.EVIDENCE_INCOMPLETE;
    report.blockingReason = `Production runtime evidence is incomplete: ${[...missingTests, ...unprovenTests.map((u) => u.test)].map(testLabel).join('; ')} was never proven against the generated application.`;
    report.failures.push(...missingTests);
    return report;
  }

  const criticalWithoutEvidence = evidence.filter((r) => r.critical && r.status !== 'PASS');
  if (criticalWithoutEvidence.length) {
    report.status = RUNTIME_STATUS.BLOCKED;
    report.blockingCode = RUNTIME_BLOCKING.EVIDENCE_INCOMPLETE;
    report.blockingReason = `Critical requirement(s) have no passing runtime evidence: ${criticalWithoutEvidence.map((r) => `${r.requirementId} ${r.description} — ${r.failureReason}`).join('; ')}`;
    report.failures.push(...criticalWithoutEvidence.map((r) => r.requirementId));
    return report;
  }

  report.status = RUNTIME_STATUS.PASSED;
  return report;
}

/**
 * Can this evidence be relied on? A report is rejected when it is not shaped like an
 * acceptance run. Guards a stored record written by an older/partial integration.
 */
export function isRuntimeAcceptanceReport(value) {
  if (!value || typeof value !== 'object') return false;
  if (!['passed', 'failed', 'blocked'].includes(String(value.status))) return false;
  if (!value.tests || typeof value.tests !== 'object') return false;
  return Object.keys(value.tests).length > 0;
}

/** Dashboard/report projection: the founder sees status and reason, never a bare "QA Passed". */
export function describeRuntimeAcceptance(record) {
  if (!record) {
    return {
      status: 'BLOCKED', label: 'BLOCKED', reason: 'Production runtime acceptance has not run for this project.',
      testedAt: null, deployment: null, deploymentStatus: DEPLOYMENT_STATUS.NOT_DEPLOYED, runtimeUrl: null,
      api: null, database: null, authentication: null, userJourney: null,
      criticalPassed: 0, criticalFailed: 0, finalDelivery: 'BLOCKED',
      blockingReason: 'Production runtime acceptance has not run for this project.'
    };
  }
  const passed = record.status === RUNTIME_STATUS.PASSED;
  const dep = record.deploymentRecord ?? normalizeDeployment(record.deployment);
  return {
    status: String(record.status ?? 'blocked').toUpperCase(),
    label: passed ? 'PASS' : record.status === RUNTIME_STATUS.FAILED ? 'FAILED' : 'BLOCKED',
    reason: record.blockingReason ?? (passed ? 'Every critical requirement has passing runtime evidence.' : null),
    testedAt: record.testedAt ?? null,
    deployment: record.deployment ?? null,
    // Point 21: the founder sees deployment and the actual URL as their own lines, never
    // folded into "QA passed".
    deploymentStatus: dep.status,
    runtimeUrl: dep.url ?? (typeof record.deployment === 'string' ? record.deployment : null),
    deploymentId: dep.deploymentId ?? null,
    deployedAt: dep.deployedAt ?? null,
    deploymentError: dep.errorMessage ? { category: dep.errorCategory, message: dep.errorMessage } : null,
    transport: record.transport ?? null,
    // Point 21: Final Delivery READY / BLOCKED, stated next to the runtime verdict.
    finalDelivery: passed ? 'READY' : 'BLOCKED',
    api: record.api ?? null,
    database: record.database ?? null,
    authentication: record.authentication ?? null,
    userJourney: record.userJourney ?? null,
    realtime: record.realtime ?? null,
    external: record.external ?? null,
    criticalPassed: (record.criticalPassed ?? []).length,
    criticalFailed: (record.criticalFailed ?? []).length,
    blockingReason: record.blockingReason ?? null,
    blockingCode: record.blockingCode ?? null,
    environment: record.environment ?? null,
    missingTests: record.missingTests ?? [],
    failedTests: (record.failedTests ?? []).map((f) => f.test ?? f)
  };
}

/**
 * Cheap, per-project projection for list payloads (/api/state, dashboards).
 * It never runs the engine — a list route serves dozens of rows per poll — so it reports
 * the STORED verdict when one exists and, when none does, the honest reason there is not
 * one. A browser-only architecture is named as such rather than as a failure, because it
 * owes no server to deploy; anything else that has never been run is BLOCKED, never PASS.
 */
export function describeStoredRuntimeAcceptance(project) {
  if (!project) return describeRuntimeAcceptance(null);
  if (project.runtimeAcceptanceReport) return describeRuntimeAcceptance(project.runtimeAcceptanceReport);
  // No verdict stored yet. Whether that is a normal "not run yet" or an actual blocker
  // depends on the deployment the project owes, and the founder can see which.
  const dep = normalizeDeployment(project.runtimeDeployment);
  const projected = {
    ...describeRuntimeAcceptance(null),
    deploymentStatus: dep.status,
    runtimeUrl: dep.url,
    deployment: dep.url ?? dep.errorMessage ?? dep.status
  };
  if (project.architecture && project.architecture.backend === false) {
    // A local app owes no acceptance RUN, so there is nothing to be "not run yet". Its Final
    // Delivery is READY exactly when the project actually completed — the scheduler only marks
    // a project completed after the delivery built with enforceGates, and for a browser-only
    // project that gate passed on its own local bar (UI interaction + device persistence).
    // Reporting BLOCKED here contradicted a finished, delivered project in the Projects table.
    const completed = project.state === 'completed';
    return {
      ...projected,
      status: 'not-run',
      label: 'LOCAL',
      finalDelivery: completed ? 'READY' : 'BLOCKED',
      blockingReason: completed ? null : projected.blockingReason,
      reason: 'Browser-only architecture: there is no server to deploy. The production-runtime gate judges UI interaction, persistence and requirement evidence from executed source — open Project Details for the verdict.'
    };
  }
  if (dep.status === DEPLOYMENT_STATUS.FAILED) {
    return { ...projected, reason: `Deployment failed (${dep.errorCategory ?? 'unknown'}): ${dep.errorMessage ?? 'see the deployment record'}`, blockingReason: projected.reason };
  }
  if (dep.status === DEPLOYMENT_STATUS.NOT_DEPLOYED) {
    return { ...projected, reason: 'Not deployed yet — a backend project must be deployed before its runtime acceptance can be produced.' };
  }
  return projected;
}

/**
 * Does this file set contain a server entry point? A Worker, an API or a server module — not
 * a page that merely mentions the word "database". Shared so the gate, the delivery and the
 * acceptance executor cannot disagree about what a backend is.
 */
export function hasBackendEntryPoint(files) {
  return (Array.isArray(files) ? files : []).some((f) =>
    f && typeof f.path === 'string' && (
      /(?:^|\/)(?:worker|api|server|backend|routes?)\/[a-z0-9_-]+\.[cm]?js$/i.test(f.path)
      || /(?:^|\/)(?:worker|api|server)\.[cm]?js$/i.test(f.path)
    ));
}

/**
 * The legacy runtime-evidence projection. The requirement matrix and the quality score read
 * `{executed, verdict, evidence}` keyed by the RUNTIME_EVIDENCE_KEYS vocabulary; the
 * acceptance report is keyed by test id. One adapter, so a persisted acceptance run also
 * satisfies every reader that existed before it did.
 */
export function toRuntimeEvidenceProjection(acceptance) {
  if (!acceptance?.tests) return null;
  const t = acceptance.tests;
  const ok = (id) => t[id]?.status === 'PASS';
  const passedSteps = Object.entries(t).filter(([, v]) => v.status === 'PASS').map(([k]) => k);
  return {
    executed: true,
    verdict: acceptance.status === RUNTIME_STATUS.PASSED ? 'functional' : 'not-functional',
    passedSteps,
    steps: Object.keys(t),
    rowsInDb: acceptance.rowsInDb ?? null,
    testedAt: acceptance.testedAt ?? null,
    transport: acceptance.transport ?? null,
    evidence: {
      persistence: ok('refresh'),
      create: ok('create'),
      read: ok('read'),
      update: ok('update'),
      delete: ok('delete'),
      backend: ok('deployment'),
      validation: ok('invalid-input'),
      database: ok('database'),
      auth_register: ok('register'),
      auth_login: ok('login'),
      auth_protected: ok('unauthorized') || ok('session'),
      logout: ok('post-logout'),
      realtime: ok('realtime'),
      external: ok('external-service'),
      error_handling: ok('error-path')
    }
  };
}

// ---------------------------------------------------------------------------
// Running the acceptance when the Worker cannot execute generated code.
//
// The Worker deliberately does not execute untrusted code (free-tier CPU budget + sandbox
// boundary), so execution happens in a runner: Node locally/CI, or an HTTP runner
// (MAULI_RUNTIME_EXECUTOR) in production. Either way the evidence is REAL — the engine never
// fabricates a PASS when no runner is configured.
// ---------------------------------------------------------------------------
export function runtimeExecutorConfigured(env) {
  const hosted = (env?.GITHUB_TOKEN || env?.MAULI_GITHUB_TOKEN || env?.GITHUB_PAT)
    && (env?.MAULI_CONTROL_PLANE_URL || env?.PUBLIC_BASE_URL || 'https://mauli-2-0.kalpeshpatil4694.workers.dev');
  return Boolean((env?.MAULI_RUNTIME_EXECUTOR && String(env.MAULI_RUNTIME_EXECUTOR).trim()) || hosted);
}

/**
 * Ask the configured runtime runner to execute the acceptance and return its structured
 * report. A runner that answers anything other than a valid report yields `null`, and the
 * gate then reports BLOCKED with an exact reason — never a fabricated PASS.
 */
export async function dispatchRuntimeAcceptance(env, { project, files, spec, architecture, requirements = [] } = {}) {
  const url = env?.MAULI_RUNTIME_EXECUTOR;
  if (!url) return { dispatched: false, reason: 'MAULI_RUNTIME_EXECUTOR is not configured', acceptance: null };
  const payload = {
    projectId: project?.id ?? null,
    objective: project?.objective ?? '',
    platform: project?.platform ?? null,
    architecture: architecture ?? null,
    spec: spec ?? null,
    // The runner must test THIS project's deployed URL. Without it the runner falls back to
    // executing the source locally, which is a fixture — the engine then BLOCKEDs it.
    deployment: normalizeDeployment(project?.runtimeDeployment ?? null),
    requirements: requirements.map((r) => ({ id: r.id, title: r.title, category: r.category, critical: r.critical === true })),
    files: (files ?? []).map((f) => ({ path: f.path, content: f.content }))
  };
  const headers = { 'Content-Type': 'application/json' };
  if (env?.MAULI_RUNTIME_EXECUTOR_TOKEN) headers.Authorization = `Bearer ${env.MAULI_RUNTIME_EXECUTOR_TOKEN}`;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!response.ok) return { dispatched: true, reason: `runtime runner answered ${response.status}`, acceptance: null };
    const body = await response.json().catch(() => null);
    const acceptance = body?.runtimeAcceptance ?? body;
    return { dispatched: true, reason: null, acceptance: isRuntimeAcceptanceReport(acceptance) ? acceptance : null };
  } catch (error) {
    return { dispatched: true, reason: `runtime runner unreachable: ${error?.message ?? error}`, acceptance: null };
  }
}

export default evaluateRuntimeAcceptance;
