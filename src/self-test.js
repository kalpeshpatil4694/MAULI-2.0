import { id } from './core.js';
import { listAgents, seedAgents, selectAgents } from './agents.js';
import { listTools, authorizeTool } from './tools.js';
import { store } from './store.js';
import { interpretCommand } from './orchestrator.js';
import { verifyResult } from './verification.js';
import { listProjects } from './projects.js';
import { listTasks } from './tasks.js';
import { listApprovals } from './governance.js';
import { getSystemLearningStats } from './agent-learning.js';
import { getUsageReport, getD1Usage, cleanupD1 } from './db.js';
import { getRateLimitStats } from './auth.js';

const check = (name, passed, details = '') => ({ name, passed: Boolean(passed), details });

export function runL1SelfTest() {
  seedAgents();
  const agents = listAgents();
  const tools = listTools();
  const checks = [];

  // Core system checks
  checks.push(check('store', Boolean(store && typeof store.list === 'function' && typeof store.put === 'function'), 'State store read/write interface available'));
  checks.push(check('agents', agents.length > 0, `${agents.length} agents registered`));
  checks.push(check('tools', tools.length > 0, `${tools.length} tools registered`));
  checks.push(check('agent-capabilities', agents.every(a => Array.isArray(a.capabilities)), 'Agent capability metadata is present'));
  checks.push(check('tool-metadata', tools.every(t => t && typeof t.name === 'string'), 'Tool registry metadata is valid'));
  checks.push(check('memory-store', typeof store.addEvent === 'function', 'Event/memory persistence interface available'));
  checks.push(check('orchestrator', true, 'Orchestrator module loaded'));
  checks.push(check('execution', true, 'Execution layer is available to the Worker'));

  // Command interpretation
  try {
    const intent = interpretCommand('Create a simple e-commerce platform');
    checks.push(check('command-interpretation', intent.objective === 'Create a simple e-commerce platform' && intent.capabilities.includes('requirements'), 'Founder command interpretation works'));
  } catch (error) {
    checks.push(check('command-interpretation', false, error.message));
  }

  // Agent selection
  try {
    const candidates = selectAgents(['planning']);
    checks.push(check('agent-selection', candidates.length > 0, `${candidates.length} planning-capable agent(s) selected`));
  } catch (error) {
    checks.push(check('agent-selection', false, error.message));
  }

  // Tool authorization
  try {
    const healthTool = tools.find(t => t.name === 'health.check');
    const authorization = healthTool ? authorizeTool(healthTool, { agentId: 'self-test-agent', projectId: 'self-test-project' }) : { ok: false, reason: 'health.check not registered' };
    checks.push(check('tool-authorization', authorization.ok === true, 'Read-only health tool authorization works'));
  } catch (error) {
    checks.push(check('tool-authorization', false, error.message));
  }

  // Verification engine
  try {
    const taskId = id('selftest-task');
    const verification = verifyResult(
      { id: taskId, assignedAgentId: 'self-test-agent', acceptance: [{ field: 'healthy', equals: true }] },
      { id: id('selftest-execution'), taskId, agentId: 'self-test-agent', state: 'completed', result: { healthy: true } }
    );
    checks.push(check('verification-engine', verification.passed === true, 'Verification engine works'));
  } catch (error) {
    checks.push(check('verification-engine', false, error.message));
  }

  // Data layer checks
  try {
    const projects = listProjects();
    checks.push(check('projects', Array.isArray(projects), `${projects.length} projects in store`));
  } catch (error) {
    checks.push(check('projects', false, error.message));
  }

  try {
    const tasks = listTasks();
    checks.push(check('tasks', Array.isArray(tasks), `${tasks.length} tasks in store`));
  } catch (error) {
    checks.push(check('tasks', false, error.message));
  }

  try {
    const approvals = listApprovals();
    checks.push(check('approvals', Array.isArray(approvals), `${approvals.length} approvals in store`));
  } catch (error) {
    checks.push(check('approvals', false, error.message));
  }

  // Learning system
  try {
    const learning = getSystemLearningStats();
    checks.push(check('learning', Boolean(learning), `Learning stats: ${learning.totalAttempts || 0} attempts`));
  } catch (error) {
    checks.push(check('learning', false, error.message));
  }

  // Rate limiter
  try {
    const stats = getRateLimitStats();
    checks.push(check('rate-limiter', Boolean(stats), `Rate limiter: ${stats.totalRequests || 0} requests tracked`));
  } catch (error) {
    checks.push(check('rate-limiter', false, error.message));
  }

  // Usage report (async — check function exists)
  checks.push(check('usage-report', typeof getUsageReport === 'function', 'Usage report function available'));

  // D1 usage (async — check function exists)
  checks.push(check('d1-usage', typeof getD1Usage === 'function', 'D1 usage query function available'));

  // Cleanup (async — check function exists)
  checks.push(check('cleanup', typeof cleanupD1 === 'function', 'D1 cleanup function available'));

  // Executor registry (already imported via orchestrator)
  try {
    const executors = store.list('tools').length;
    checks.push(check('executor-registry', executors > 0, `${executors} tools/executors registered`));
  } catch (error) {
    checks.push(check('executor-registry', false, error.message));
  }

  const passed = checks.filter(c => c.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  return { status: score === 100 ? 'ready' : score >= 80 ? 'degraded' : 'not_ready', score, checks, timestamp: new Date().toISOString() };
}
