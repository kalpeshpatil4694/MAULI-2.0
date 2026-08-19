import { id, now } from './core.js';
import { store } from './store.js';
import { createProject, addTaskToProject } from './projects.js';
import { seedAgents, selectAgents, updateAgent } from './agents.js';
import { riskLevel, requiresApproval, requestApproval, isApprovalGranted } from './governance.js';
import { remember } from './memory.js';
import { interpretWithAI } from './ai.js';
import { executeTask } from './execution.js';
import { verifyResult, retryDecision } from './verification.js';

export function interpretCommand(command) {
  const text = String(command ?? '').trim();
  if (!text) throw new Error('Founder command is required');
  const capabilities = [];
  if (/(e-commerce|ecommerce|website|web|app|application|software|platform)/i.test(text)) capabilities.push('requirements');
  if (/(research|analysis|study)/i.test(text)) capabilities.push('research');
  return { id:id('intent'), command:text, objective:text, capabilities };
}

function dependenciesComplete(task) {
  return (task.dependsOn ?? []).every(depId => store.get('tasks', depId)?.state === 'completed');
}

export async function planCommand(command, env = {}) {
  seedAgents();
  const basic = interpretCommand(command);
  let aiPlan = null;
  if (env?.AI?.run) { try { aiPlan = await interpretWithAI(env, command); } catch { aiPlan = null; } }
  const objective = aiPlan?.objective ?? basic.objective;
  const capabilities = [...new Set([...(basic.capabilities ?? []), ...(aiPlan?.capabilities ?? [])])];
  const project = createProject({ name:`Project: ${objective.slice(0,60)}`, objective, founderCommand:basic.command, state:'planning' });
  const risk = riskLevel({ codeWrite:/code|build|create|develop|platform|app|website/i.test(command) });
  const approval = requiresApproval(risk) ? requestApproval({ action:`Execute founder command: ${command}`, risk, projectId:project.id }) : null;
  const selected = selectAgents(capabilities.length ? capabilities : ['planning'])[0] ?? selectAgents(['planning'])[0];
  const task = addTaskToProject(project.id, {
    title:'Analyze requirements and produce execution plan', description:objective,
    requiredCapabilities:capabilities.length ? capabilities : ['planning'], risk,
    acceptance:aiPlan?.acceptanceCriteria?.length ? aiPlan.acceptanceCriteria : ['Clear requirements','Execution plan','Agent assignments'],
    assignedAgentId:selected?.id ?? null, maxAttempts:3, executor:'internal.plan'
  });
  remember({ type:'project_requirement', content:objective, scope:'project', scopeId:project.id, importance:'high', source:'founder-command' });
  if (approval) return { intent:basic, aiPlan, project, firstTask:task, selectedAgent:selected, approval, status:'awaiting_approval' };
  return executePlannedProject({ project, task, selectedAgent:selected, env });
}

export async function executePlannedProject({ project, task, selectedAgent, env = {}, approved = false }) {
  if (!dependenciesComplete(task)) return { project, firstTask:task, selectedAgent, status:'blocked', reason:'dependencies_incomplete' };
  if (requiresApproval(task.risk) && !approved) return { project, firstTask:task, selectedAgent, status:'awaiting_approval' };
  if (selectedAgent) updateAgent(selectedAgent.id, { state:'working', currentTaskId:task.id, heartbeatAt:now() });
  const working = store.put('tasks', { ...task, state:'working', startedAt:now(), attempts:(task.attempts ?? 0) + 1, id:task.id });
  let execution = await executeTask(working, { env, approved });
  let verification = verifyResult(working, execution);
  let attempt = 1;
  while (!verification.passed && attempt < (working.maxAttempts ?? 3)) {
    const decision = retryDecision(working, verification, attempt);
    if (decision.action !== 'retry') break;
    attempt = decision.attempt;
    execution = await executeTask(working, { env, retry:true, attempt, approved });
    verification = verifyResult(working, execution);
  }
  const status = verification.passed ? 'completed' : 'escalated';
  const finalTask = store.put('tasks', { ...working, state:verification.passed ? 'completed' : 'failed', result:execution?.result ?? null, verificationId:verification.id, completedAt:verification.passed ? now() : undefined, id:working.id });
  if (selectedAgent) updateAgent(selectedAgent.id, { state:verification.passed ? 'available' : 'escalated', currentTaskId:null, heartbeatAt:now() });
  store.put('projects', { ...project, state:verification.passed ? 'completed' : 'escalated', id:project.id });
  store.addEvent('command.completed', { projectId:project.id, taskId:task.id, status });
  return { project, firstTask:finalTask, selectedAgent, execution, verification, status };
}

export async function resumeApprovedCommand(approvalId, env = {}) {
  const approval = store.get('approvals', approvalId);
  if (!approval || !isApprovalGranted(approvalId)) return { status:'awaiting_approval', approval };
  const project = store.get('projects', approval.projectId);
  const task = store.list('tasks').find(t => t.projectId === approval.projectId);
  const selectedAgent = task?.agentId ? store.get('agents', task.agentId) : selectAgents(task?.requiredCapabilities ?? ['planning'])[0];
  if (!project || !task) return { status:'error', error:'Approved project/task not found' };
  return executePlannedProject({ project, task, selectedAgent, env, approved:true });
}
