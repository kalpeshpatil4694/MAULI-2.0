import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';
import { seedAgents } from '../src/agents.js';

function functionalResponse() {
  return JSON.stringify({
    summary: 'Runnable functional fixture application',
    files: [
      { path: 'www/index.html', content: '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="styles.css"></head><body><button id="action">Run</button><p id="output"></p><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'const button=document.getElementById("action"); const output=document.getElementById("output"); function run(){ output.textContent="done"; } button.addEventListener("click",run); export { run }; // functional fixture interaction\n' },
      { path: 'www/styles.css', content: 'body { font-family: sans-serif; padding: 24px; } button { padding: 12px; } #output { margin-top: 16px; }' },
      { path: 'package.json', content: '{"name":"mauli-test-app","version":"1.0.0","private":true}' },
      { path: 'capacitor.config.json', content: '{"appId":"com.mauli.test","appName":"MAULI Test App","webDir":"www"}' },
      { path: 'README.md', content: '# MAULI Test Application\nFunctional orchestration fixture.' }
    ],
    tests: ['button interaction'],
    notes: ['fixture']
  });
}

test('executive orchestrator completes a multi-task founder command end-to-end', async () => {
  seedAgents();
  const env = {
    AI: {
      async run(_model, request) {
        const system = request?.find(message => message.role === 'system')?.content ?? '';
        if (system.includes('Functional Application Engineer')) return { response: functionalResponse() };
        return { response: JSON.stringify({ objective:'Create a validated product plan', requirements:['research requirements','design frontend','security verification'], capabilities:['research','frontend','security'], risks:[], acceptanceCriteria:['Execution plan generated'] }) };
      }
    }
  };

  const result = await planCommand('Create a product plan', env);
  assert.equal(result.status, 'completed');
  assert.equal(result.project.state, 'completed');
  assert.ok(result.tasks.length >= 2);
  const tasks = result.tasks.map(entry => store.get('tasks', entry.task.id));
  assert.ok(tasks.every(task => task?.state === 'completed'));
  assert.equal(tasks[1].dependsOn[0], tasks[0].id);
  assert.ok(tasks.every(task => task?.assignedAgentId));
  assert.ok(tasks.every(task => task?.verificationId));
});
