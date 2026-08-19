import { id } from './core.js';
import { store } from './store.js';
import { createProject, addTaskToProject } from './projects.js';
import { seedAgents, chooseAgent } from './agents.js';
import { riskLevel, requiresApproval, requestApproval } from './governance.js';
import { remember } from './memory.js';
import { generateAI, interpretWithAI } from './ai.js';
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

export async function planCommand(command, env = {}) {
  seedAgents();
  const basic = interpretCommand(command);
  let aiPlan = null;
  if (env?.AI?.run) { try { aiPlan = await interpretWithAI(env, command); } catch { aiPlan = null; } }
  const objective = aiPlan?.objective ?? basic.objective;
  const capabilities = [...new Set([...(basic.capabilities ?? []), ...(aiPlan?.capabilities ?? [])])];
  const project = createProject({ name:`Project: ${objective.slice(0,60)}`, objective, founderCommand:basic.command });
  const risk = riskLevel({ codeWrite:/code|build|create|develop|platform|app|website/i.test(command) });
  const approval = requiresApproval(risk) ? requestApproval({ action:`Execute founder command: ${command}`, risk, projectId:project.id }) : null;
  const selected = chooseAgent(capabilities.length ? capabilities : ['planning']);
  const task = addTaskToProject(project.id, {
    title:'Analyze requirements and produce execution plan', description:objective,
    requiredCapabilities:capabilities.length ? capabilities : ['planning'], risk,
    acceptance:aiPlan?.acceptanceCriteria?.length ? aiPlan.acceptanceCriteria : ['Clear requirements','Execution plan','Agent assignments'],
    assignedAgentId:selected?.id ?? null, maxAttempts:3, executor:'internal.plan'
  });
  remember({ type:'project_requirement', content:objective, scope:'project', scopeId:project.id, importance:'high', source:'founder-command' });
  if (approval) return { intent:basic, aiPlan, project, firstTask:task, selectedAgent:selected, approval, status:'awaiting_approval' };
  let execution = await executeTask(task, { env });
  let verification = verifyResult(task, execution);
  let attempt = 1;
  while (!verification.passed && attempt < (task.maxAttempts ?? 3)) {
    const decision = retryDecision(task, verification, attempt);
    if (decision.action !== 'retry') break;
    attempt = decision.attempt;
    execution = await executeTask(task, { env, retry:true, attempt });
    verification = verifyResult(task, execution);
  }
  const status = verification.passed ? 'completed' : 'escalated';
  store.addEvent('command.completed', { projectId:project.id, taskId:task.id, status });
  return { intent:basic, aiPlan, project, firstTask:task, selectedAgent:selected, execution, verification, status };
}

export async function answerFounder(command, env) {
  if (!env?.AI?.run) return null;
  return generateAI(env, [
    { role:'system', content:'You are MAULI Executive AI. Explain current company/project state clearly to the founder. Do not claim an action happened unless the system state confirms it.' },
    { role:'user', content:String(command) }
  ]);
}
