import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { requestApproval, decideApproval, isApprovalGranted } from '../src/governance.js';
import { validateCodeAction } from '../src/tools/code-agent.js';
import { executeTaskLifecycle } from '../src/execution.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

function functionalResponse() {
  return JSON.stringify({
    summary: 'Runnable e-commerce functional fixture',
    files: [
      { path: 'www/index.html', content: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><h1>Store</h1><button id="cart">Add to cart</button><p id="status"></p><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'const cart=document.getElementById("cart"); const status=document.getElementById("status"); function add(){ status.textContent="Added to cart"; } cart.addEventListener("click",add); export { add }; // functional fixture interaction\n' },
      { path: 'www/styles.css', content: 'body { font-family: sans-serif; padding: 24px; } button { padding: 12px; } #status { margin-top: 16px; }' },
      { path: 'package.json', content: '{"name":"mauli-ecommerce-test","version":"1.0.0","private":true}' },
      { path: 'capacitor.config.json', content: '{"appId":"com.mauli.ecommerce.test","appName":"MAULI E-commerce Test","webDir":"www"}' },
      { path: 'README.md', content: '# MAULI E-commerce Test\nFunctional security-gated fixture.' }
    ],
    tests: ['cart interaction'],
    notes: ['fixture']
  });
}

async function executeDependencies(task, env) {
  for (const dependencyId of task.dependsOn ?? []) {
    const dependency = store.get('tasks', dependencyId);
    if (!dependency || dependency.state === 'completed') continue;
    await executeDependencies(dependency, env);
    const execution = await executeTaskLifecycle(dependency, { dependenciesComplete: true, ...env });
    assert.equal(execution.status, 'completed', `dependency ${dependency.title} should complete before the approved code task`);
  }
}

test('L1 e-commerce security-aware flow gates code work and completes after approval', async () => {
  seedAgents();
  const command = 'Create a simple e-commerce platform';
  const env = { AI: { async run(_model, request) {
    const messages = request?.messages ?? request;
    const system = Array.isArray(messages) ? (messages.find(message => message.role === 'system')?.content ?? '') : '';
    if (system.includes('Functional Application Engineer')) return { response: functionalResponse() };
    return { response: JSON.stringify({ objective:command, requirements:['catalog','cart','orders'], capabilities:['product-planning','frontend','backend','database','security','testing'], risks:[], acceptanceCriteria:['Functional product'] }) };
  } } };
  const plan = await planCommand(command, env);
  assert.ok(plan.project?.id);
  assert.ok(plan.tasks.length >= 3);
  const codeTask = plan.tasks.find(t => (t.title || '').toLowerCase().includes('code') || (t.toolNames || []).some(n => String(n).includes('code')));
  assert.ok(codeTask, 'expected a code-related task');
  const safe = validateCodeAction({ operation:'create', target:'generated/app.js', content:'export const app = true;' });
  assert.equal(safe.ok, true);
  const blocked = validateCodeAction({ operation:'create', target:'../unsafe.js', content:'sudo rm -rf /' });
  assert.equal(blocked.ok, false);
  const approval = requestApproval({ action:`Execute code task ${codeTask.id}`, risk:'high', projectId:plan.project.id, taskId:codeTask.id });
  assert.equal(isApprovalGranted(approval.id), false);
  const rejected = decideApproval(approval.id, false, 'Security gate test rejection');
  assert.equal(rejected.state, 'rejected');
  assert.equal(isApprovalGranted(approval.id), false);
  const approved = decideApproval(approval.id, true, 'Security gate test approval');
  assert.equal(approved.state, 'approved');
  assert.equal(isApprovalGranted(approval.id), true);
  await executeDependencies(codeTask, { env, approved:true, approvalId:approval.id });
  const execution = await executeTaskLifecycle(codeTask, { env, approved:true, approvalId:approval.id, dependenciesComplete:true });
  assert.equal(execution.status, 'completed');
  assert.equal(execution.verification.passed, true);
  assert.ok(store.list('runs').some(r => r.taskId === codeTask.id));
  assert.ok(store.list('artifacts').some(a => a.taskId === codeTask.id));
});
