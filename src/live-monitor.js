import { id, now } from './core.js';
import { store } from './store.js';
import { sendMessage, getMessages } from './agent-communication.js';

/**
 * Live Monitor — provides real-time visibility into agent activity,
 * conversations, progress, and system health.
 */

export function recordActivity({ agentId, type, description, projectId = null, taskId = null, metadata = {} }) {
  const activity = {
    id: id('activity'),
    agentId,
    type,
    description: description || '',
    projectId,
    taskId,
    metadata,
    timestamp: now(),
    visible: true
  };
  store.put('activities', activity);
  store.addEvent('agent.activity', { activityId: activity.id, agentId, type, description: description?.substring(0, 200) });
  return activity;
}

export function getActivityFeed({ limit = 50, projectId = null, agentId = null, types = null } = {}) {
  let activities = store.list('activities');
  if (projectId) activities = activities.filter(a => a.projectId === projectId);
  if (agentId) activities = activities.filter(a => a.agentId === agentId);
  if (types && types.length) activities = activities.filter(a => types.includes(a.type));
  return activities.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit);
}

/**
 * Real project lifecycle progress. This is state-derived; no timer/fake percentage.
 */
export function getProjectProgress(projectId) {
  const tasks = store.list('tasks').filter(t => t.projectId === projectId);
  const activities = store.list('activities').filter(a => a.projectId === projectId);
  const messages = store.list('messages').filter(m => m.projectId === projectId);
  const builds = store.list('builds').filter(b => b.projectId === projectId);

  const total = tasks.length;
  const completed = tasks.filter(t => t.state === 'completed').length;
  const working = tasks.filter(t => t.state === 'working').length;
  const failed = tasks.filter(t => t.state === 'failed').length;
  const blocked = tasks.filter(t => t.state === 'blocked').length;
  const queued = tasks.filter(t => t.state === 'queued' || t.state === 'assigned').length;
  const recentActivities = activities.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 10);

  const activeAgents = [...new Set(activities.filter(a => {
    const ts = Date.parse(a.timestamp);
    return Number.isFinite(ts) && Date.now() - ts < 300000;
  }).map(a => a.agentId))];

  const latestBuild = builds.sort((a, b) => String(b.startedAt || b.pushedAt || '').localeCompare(String(a.startedAt || a.pushedAt || '')))[0] || null;
  const lastActivity = recentActivities[0] || null;

  let stage = 'Understanding';
  let stageIndex = 0;
  if (total > 0) { stage = 'Planning'; stageIndex = 1; }
  if (total > 0 && tasks.some(t => t.assignedAgentId)) { stage = 'Agent Assignment'; stageIndex = 2; }
  if (working > 0 || (total > 0 && completed < total)) { stage = 'Development / Execution'; stageIndex = 3; }
  if (total > 0 && completed === total && failed === 0) { stage = 'Automated Test'; stageIndex = 4; }
  if (latestBuild && ['pushed','queued','in_progress','building'].includes(latestBuild.status)) { stage = 'Artifact / Build'; stageIndex = 6; }
  if (latestBuild && latestBuild.status === 'success') { stage = 'Final Delivery'; stageIndex = 8; }
  if (failed > 0) { stage = 'Recovery / Fix Required'; stageIndex = 3; }

  const percentage = total > 0 ? Math.round(completed / total * 100) : 0;
  const nextStage = stageIndex >= 8 ? null : ['Understanding','Planning','Agent Assignment','Development / Execution','Automated Test','Security Check','Artifact / Build','Final QA','Final Delivery'][stageIndex + 1];
  const currentAgent = lastActivity?.agentId || activeAgents[0] || null;

  return {
    projectId,
    stage,
    stageIndex,
    stageCount: 9,
    nextStage,
    currentAgent,
    tasks: { total, completed, working, failed, blocked, queued },
    percentage,
    recentActivities,
    activeAgents,
    messages: messages.length,
    latestBuild,
    lastActivity,
    status: failed > 0 ? 'has_failures' : working > 0 ? 'in_progress' : completed === total && total > 0 ? 'completed' : 'pending'
  };
}

export function getLiveStatus() {
  const agents = store.list('agents');
  const projects = store.list('projects');
  const tasks = store.list('tasks');
  const activities = store.list('activities');
  const recentActivities = activities.filter(a => {
    const ts = Date.parse(a.timestamp);
    return Number.isFinite(ts) && Date.now() - ts < 300000;
  });
  const agentStatus = agents.map(agent => {
    const agentActivities = recentActivities.filter(a => a.agentId === agent.id);
    const lastActivity = agentActivities[0] || null;
    return { id: agent.id, name: agent.name, state: agent.state, lastActivity: lastActivity ? { type: lastActivity.type, description: lastActivity.description, timestamp: lastActivity.timestamp } : null, isRecent: agentActivities.length > 0 };
  });
  const activeProjects = projects.filter(p => p.state === 'active').map(p => {
    const projectTasks = tasks.filter(t => t.projectId === p.id);
    const done = projectTasks.filter(t => t.state === 'completed').length;
    const progress = getProjectProgress(p.id);
    return { id: p.id, name: p.name, tasks: projectTasks.length, completed: done, percentage: projectTasks.length > 0 ? Math.round(done / projectTasks.length * 100) : 0, stage: progress.stage, currentAgent: progress.currentAgent, status: progress.status };
  });
  return {
    timestamp: now(),
    agents: { total: agents.length, available: agents.filter(a => a.state === 'available').length, working: agents.filter(a => a.state === 'working').length, details: agentStatus },
    projects: { total: projects.length, active: activeProjects.length, details: activeProjects },
    recentActivityCount: recentActivities.length,
    recentActivities: recentActivities.slice(0, 20)
  };
}

export function createSubAgent({ parentAgentId, task, projectId, capabilities = [] }) {
  const parent = store.get('agents', parentAgentId);
  if (!parent) return { error: 'Parent agent not found' };
  const subAgent = store.put('agents', { id: id('agent'), name: `Sub-Agent of ${parent.name}`, role: 'Sub-Agent', department: parent.department, capabilities: [...new Set([...(parent.capabilities || []), ...capabilities])], tools: [...(parent.tools || [])], state: 'available', heartbeatAt: now(), metadata: { parentAgentId, isSubAgent: true, originalTask: task?.title || task?.id, createdAt: now() } });
  store.addEvent('agent.sub_agent_created', { subAgentId: subAgent.id, parentAgentId, taskTitle: task?.title });
  recordActivity({ agentId: parentAgentId, type: 'sub_agent_created', description: `Created sub-agent: ${subAgent.name}`, projectId, taskId: task?.id });
  return subAgent;
}

export function getSubAgents(parentAgentId) { return store.list('agents').filter(a => a.metadata?.parentAgentId === parentAgentId); }

export function requestHelp({ fromAgentId, toAgentId, task, message, projectId }) {
  const msg = sendMessage({ fromAgentId, toAgentId, type: 'request', subject: `Help needed: ${task?.title || 'Task'}`, body: message || `Agent ${fromAgentId} needs help with task: ${task?.title}`, taskId: task?.id, projectId });
  recordActivity({ agentId: fromAgentId, type: 'help_requested', description: 'Requested help from another agent', projectId, taskId: task?.id, metadata: { toAgentId, messageId: msg.id } });
  return msg;
}

export function getAgentConversation(agentId1, agentId2, { limit = 20 } = {}) {
  const messages = store.list('messages');
  return messages.filter(m => (m.fromAgentId === agentId1 && m.toAgentId === agentId2) || (m.fromAgentId === agentId2 && m.toAgentId === agentId1)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(0, limit);
}
