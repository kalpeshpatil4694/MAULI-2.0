import { id } from './core.js';
import { store } from './store.js';
import { createProject, addTaskToProject } from './projects.js';
import { seedAgents } from './agents.js';
import { riskLevel, requiresApproval, requestApproval } from './governance.js';
import { remember } from './memory.js';

export function interpretCommand(command) {
  const text = String(command ?? '').trim();
  if (!text) throw new Error('Founder command is required');
  const lower = text.toLowerCase();
  const capabilities = [];
  if (/(e-commerce|ecommerce|website|web|app|application|software|platform)/i.test(text)) capabilities.push('requirements');
  if (/(research|analysis|study)/i.test(text)) capabilities.push('research');
  return { id: id('intent'), command: text, objective: text, capabilities };
}

export function planCommand(command) {
  seedAgents();
  const intent = interpretCommand(command);
  const project = createProject({ name: `Project: ${intent.command.slice(0, 60)}`, objective: intent.objective, founderCommand: intent.command });
  const risk = riskLevel({ codeWrite: /code|build|create|develop|platform|app|website/i.test(command) });
  const approval = requiresApproval(risk) ? requestApproval({ action: `Execute founder command: ${command}`, risk, projectId: project.id }) : null;
  const task = addTaskToProject(project.id, {
    title: 'Analyze requirements and produce execution plan',
    description: intent.objective,
    requiredCapabilities: ['planning'],
    risk,
    acceptance: ['Clear requirements', 'Execution plan', 'Agent assignments']
  });
  remember({ type: 'project_requirement', content: intent.objective, scope: 'project', scopeId: project.id, importance: 'high', source: 'founder-command' });
  return { intent, project, firstTask: task, approval, status: approval ? 'awaiting_approval' : 'planned' };
}
