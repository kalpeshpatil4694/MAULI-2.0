import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractRequirementSpec, requirementId, resetRequirementIds } from '../src/requirement-spec.js';
import { selectArchitecture, architectureEvidenceNeeds } from '../src/architecture.js';
import { buildRequirementMatrix, buildTraceability, scoreGeneratedAppQuality, dualStatus, QUALITY_CATEGORIES } from '../src/requirement-matrix.js';
import { generateFullStackApp, domainEntity } from '../src/fullstack-codegen.js';
import { generateFromTemplate, getAvailableTemplates } from '../src/app-templates.js';
import { analyzeGeneratedApp } from '../src/generated-app-quality.js';

const SHOP = 'Build a coffee shop order app with login, registration and live order updates for staff';
const MEDICINE = 'Build a medicine timetable tracker for my mother';

function syntaxIsValid(code, label) {
  const dir = mkdtempSync(join(tmpdir(), 'mauli-gen-'));
  const file = join(dir, `${label}.mjs`);
  writeFileSync(file, code);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// 1. Exact requirement extraction
// ---------------------------------------------------------------------------

test('a founder command becomes a structured specification with stable REQ ids', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  assert.equal(spec.specVersion, 2);
  assert.ok(spec.requirements.length >= 8, `expected several requirements, got ${spec.requirements.length}`);
  assert.ok(spec.requirements.every((r) => /^REQ-\d{3}$/.test(r.id)), 'every requirement needs a stable REQ-### id');
  assert.equal(new Set(spec.requirements.map((r) => r.id)).size, spec.requirements.length, 'ids must be unique');
});

test('the specification covers every dimension the founder can be held to', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  for (const field of [
    'productType', 'platform', 'roles', 'features', 'inputs', 'outputs',
    'businessRules', 'dataRequirements', 'authentication', 'apis',
    'externalServices', 'realtime', 'security', 'acceptanceCriteria'
  ]) {
    assert.ok(spec[field] !== undefined, `specification is missing ${field}`);
  }
  assert.ok(spec.authentication.required, 'login/registration in the command must require authentication');
  assert.ok(spec.realtime.required, '"live order updates" must be read as a real-time requirement');
  assert.ok(spec.roles.some((r) => r.key === 'staff'), 'the staff role must be extracted');
  assert.ok(spec.apis.length > 0, 'a data product must declare the API contract it owes');
});

test('requirement ids are stable across two extractions of the same command', () => {
  resetRequirementIds();
  const a = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const b = extractRequirementSpec({ command: SHOP, platform: 'web' });
  assert.deepEqual(a.requirements.map((r) => r.id), b.requirements.map((r) => r.id));
  assert.match(requirementId(), /^REQ-\d{3}$/);
});

test('a command MAULI cannot understand is BLOCKED, never rounded up to complete', () => {
  const spec = extractRequirementSpec({ command: 'Build me something', platform: 'web' });
  assert.equal(spec.understanding, 'BLOCKED');
  assert.equal(spec.productType, null);
});

// The laundry command is a domain MAULI has no catalogue entry for, and MAULI read it as
// BLOCKED with no CRUD at all — a shop app with no way to register a garment.
test('an unlisted domain with clear behaviour is PARTIAL on the founder\'s own noun, not BLOCKED', () => {
  const command = 'Build a laundry pickup and drop-off app where the shop owner logs in, staff register each garment, and the counter screen updates live when a new pickup comes in';
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);

  assert.equal(spec.understanding, 'PARTIAL', 'an unverified domain is never rounded up to COMPLETE');
  assert.equal(spec.productType, 'domain');
  assert.equal(spec.inferredFromDomain, 'laundry');
  assert.ok(spec.features.some((f) => f.key === 'create'), '"register each garment" is a create action');
  assert.equal(architecture.realtime, true);
  assert.equal(architecture.backend, true);
  assert.equal(domainEntity(spec), 'laundry', 'the founder\'s own noun becomes the entity, not a generic "record"');
});

test('a single-user tracker is understood without inventing accounts or a server', () => {
  const spec = extractRequirementSpec({ command: MEDICINE, platform: 'web' });
  assert.equal(spec.understanding, 'COMPLETE');
  assert.equal(spec.productType, 'health');
  assert.equal(spec.authentication.required, false, '"tracker" must not invent a login requirement');
  assert.equal(spec.realtime.required, false, '"tracker" must not invent a real-time requirement');
});

// The FINAL ACCEPTANCE command was read as "not real-time" because the founder wrote
// "the counter screen updates live" — the live word comes AFTER the verb. That command
// produced a product with no live channel at all.
test('real-time is recognised in the order founders actually write it', () => {
  const wanted = [
    'Build a bakery order app where the shop owner logs in, staff take orders at the counter, and the counter screen updates live when a new order comes in',
    'Build a clinic queue app where the reception screen shows live when a doctor calls the next patient',
    'Build a collaborative board where the other person sees my changes instantly',
    'Build a delivery tracker where the map refreshes automatically',
    'Build an expense tracker where the total updates live'
  ];
  const notWanted = [
    MEDICINE,
    'Build a habit tracker',
    'Build a todo list app',
    'Build a pomodoro timer',
    'Build a Wi-Fi security auditor for my home network'
  ];
  for (const command of wanted) {
    const architecture = selectArchitecture(extractRequirementSpec({ command, platform: 'web' }));
    assert.equal(architecture.realtime, true, `"${command.slice(0, 48)}…" must be read as a live-update product`);
  }
  for (const command of notWanted) {
    const architecture = selectArchitecture(extractRequirementSpec({ command, platform: 'web' }));
    assert.equal(architecture.realtime, false, `"${command.slice(0, 48)}…" must not invent a live-update requirement`);
  }
});

// ---------------------------------------------------------------------------
// 4. Real architecture selection
// ---------------------------------------------------------------------------

test('architecture is selected per requirement, not fixed for every project', () => {
  const offline = selectArchitecture(extractRequirementSpec({ command: MEDICINE, platform: 'web' }));
  const realtime = selectArchitecture(extractRequirementSpec({ command: SHOP, platform: 'web' }));
  const native = selectArchitecture(extractRequirementSpec({ command: 'Build a habit tracker for Android', platform: 'android' }));

  assert.equal(offline.backend, false);
  assert.equal(offline.database, 'local');
  assert.equal(realtime.backend, true);
  assert.equal(realtime.database, 'd1');
  assert.equal(realtime.auth, true);
  assert.equal(realtime.realtime, true);
  assert.equal(native.native, true);

  assert.notEqual(offline.id, realtime.id, 'different requirements must not share one architecture');
  assert.ok(realtime.layers.some((l) => l.id === 'durable-object'), 'a live-update product owes a Durable Object');
  assert.ok(realtime.obligations.some((o) => o.id === 'realtime-channel'));
});

test('a business product owes a server even when nobody said login', () => {
  const architecture = selectArchitecture(extractRequirementSpec({ command: 'Create a simple e-commerce platform', platform: 'web' }));
  assert.equal(architecture.backend, true, 'a store\'s orders belong to the business, not to one phone');
  assert.ok(architectureEvidenceNeeds(architecture).some((n) => n.id === 'worker-route'));
});

// ---------------------------------------------------------------------------
// 2 / 13. Traceability and the requirement matrix gate
// ---------------------------------------------------------------------------

test('every requirement is traced from requirement through to a result', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture);
  const fidelity = analyzeGeneratedApp(built.files, { objective: SHOP });
  const matrix = buildRequirementMatrix({ requirements: spec.requirements, files: built.files, fidelity, architecture });

  const trace = buildTraceability({
    project: { architecture }, spec, matrix,
    tasks: [{ id: 'task-backend', title: 'Implement backend code and API', assignedAgentId: 'agent-1' }],
    artifacts: [{ type: 'code-workspace', content: { files: built.files } }]
  });

  assert.deepEqual(trace.chain, ['Requirement', 'Design', 'Task', 'Agent', 'File/Module', 'API', 'DB', 'Test', 'Result']);
  assert.equal(trace.rows.length, spec.requirements.length);
  for (const row of trace.rows) {
    assert.match(row.requirementId, /^REQ-\d{3}$/);
    assert.ok(row.requirement, 'the requirement itself must be named');
    assert.ok(row.design, 'the design statement must be recorded');
    assert.ok(row.result, 'a result status must be produced for every requirement');
    assert.ok(row.files.length > 0, 'a requirement must resolve to real generated files');
  }
});

test('a critical requirement that FAILs makes the project NOT DELIVERABLE', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const architecture = selectArchitecture(spec);
  // A page that renders, persists nothing and never touches an API: functional-looking,
  // and nowhere near the product that was requested.
  const demo = [{ path: 'www/index.html', content: '<!DOCTYPE html><html><body><h1>Orders</h1></body></html>' }];
  const matrix = buildRequirementMatrix({ requirements: spec.requirements, files: demo, architecture });

  assert.equal(matrix.deliverable, false);
  assert.ok(matrix.criticalFailed.length > 0, 'at least one critical requirement must be reported as failed');
  assert.ok(matrix.criticalFailed.every((r) => /^REQ-\d{3}$/.test(r.id)), 'a failure must name the requirement id the founder can check');
});

test('a server-only requirement is not held against an app that has no server', () => {
  const spec = extractRequirementSpec({ command: MEDICINE, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture);
  const fidelity = analyzeGeneratedApp(built.files, { objective: MEDICINE });
  const matrix = buildRequirementMatrix({ requirements: spec.requirements, files: built.files, fidelity, architecture });
  const serverOnly = matrix.rows.find((r) => r.title.includes('Backend API'));
  assert.ok(serverOnly, 'a data product still declares the API contract it would owe');
  assert.equal(serverOnly.critical, true, 'it is a critical requirement when the architecture has a server');
  assert.equal(serverOnly.status, 'NOT APPLICABLE', 'a local app must not fail for having no server API');
  assert.match(serverOnly.basis, /no backend/);
  assert.equal(matrix.deliverable, true, 'a complete local product must still be deliverable');
});

test('runtime evidence outranks keyword evidence when both are available', () => {
  const spec = extractRequirementSpec({ command: MEDICINE, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture);
  const fidelity = analyzeGeneratedApp(built.files, { objective: MEDICINE });
  const withRuntime = buildRequirementMatrix({
    requirements: spec.requirements, files: built.files, fidelity, architecture,
    runtime: { executed: true, evidence: { persistence: true, create: true, read: true } }
  });
  const withoutRuntime = buildRequirementMatrix({ requirements: spec.requirements, files: built.files, fidelity, architecture });
  const row = (matrix) => matrix.rows.find((r) => r.title.includes('Persistence'));
  assert.equal(row(withRuntime).basis.startsWith('runtime execution'), true, `expected runtime basis, got ${row(withRuntime).basis}`);
  assert.notEqual(row(withoutRuntime).basis, row(withRuntime).basis, 'a source-only verdict must be distinguishable');
});

// ---------------------------------------------------------------------------
// 5 / 6 / 7 / 8 / 11. The generated product itself
// ---------------------------------------------------------------------------

test('the generated product is syntactically real code, not a description of code', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const built = generateFullStackApp(spec, selectArchitecture(spec));
  const worker = built.files.find((f) => f.path === 'worker/index.js');
  const frontend = built.files.find((f) => f.path === 'www/app.js');
  assert.ok(worker, 'a backend product must ship a Worker entry point');
  syntaxIsValid(worker.content, 'worker');
  syntaxIsValid(frontend.content, 'app');
  assert.ok(built.files.some((f) => f.path.endsWith('.sql')), 'the database schema must ship with the app');
});

test('the frontend calls the API it was given, not a hardcoded result', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const built = generateFullStackApp(spec, selectArchitecture(spec));
  const frontend = built.files.find((f) => f.path === 'www/app.js').content;
  assert.ok(frontend.includes(`'/api/${built.table}s'`), 'the page must address the real resource');
  assert.ok(/fetch\(/.test(frontend), 'the page must call fetch');
  assert.ok(!/Promise\.resolve\(\s*\{/.test(frontend), 'a faked API response is a refusal, not a fallback');
});

test('the entity comes from the founder\'s domain, not a fixed word', () => {
  assert.equal(domainEntity(extractRequirementSpec({ command: SHOP, platform: 'web' })), 'order');
  assert.equal(domainEntity(extractRequirementSpec({ command: 'Build a CRM for my sales team', platform: 'web' })), 'lead');
});

// ---------------------------------------------------------------------------
// 15 / 16. Quality score and the two independent statuses
// ---------------------------------------------------------------------------

test('the quality score reports all ten categories and never claims 100% without evidence', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture);
  const fidelity = analyzeGeneratedApp(built.files, { objective: SHOP });
  const empty = scoreGeneratedAppQuality({ matrix: null, fidelity: null, runtime: null, architecture, files: [] });

  assert.deepEqual(Object.keys(empty.categories).sort(), [...QUALITY_CATEGORIES].sort());
  assert.equal(empty.overall, 0, 'no evidence is no score');
  assert.equal(empty.functionalClaim, false, 'a score with no evidence must never be a 100% functional claim');
  assert.ok(empty.weakest, 'the weakest category must be named');

  const proven = scoreGeneratedAppQuality({
    matrix: buildRequirementMatrix({ requirements: spec.requirements, files: built.files, fidelity, architecture }),
    fidelity, architecture, files: built.files, integrity: { valid: true },
    runtime: { executed: true, steps: [1, 2, 3, 4], passedSteps: [1, 2, 3, 4], evidence: { persistence: true, backend: true, database: true, validation: true, auth_protected: true, error_handling: true } }
  });
  assert.ok(proven.overall > empty.overall, 'executed evidence must raise the score');
  assert.equal(typeof proven.functionalClaim, 'boolean');
});

test('functional and founder-requirement-complete are reported as separate statuses', () => {
  const spec = extractRequirementSpec({ command: SHOP, platform: 'web' });
  const architecture = selectArchitecture(spec);
  // A working app that is not the requested product: fidelity passes, requirements do not.
  const wrong = generateFullStackApp(extractRequirementSpec({ command: 'Build a pomodoro timer', platform: 'web' }), selectArchitecture(extractRequirementSpec({ command: 'Build a pomodoro timer', platform: 'web' })));
  const fidelity = analyzeGeneratedApp(wrong.files, { objective: 'Build a pomodoro timer' });
  const matrix = buildRequirementMatrix({ requirements: spec.requirements, files: wrong.files, fidelity, architecture });
  const status = dualStatus({ matrix, fidelity });

  assert.equal(status.functional, 'FUNCTIONAL', 'the app does run');
  assert.equal(status.founderRequirementComplete, 'REQUIREMENT NOT VERIFIED', 'it is still not the product that was asked for');
  assert.match(status.note, /independent/i);
});

// ---------------------------------------------------------------------------
// 20. No regression: every existing template still satisfies its own matrix
// ---------------------------------------------------------------------------

test('all shipped templates satisfy the requirement matrix for their own domain', () => {
  const names = getAvailableTemplates();
  assert.ok(names.length >= 25, `expected the template library to be intact, got ${names.length}`);
  const blocked = [];
  for (const name of names) {
    const objective = `Build a ${name.replace(/-/g, ' ')} app`;
    const spec = extractRequirementSpec({ command: objective, platform: 'web' });
    const architecture = selectArchitecture(spec);
    const generated = generateFromTemplate({ objective });
    const files = generated.files ?? [];
    if (!files.length) continue;
    const fidelity = analyzeGeneratedApp(files, { objective });
    const matrix = buildRequirementMatrix({ requirements: spec.requirements, files, fidelity, architecture });
    if (!matrix.deliverable) blocked.push(`${name}: ${matrix.criticalFailed.map((r) => r.id).join(',')}`);
  }
  assert.deepEqual(blocked, [], `templates that no longer satisfy their requirements: ${blocked.join(' | ')}`);
});
