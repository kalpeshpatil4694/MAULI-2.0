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

function dependenciesComplete(task) { return (task.dependsOn ?? []).every(depId => store.get('tasks', depId)?.state === 'completed'); }

function taskSpecFromPlan(plan, fallbackObjective, index = 0) {
  const requirements = Array.isArray(plan?.requirements) ? plan.requirements : [];
  const caps = Array.isArray(plan?.capabilities) ? plan.capabilities : [];
  const map = [
    { key:'research', title:'Research and validate requirements', caps:['research','analysis'], executor:'internal.plan' },
    { key:'product-planning', title:'Define product and architecture plan', caps:['product-planning','planning'], executor:'internal.plan' },
    { key:'frontend', title:'Design frontend and user experience', caps:['frontend','ui'], executor:'internal.plan' },
    { key:'backend', title:'Design backend and API implementation', caps:['backend','api'], executor:'internal.plan' },
    { key:'database', title:'Design database and persistence', caps:['database','schema','sql'], executor:'internal.plan' },
    { key:'security', title:'Perform security review', caps:['security','audit'], executor:'internal.plan' },
    { key:'testing', title:'Create verification and QA plan', caps:['testing','verification'], executor:'internal.plan' }
  ];
  const selected = map.filter(x => caps.includes(x.key) || x.caps.some(c => caps.includes(c)));
  const specs = selected.length ? selected : [{ key:'planning', title:'Analyze requirements and produce execution plan', caps:['planning'], executor:'internal.plan' }];
  return specs.map((s, i) => ({ ...s, title: requirements[i] ? `${s.title}: ${requirements[i]}` : s.title, description: fallbackObjective, requiredCapabilities:s.caps, maxAttempts:3, executor:s.executor, order:index+i }));
}

export async function planCommand(command, env = {}) {
  seedAgents();
  const basic = interpretCommand(command);
  let aiPlan = null;
  if (env?.AI?.run) { try { aiPlan = await interpretWithAI(env, command); } catch { aiPlan = null; } }
  const objective = aiPlan?.objective ?? basic.objective;
  const capabilities = [...new Set([...(basic.capabilities ?? []), ...(aiPlan?.capabilities ?? [])])];
  const project = createProject({ name:`Project: ${objective.slice(0,60)}`, objective, founderCommand:basic.command, requirements:aiPlan?.requirements ?? [] });
  const risk = riskLevel({ codeWrite:/code|build|create|develop|platform|app|website/i.test(command) });
  const approval = requiresApproval(risk) ? requestApproval({ action:`Execute founder command: ${command}`, risk, projectId:project.id }) : null;
  const specs = taskSpecFromPlan(aiPlan, objective);
  const tasks = specs.map((spec, i) => {
    const candidates = selectAgents(spec.requiredCapabilities);
    const selected = candidates[0] ?? selectAgents(['planning'])[0];
    const task = addTaskToProject(project.id, { title:spec.title, description:spec.description, requiredCapabilities:spec.requiredCapabilities, risk, acceptance:aiPlan?.acceptanceCriteria?.length ? aiPlan.acceptanceCriteria : ['Clear requirements','Execution plan','Verification'], assignedAgentId:selected?.id ?? null, maxAttempts:spec.maxAttempts, executor:spec.executor, sequence:i });
    return { task, selectedAgent:selected };
  });
  remember({ type:'project_requirement', content:objective, scope:'project', scopeId:project.id, importance:'high', source:'founder-command' });
  if (approval) return { intent:basic, aiPlan, project, tasks, status:'awaiting_approval', approval };
  return executePlannedProject({ project, task:tasks[0]?.task, selectedAgent:tasks[0]?.selectedAgent, env });
}

export async function executePlannedProject({ project, task, selectedAgent, env = {}, approved = false }) {
  if (!task) return { project, status:'error', error:'No executable task was created' };
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
  const task = store.list('tasks').find(t => t.projectId === approval.projectId && (t.state === 'active' || t.state === 'planning' || t.state === 'working'));
  const selectedAgent = task?.assignedAgentId ? store.get('agents', task.assignedAgentId) : selectAgents(task?.requiredCapabilities ?? ['planning'])[0];
  if (!project || !task) return { status:'error', error:'Approved project/task not found' };
  return executePlannedProject({ project, task, selectedAgent, env, approved:true });
}
