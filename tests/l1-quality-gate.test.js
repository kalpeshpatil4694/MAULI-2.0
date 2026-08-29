import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { runQualityGate } from '../src/quality-gate.js';

function project(id, requirements) {
  return store.put('projects', {
    id,
    name: `Quality ${id}`,
    objective: 'Create a calculator application',
    requirements,
    state: 'active'
  });
}

test('L1.1 quality gate rejects the previously observed weak calculator artifact', async () => {
  const p = project('quality-bad-calculator', [
    'User can input numbers and mathematical operators',
    'Basic arithmetic',
    'Calculation history',
    'Clear calculation history'
  ]);
  const artifact = store.put('artifacts', {
    id: 'bad-calculator-artifact', projectId: p.id, type: 'code-workspace',
    content: { files: [
      { path: 'index.html', content: '<html><body><input><button>Calculate</button></body></html>' },
      { path: 'script.js', content: 'function add(a,b){return a+b}' },
      { path: 'style.css', content: 'body{}' },
      { path: 'calculator_app.py', content: 'print("zip builder")' },
      { path: 'calculator_app.sql', content: 'CREATE TABLE users(password TEXT);' },
      { path: 'security_audit.py', content: 'print("ok")' }
    ]}, metadata: {}
  });
  const result = await runQualityGate({ projectId: p.id, title: 'Frontend calculator', description: 'Implement calculator' }, artifact);
  assert.equal(result.passed, false);
  assert.equal(result.stages.requirementVerification, false);
  assert.equal(result.stages.artifactIntegrity, true);
  assert.equal(artifact.metadata.qualityGateStatus, 'FAIL');
});

test('L1.1 quality gate accepts a complete integrated calculator artifact', async () => {
  const p = project('quality-good-calculator', [
    'User can input numbers and mathematical operators',
    'Basic arithmetic',
    'Calculation history',
    'Clear calculation history'
  ]);
  const artifact = store.put('artifacts', {
    id: 'good-calculator-artifact', projectId: p.id, type: 'code-workspace',
    content: { files: [
      { path: 'index.html', content: '<html><body><button id="add">+</button><script src="script.js"></script><link rel="stylesheet" href="style.css"></body></html>' },
      { path: 'script.js', content: 'const history=[]; function add(a,b){history.push(a+b);return a+b} function subtract(a,b){return a-b} function multiply(a,b){return a*b} function divide(a,b){return a/b} function clearHistory(){history.length=0}' },
      { path: 'style.css', content: 'body{font-family:sans-serif}' },
      { path: 'README.md', content: '# Calculator\nSupports arithmetic, history and clear history.' }
    ]}, metadata: {}
  });
  const result = await runQualityGate({ projectId: p.id, title: 'Frontend calculator', description: 'Implement calculator' }, artifact);
  assert.equal(result.passed, true);
  assert.equal(result.stages.automatedBuildTest, true);
  assert.equal(result.stages.requirementVerification, true);
  assert.equal(result.stages.securityCheck, true);
  assert.equal(result.stages.artifactIntegrity, true);
  assert.equal(result.stages.integrationCheck, true);
  assert.equal(artifact.metadata.qualityGateStatus, 'PASS');
  assert.equal(result.artifactManifest.length, 4);
  assert.match(result.artifactManifest[0].sha256, /^[a-f0-9]{64}$/);
});
