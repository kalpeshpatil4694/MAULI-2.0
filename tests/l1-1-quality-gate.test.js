import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { createProject } from '../src/projects.js';
import { runQualityGate } from '../src/quality-gate.js';

function reset() {
  store.data = new Map();
  store.events = [];
  store.pendingWrites = new Set();
  store.env = null;
}

const goodCalculator = [
  { path: 'index.html', content: '<!doctype html><link rel="stylesheet" href="style.css"><main><input id="display"><button>+</button><button>-</button><button>*</button><button>/</button><button id="clearHistory">Clear History</button><div id="history"></div></main><script src="script.js"></script>' },
  { path: 'script.js', content: 'const history=[]; function add(a,b){return a+b} function subtract(a,b){return a-b} function multiply(a,b){return a*b} function divide(a,b){return b===0?null:a/b} function clearHistory(){history.length=0}' },
  { path: 'style.css', content: 'body{font-family:system-ui}button{padding:8px}' },
  { path: 'README.md', content: '# Calculator\nBasic arithmetic, calculation history and clear history.' }
];

test('L1.1 quality gate passes a complete calculator project', () => {
  reset();
  const project = createProject({ name: 'Calculator', objective: 'Build a calculator application', founderCommand: 'Create calculator', requirements: ['Basic arithmetic', 'Calculation history', 'Clear history'] });
  const task = { id: 'task_quality_good', projectId: project.id, title: 'Implement calculator frontend', description: 'Calculator application' };
  const artifact = { id: 'artifact_good', content: { files: goodCalculator } };
  const result = runQualityGate(task, artifact);
  assert.equal(result.passed, true);
  assert.equal(result.status, 'PASS');
  assert.equal(result.requirementsDetected, 'calculator');
});

test('L1.1 quality gate rejects addition-only calculator output', () => {
  reset();
  const project = createProject({ name: 'Calculator', objective: 'Build a calculator application', founderCommand: 'Create calculator', requirements: ['Basic arithmetic', 'Calculation history', 'Clear history'] });
  const task = { id: 'task_quality_bad', projectId: project.id, title: 'Implement calculator frontend', description: 'Calculator application' };
  const artifact = { id: 'artifact_bad', content: { files: [
    { path: 'index.html', content: '<input id="a"><input id="b"><button>Add</button><script src="script.js"></script>' },
    { path: 'script.js', content: 'function add(a,b){return a+b}' }
  ] } };
  const result = runQualityGate(task, artifact);
  assert.equal(result.passed, false);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.checks.find(c => c.name === 'basic_arithmetic')?.passed, false);
  assert.equal(result.checks.find(c => c.name === 'calculation_history')?.passed, false);
});

test('L1.1 quality gate rejects broken cross-file integration', () => {
  reset();
  const project = createProject({ name: 'Web app', objective: 'Build a small web application', requirements: [] });
  const task = { id: 'task_quality_integration', projectId: project.id, title: 'Implement frontend', description: 'Frontend UI' };
  const artifact = { id: 'artifact_integration', content: { files: [
    { path: 'index.html', content: '<main>Hello</main><script src="missing.js"></script>' },
    { path: 'style.css', content: 'body{}' }
  ] } };
  const result = runQualityGate(task, artifact);
  assert.equal(result.passed, false);
  assert.equal(result.checks.find(c => c.name === 'script_reference:missing.js')?.passed, false);
});
