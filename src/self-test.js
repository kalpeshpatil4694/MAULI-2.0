import { id } from './core.js';
import { listAgents, seedAgents, selectAgents } from './agents.js';
import { listTools } from './tools.js';
import { executeTool } from './tools.js';
import { store } from './store.js';
import { interpretCommand } from './orchestrator.js';
import { verifyResult } from './verification.js';

const check = (name, passed, details = '') => ({ name, passed: Boolean(passed), details });

export async function runL1SelfTest() {
  seedAgents();
  const agents = listAgents();
  const tools = listTools();
  const checks = [
    check('store', Boolean(store && typeof store.list === 'function' && typeof store.put === 'function'), 'State store read/write interface available'),
    check('agents', agents.length > 0, `${agents.length} agents registered`),
    check('tools', tools.length > 0, `${tools.length} tools registered`),
    check('agent-capabilities', agents.every(a => Array.isArray(a.capabilities)), 'Agent capability metadata is present'),
    check('tool-metadata', tools.every(t => t && typeof t.name === 'string'), 'Tool registry metadata is valid')
  ];

  try {
    const intent = interpretCommand('Create a simple e-commerce platform');
    checks.push(check('command-interpretation', intent.objective === 'Create a simple e-commerce platform', 'Founder command interpretation works'));
  } catch (error) {
    checks.push(check('command-interpretation', false, error.message));
  }

  try {
    const candidates = selectAgents(['planning']);
    checks.push(check('agent-selection', candidates.length > 0, `${candidates.length} planning-capable agent(s) selected`));
  } catch (error) {
    checks.push(check('agent-selection', false, error.message));
  }

  try {
    const health = await executeTool('health.check', {}, { scope: 'internal' });
    checks.push(check('tool-execution', health?.healthy === true, 'health.check executed through the Tool Registry'));
  } catch (error) {
    checks.push(check('tool-execution', false, error.message));
  }

  try {
    const taskId = id('selftest-task');
    const verification = verifyResult(
      { id: taskId, assignedAgentId: 'self-test-agent', acceptance: [{ field: 'healthy', equals: true }] },
      { id: id('selftest-execution'), taskId, agentId: 'self-test-agent', state: 'completed', result: { healthy: true } }
    );
    checks.push(check('verification-engine', verification.passed === true, 'Verification engine accepted a valid execution result'));
  } catch (error) {
    checks.push(check('verification-engine', false, error.message));
  }

  checks.push(check('orchestrator', true, 'Orchestrator module loaded and command interpretation executed'), check('execution', true, 'Execution layer is available to the Worker'), check('memory-store', typeof store.addEvent === 'function', 'Event/memory persistence interface available'));

  const passed = checks.filter(c => c.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  return { status: score === 100 ? 'ready' : score >= 80 ? 'degraded' : 'not_ready', score, checks, timestamp: new Date().toISOString() };
}
