// Regression coverage for the "Call recording application completed but nothing to
// download" report plus the frozen Tasks/Artifacts counters:
//  1. scheduler.runTask completed tasks without persisting verificationId, so
//     finalizeCommand's qa/integrity checks and buildFinalDelivery's security-evidence
//     check could never pass — no final-delivery artifact, nothing to download.
//  2. /api/state capped its lists (100/300/100) and the dashboard counted the capped
//     arrays, so the counters froze even as the store grew.
import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';
import { registerExecutor } from '../src/execution.js';
import { runTask, schedulerTick } from '../src/scheduler.js';
import { buildFinalDelivery } from '../src/delivery.js';
import { createTask, assignTask } from '../src/tasks.js';
import { registerArtifact } from '../src/artifacts.js';
import { GATES, ensureProjectPipeline } from '../src/pipeline-gates.js';

const TAIL = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

registerExecutor('internal.plan', async () => ({ type: 'plan', summary: 'ok' }), { scope: 'internal' });

test('runTask persists the verificationId on scheduler-completed tasks', async () => {
  seedAgents();
  const suffix = TAIL();
  const pid = `p-${suffix}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Call recording application', state: 'active' });
  const task = createTask({ projectId: pid, title: 'Implement call recorder', requiredCapabilities: ['frontend'], executor: 'internal.plan' });

  const outcome = await runTask(task.id);
  assert.equal(outcome.status, 'completed');
  const stored = store.get('tasks', task.id);
  assert.equal(stored.state, 'completed');
  assert.ok(stored.verificationId, 'a scheduler-completed task must carry its verificationId');
  const verification = store.get('verifications', stored.verificationId);
  assert.ok(verification, 'the referenced verification record must exist');
});

function seedFinishedProject(pid, { withVerificationIds = true } = {}) {
  store.put('projects', { id: pid, name: 'P', objective: 'Call recording application', requirements: ['x'], state: 'completed' });
  store.put('tasks', { id: `${pid}-gen`, projectId: pid, title: 'Generate app', state: 'completed', verificationId: withVerificationIds ? 'v-gen' : undefined, requiredCapabilities: ['frontend'] });
  for (const type of GATES) {
    store.put('tasks', {
      id: `${pid}-gate-${type}`, projectId: pid, title: `Pipeline gate: ${type}`,
      state: 'completed', pipelineGate: true, gateType: type,
      requiredCapabilities: type === 'security' ? ['security'] : ['verification'],
      verificationId: withVerificationIds ? `v-${type}` : undefined,
    });
  }
  store.put('tasks', { id: `${pid}-qa`, projectId: pid, title: 'Final project QA gate', state: 'completed', finalProjectVerification: true, pipelineGate: true, gateType: 'qa', verificationId: withVerificationIds ? 'v-qa' : undefined });
}

test('buildFinalDelivery succeeds once every gate check can pass', () => {
  seedAgents();
  const pid = `p-${TAIL()}`;
  seedFinishedProject(pid);

  const delivery = buildFinalDelivery(store.get('projects', pid), { enforceGates: true });
  assert.equal(delivery.type, 'final-delivery');
  assert.ok(delivery.id, 'delivery artifact must have an id');
  assert.equal(delivery.metadata.downloadPath, `/api/artifacts/${delivery.id}/download`);
});

test('a completed project without a delivery is finalized by the next scheduler tick', async () => {
  seedAgents();
  const pid = `p-${TAIL()}`;
  seedFinishedProject(pid);
  assert.ok(!store.list('artifacts').some(a => a.projectId === pid));

  await schedulerTick({}, { budgetMs: 1000 });

  const project = store.get('projects', pid);
  assert.ok(project.finalDeliveryId, 'self-heal must attach a final delivery to the completed project');
  const delivery = store.get('artifacts', project.finalDeliveryId);
  assert.equal(delivery?.type, 'final-delivery');
});

test('finalizeCommand repairs completed tasks whose verificationId was never persisted', async () => {
  seedAgents();
  const pid = `p-${TAIL()}`;
  seedFinishedProject(pid, { withVerificationIds: false });
  // Simulate every task the old scheduler ever completed: state completed, no
  // verificationId on the row, but the verification itself exists in the store.
  store.put('verifications', { id: 'v-gen', taskId: `${pid}-gen`, passed: true, verifiedAt: '2026-09-26T13:00:00.000Z' });
  for (const type of GATES) {
    store.put('verifications', { id: `v-${type}`, taskId: `${pid}-gate-${type}`, passed: true, verifiedAt: '2026-09-26T13:01:00.000Z' });
  }
  store.put('verifications', { id: 'v-qa', taskId: `${pid}-qa`, passed: true, verifiedAt: '2026-09-26T13:02:00.000Z' });

  await schedulerTick({}, { budgetMs: 1000 });

  assert.equal(store.get('tasks', `${pid}-gate-integrity`).verificationId, 'v-integrity', 'repair must backfill the integrity verificationId');
  assert.equal(store.get('tasks', `${pid}-qa`).verificationId, 'v-qa', 'repair must backfill the QA verificationId');
  const project = store.get('projects', pid);
  assert.ok(project.finalDeliveryId, 'after repair the project can finally receive its delivery');
});

test('the api/state summary reports true store-wide totals next to the capped lists', async () => {
  const loadCounter = Date.now();
  const [{ default: app }] = await Promise.all([import(`../src/index.js?t=${loadCounter}`)]);
  store.hydrated = true;
  const suffix = TAIL();
  for (let i = 0; i < 305; i++) {
    store.put('tasks', { id: `bulk-${suffix}-${i}`, projectId: `p-${suffix}`, title: `T${i}`, state: 'completed' });
  }
  for (let i = 0; i < 105; i++) {
    store.put('artifacts', { id: `bulk-art-${suffix}-${i}`, projectId: `p-${suffix}`, type: 'code-workspace', content: {} });
  }
  const res = await app.fetch(new Request('https://mauli.test/api/state'), {}, { waitUntil() {} });
  const body = await res.json();
  const data = body.data ?? body;
  assert.ok(data.tasks.length <= 300, 'the shipped task list stays capped');
  assert.ok(data.artifacts.length <= 100, 'the shipped artifact list stays capped');
  assert.ok(data.summary.totals.tasks >= 305, `summary must report the true task count, got ${JSON.stringify(data.summary.totals)}`);
  assert.ok(data.summary.totals.artifacts >= 105, `summary must report the true artifact count, got ${JSON.stringify(data.summary.totals)}`);
});

test('ensureProjectPipeline chains still advance end-to-end through runTask with verifications', async () => {
  seedAgents();
  const suffix = TAIL();
  const pid = `p-${suffix}`;
  store.put('projects', { id: pid, name: 'P', objective: 'Build a call recorder', requirements: ['x'], state: 'active' });
  store.put('tasks', { id: `${pid}-gen`, projectId: pid, title: 'Generate app', state: 'completed', requiredCapabilities: ['frontend'] });
  // The QA gate now judges whether the generated app genuinely functions, so the fixture
  // is a real working app (a bound button that persists state) rather than dead markup.
  registerArtifact({
    projectId: pid, taskId: `${pid}-gen`, type: 'code-workspace',
    content: {
      files: [
        { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>Call Recorder</title></head><body><ul id="list"></ul><button onclick="start()">Record</button><script src="app.js"></script></body></html>' },
        { path: 'www/app.js', content: 'var calls=JSON.parse(localStorage.getItem("calls")||"[]");function render(){document.getElementById("list").innerHTML=calls.map(function(c){return "<li>"+c+"</li>"}).join("");localStorage.setItem("calls",JSON.stringify(calls));}function start(){calls.push("call-"+calls.length);render();}render();' },
        { path: 'package.json', content: '{"name":"call-recorder","version":"1.0.0"}' },
      ]
    },
    metadata: {},
  });
  store.put('tasks', { id: `${pid}-qa`, projectId: pid, title: 'Final project QA gate', state: 'queued', finalProjectVerification: true, requiredCapabilities: ['testing', 'verification'] });

  const ensured = ensureProjectPipeline(pid, store.list('tasks').filter(t => t.projectId === pid));
  assert.ok(ensured?.gates?.length >= GATES.length, 'all six gates must be created');

  // Drive the full chain through the real runTask path, exactly like the cron tick:
  // gates run in sequence order (GATES order = sequence 900+i), blocked tasks get
  // re-attempted assignment (recoverStaleTasks), and a claim that cannot start because
  // its pre-assigned agent went busy is requeued with the agent released (orphan recovery).
  const { updateAgent } = await import('../src/agents.js');
  const byType = new Map(ensured.gates.map(g => [g.type, g]));
  for (let round = 0; round < 15; round++) {
    const pending = store.list('tasks').filter(t => t.projectId === pid && t.state !== 'completed');
    if (!pending.length) break;
    for (const type of GATES) {
      const gate = byType.get(type);
      const task = store.get('tasks', gate.id);
      if (!task || task.state === 'completed') continue;
      if (task.state === 'blocked') { assignTask(task.id); continue; }
      if (!['queued', 'assigned'].includes(task.state)) continue;
      const outcome = await runTask(task.id);
      const current = store.get('tasks', task.id);
      if (outcome.status === 'not-runnable' && current?.state === 'assigned') {
        if (current.assignedAgentId) updateAgent(current.assignedAgentId, { state: 'available', currentTaskId: null });
        store.put('tasks', { ...current, state: 'queued', agentId: null, assignedAgentId: null, claimedAt: null, leaseUntil: null, id: task.id });
      }
    }
  }
  const gateTasks = store.list('tasks').filter(t => t.projectId === pid && t.pipelineGate);
  assert.ok(gateTasks.length, 'gate tasks must exist');
  assert.ok(gateTasks.every(t => t.state === 'completed' && t.verificationId),
    `every completed gate must carry its verificationId: ${gateTasks.map(t => `${t.gateType}:${t.state}${t.verificationId ? '' : ':no-vId'}`).join(', ')}`);
  const delivery = buildFinalDelivery(store.get('projects', pid), { enforceGates: true });
  assert.equal(delivery.type, 'final-delivery', 'the finished chain must be deliverable');
});
