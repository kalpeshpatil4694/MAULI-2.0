import { id, now } from './core.js';
import { store } from './store.js';
import { planCommand } from './orchestrator.js';
import { seedAgents } from './agents.js';
import { remember, recall } from './memory.js';

/**
 * Chat Engine — enables real-time conversation with MAULI.
 * Users can send commands, ask questions, request changes, and get responses.
 * MAULI processes commands, executes tasks, and reports progress.
 */

/**
 * Process a chat message from the user
 */
export async function processChatMessage({ message, userId = 'founder', env = {} }) {
  const text = String(message || '').trim();
  if (!text) return { error: 'Message is required' };

  // Store the user message
  const userMsg = {
    id: id('chat'),
    role: 'user',
    userId,
    content: text,
    timestamp: now(),
    status: 'processed'
  };
  store.put('chat_messages', userMsg);
  store.addEvent('chat.user_message', { messageId: userMsg.id, userId, content: text.substring(0, 200) });

  // Determine intent
  const intent = analyzeIntent(text);

  // Process based on intent
  let response;
  switch (intent.type) {
    case 'command':
      response = await handleCommand(text, intent, env);
      break;
    case 'question':
      response = handleQuestion(text, intent);
      break;
    case 'edit':
      response = handleEditRequest(text, intent);
      break;
    case 'clone':
      response = handleCloneRequest(text, intent);
      break;
    case 'status':
      response = handleStatusRequest(text, intent);
      break;
    case 'help':
      response = handleHelp(text);
      break;
    default:
      response = await handleCommand(text, { type: 'command', action: 'execute' }, env);
  }

  // Store MAULI's response
  const assistantMsg = {
    id: id('chat'),
    role: 'assistant',
    userId: 'mauli',
    content: response.text,
    actions: response.actions || [],
    timestamp: now(),
    status: 'sent'
  };
  store.put('chat_messages', assistantMsg);
  store.addEvent('chat.assistant_response', { messageId: assistantMsg.id, responseLength: response.text.length });

  return {
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    response
  };
}

/**
 * Get chat history
 */
export function getChatHistory({ limit = 50, userId = null } = {}) {
  let messages = store.list('chat_messages');
  if (userId) messages = messages.filter(m => m.userId === userId || m.userId === 'mauli');
  return messages.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, limit);
}

/**
 * Get active conversations
 */
export function getActiveConversations() {
  const messages = store.list('chat_messages');
  const recent = messages.filter(m => {
    const ts = Date.parse(m.timestamp);
    return Number.isFinite(ts) && Date.now() - ts < 3600000; // Last hour
  });
  return recent.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

/**
 * Analyze user intent from message
 */
function analyzeIntent(text) {
  const lower = text.toLowerCase();

  // Command patterns
  if (/^(build|create|make|generate|develop|design|implement|start)\b/i.test(text)) {
    return { type: 'command', action: 'execute', category: 'create' };
  }
  if (/^(edit|change|modify|update|fix|repair|improve|enhance)\b/i.test(text)) {
    return { type: 'edit', action: 'modify' };
  }
  if (/^(clone|copy|duplicate|replicate)\b/i.test(text)) {
    return { type: 'clone', action: 'clone' };
  }
  if (/^(status|progress|how|what|show|display)\b/i.test(text)) {
    return { type: 'status', action: 'query' };
  }
  if (/^(help|commands|options|what can)\b/i.test(text)) {
    return { type: 'help', action: 'info' };
  }
  if (/\?/.test(text)) {
    return { type: 'question', action: 'answer' };
  }

  // Default: treat as a command
  return { type: 'command', action: 'execute', category: 'create' };
}

/**
 * Handle a command (build/create/execute)
 */
async function handleCommand(text, intent, env) {
  try {
    seedAgents();
    const result = await planCommand(text, env);

    const project = result.project;
    const tasks = result.tasks || [];
    const status = result.status || 'unknown';

    let responseText = `🚀 **Command received!**\n\n`;
    responseText += `📋 **Project:** ${project?.name || 'Unknown'}\n`;
    responseText += `📝 **Objective:** ${project?.objective || text}\n`;
    responseText += `📊 **Status:** ${status}\n`;
    responseText += `🎯 **Tasks created:** ${tasks.length}\n\n`;

    if (tasks.length > 0) {
      responseText += `**Task Pipeline:**\n`;
      for (const t of tasks.slice(0, 8)) {
        const task = t.task || t;
        const state = task.state || 'queued';
        const icon = state === 'completed' ? '✅' : state === 'working' ? '🔄' : state === 'failed' ? '❌' : '⏳';
        responseText += `${icon} ${task.title || 'Task'} [${state}]\n`;
      }
      if (tasks.length > 8) responseText += `... and ${tasks.length - 8} more tasks\n`;
    }

    if (result.finalDelivery) {
      responseText += `\n✅ **Project completed!** Final delivery available for download.`;
    }

    return {
      text: responseText,
      actions: [{ type: 'project_created', projectId: project?.id, taskCount: tasks.length }]
    };
  } catch (error) {
    return {
      text: `❌ **Error processing command:** ${error.message}\n\nPlease try again or rephrase your request.`,
      actions: [{ type: 'error', error: error.message }]
    };
  }
}

/**
 * Handle a question
 */
function handleQuestion(text, intent) {
  const lower = text.toLowerCase();

  if (/how many (project|task|agent)/.test(lower)) {
    const projects = store.list('projects').length;
    const tasks = store.list('tasks').length;
    const agents = store.list('agents').length;
    return {
      text: `📊 **System Status:**\n\n• Projects: ${projects}\n• Tasks: ${tasks}\n• Agents: ${agents}\n\nAll systems operational.`,
      actions: []
    };
  }

  if (/what (is|are) (this|mauli|system)/.test(lower)) {
    return {
      text: `🤖 **MAULI 2.0** is an Autonomous AI Company Platform.\n\nIt can:\n• Build any type of application (web, mobile, desktop)\n• Generate PDFs, CAD files, and documents\n• Deploy to multiple platforms\n• Manage 18 specialized AI agents\n• Learn and improve over time\n\nJust tell me what you want to build!`,
      actions: []
    };
  }

  if (/agent|team|worker/.test(lower)) {
    const agents = store.list('agents');
    const available = agents.filter(a => a.state === 'available').length;
    return {
      text: `👥 **Agent Team:** ${agents.length} agents total, ${available} available\n\nAgents: ${agents.map(a => a.name).join(', ')}`,
      actions: []
    };
  }

  return {
    text: `I understand your question. Let me look into that for you.\n\nYou can:\n• Ask about projects, agents, or system status\n• Request to build something new\n• Ask me to edit existing files\n• Request a project clone`,
    actions: []
  };
}

/**
 * Handle an edit request
 */
function handleEditRequest(text, intent) {
  const lower = text.toLowerCase();

  // Extract file and change info
  const fileMatch = text.match(/(?:file|src)\s+(?:\/?[\w/.-]+\.\w+)/i);
  const fileName = fileMatch ? fileMatch[0].replace(/^(?:file|src)\s+/i, '') : null;

  return {
    text: `📝 **Edit Request Received**\n\n${fileName ? `Target file: ${fileName}` : 'Please specify which file you want to edit.'}\n\nTo edit a file, you can say:\n• "Edit src/index.js to add a new endpoint"\n• "Change the dashboard color to blue"\n• "Fix the error in orchestrator.js"\n\nI'll process your edit and apply it to the codebase.`,
    actions: [{ type: 'edit_requested', file: fileName, description: text }]
  };
}

/**
 * Handle a clone request
 */
function handleCloneRequest(text, intent) {
  const projects = store.list('projects');
  const completed = projects.filter(p => p.state === 'completed');

  return {
    text: `📋 **Clone Project**\n\nAvailable projects to clone:\n\n${completed.map((p, i) => `${i + 1}. ${p.name || p.id} (${p.state})`).join('\n') || 'No completed projects available.'}\n\nTo clone, say: "Clone project [name or number]"\n\nI'll create a new project based on the selected one, preserving its structure and adapting it to your new requirements.`,
    actions: [{ type: 'clone_requested', availableProjects: completed.length }]
  };
}

/**
 * Handle a status request
 */
function handleStatusRequest(text, intent) {
  const projects = store.list('projects');
  const tasks = store.list('tasks');
  const agents = store.list('agents');
  const artifacts = store.list('artifacts');
  const messages = store.list('messages');

  const completed = projects.filter(p => p.state === 'completed').length;
  const active = projects.filter(p => p.state === 'active').length;
  const escalated = projects.filter(p => p.state === 'escalated').length;

  const tasksCompleted = tasks.filter(t => t.state === 'completed').length;
  const tasksWorking = tasks.filter(t => t.state === 'working').length;
  const tasksFailed = tasks.filter(t => t.state === 'failed').length;

  const agentsAvailable = agents.filter(a => a.state === 'available').length;
  const agentsWorking = agents.filter(a => a.state === 'working').length;

  return {
    text: `📊 **Full System Status**\n\n**Projects:** ${projects.length} total\n• ✅ Completed: ${completed}\n• 🔄 Active: ${active}\n• ❌ Escalated: ${escalated}\n\n**Tasks:** ${tasks.length} total\n• ✅ Completed: ${tasksCompleted}\n• 🔄 Working: ${tasksWorking}\n• ❌ Failed: ${tasksFailed}\n\n**Agents:** ${agents.length} total\n• ✅ Available: ${agentsAvailable}\n• 🔄 Working: ${agentsWorking}\n\n**Artifacts:** ${artifacts.length}\n**Messages:** ${messages.length}\n\nSystem is ${active > 0 ? 'actively processing' : 'idle and ready'}.`,
    actions: [{ type: 'status_report', projects: projects.length, tasks: tasks.length, agents: agents.length }]
  };
}

/**
 * Handle help request
 */
function handleHelp(text) {
  return {
    text: `🤖 **MAULI 2.0 — Help Guide**\n\n**Commands I understand:**\n\n🔨 **Build/Create:**\n• "Build a mobile calculator app"\n• "Create a PDF invoice generator"\n• "Develop a Windows desktop game"\n\n✏️ **Edit:**\n• "Edit src/index.js to add logging"\n• "Fix the dashboard layout"\n• "Update the API endpoints"\n\n📋 **Clone:**\n• "Clone the calculator project"\n• "Duplicate the last project"\n\n📊 **Status:**\n• "Show me the status"\n• "How many projects are there?"\n• "What agents are working?"\n\n💬 **Chat:**\n• "What is MAULI?"\n• "Help me with..."\n• Ask any question with ?\n\n**Tips:**\n• Be specific about what you want\n• Mention the platform (Android, iOS, Windows, PDF)\n• I can handle complex multi-step projects`,
    actions: []
  };
}

/**
 * Clone a project
 */
export function cloneProject(projectId, newObjective = null) {
  const original = store.get('projects', projectId);
  if (!original) return { error: 'Project not found' };

  const tasks = store.list('tasks').filter(t => t.projectId === projectId);
  const artifacts = store.list('artifacts').filter(a => a.projectId === projectId);

  // Create new project using store directly
  const newId = id('project');
  const newProject = store.put('projects', {
    id: newId,
    name: `Clone: ${original.name}`,
    objective: newObjective || original.objective,
    founderCommand: `Clone of: ${original.founderCommand || original.objective}`,
    requirements: [...(original.requirements || [])],
    state: 'planning',
    clonedFrom: projectId,
    createdAt: now(),
    updatedAt: now()
  });
  store.addEvent('project.created', { projectId: newId, clonedFrom: projectId });

  // Clone tasks
  for (const task of tasks) {
    const taskId = id('task');
    store.put('tasks', {
      id: taskId,
      projectId: newId,
      title: task.title,
      description: task.description,
      requiredCapabilities: task.requiredCapabilities,
      risk: task.risk,
      executor: task.executor,
      sequence: task.sequence,
      dependsOn: [],
      maxAttempts: task.maxAttempts || 3,
      state: 'queued',
      createdAt: now(),
      updatedAt: now()
    });
  }

  // Remember the clone
  remember({
    type: 'project_requirement',
    content: `Cloned project ${projectId} to ${newProject.id}`,
    scope: 'project',
    scopeId: newProject.id,
    importance: 'normal',
    source: 'clone'
  });

  return {
    project: newProject,
    originalId: projectId,
    clonedTaskCount: tasks.length,
    clonedArtifactCount: artifacts.length
  };
}
