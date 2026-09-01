import { id, now } from './core.js';
import { store } from './store.js';
import { seedAgents, listAgents } from './agents.js';
import { planCommand } from './orchestrator.js';
import { remember } from './memory.js';

/**
 * Process a chat message — conversational assistant with optional command execution
 */
export async function processChatMessage({ message, userId = 'founder', env = {} }) {
  const text = String(message || '').trim();
  if (!text) return { error: 'Message is required' };

  const userMsg = {
    id: id('chat'), role: 'user', userId,
    content: text, timestamp: now(), status: 'processed'
  };
  store.put('chat_messages', userMsg);
  store.addEvent('chat.user_message', { messageId: userMsg.id, userId, content: text.substring(0, 200) });

  const intent = analyzeIntent(text);
  let response;

  switch (intent.type) {
    case 'command': response = await handleCommand(text, intent, env); break;
    case 'question': response = handleQuestion(text, intent); break;
    case 'discuss': response = handleDiscussion(text, intent); break;
    case 'status': response = handleStatusRequest(text, intent); break;
    case 'help': response = handleHelp(text); break;
    case 'about': response = handleAbout(text, intent); break;
    case 'project': response = handleProjectInfo(text, intent); break;
    default: response = handleConversation(text, intent);
  }

  const assistantMsg = {
    id: id('chat'), role: 'assistant', userId: 'mauli',
    content: response.text, actions: response.actions || [],
    timestamp: now(), status: 'sent'
  };
  store.put('chat_messages', assistantMsg);
  store.addEvent('chat.assistant_response', { messageId: assistantMsg.id, responseLength: response.text.length });

  return { userMessage: userMsg, assistantMessage: assistantMsg, response };
}

function analyzeIntent(text) {
  const lower = text.toLowerCase();

  // Explicit build commands
  if (/^(build|create|make|generate|develop|design|implement|start)\s+(a |an |the |my )?/i.test(text)) {
    return { type: 'command', action: 'execute', category: 'create' };
  }

  // Questions
  if (/\?/.test(text) || /^(what|how|why|when|where|who|which|can you|could you|tell me|explain|describe)/i.test(text)) {
    return { type: 'question', action: 'answer' };
  }

  // About MAULI / system
  if (/(mauli|system|platform|you|yourself|what are you|who are you|about)/i.test(lower)) {
    return { type: 'about', action: 'info' };
  }

  // Project info
  if (/(project|task|agent|team|progress|status|history|completed|active)/i.test(lower)) {
    return { type: 'project', action: 'info' };
  }

  // Discussion topics (weather, tech, general knowledge, opinions)
  if (/(weather|news|today|music|movie|food|travel|sports|tech|ai|coding|programming|javascript|python|web|app|phone|android|iphone|laptop|computer|food|restaurant|price|cost|best|worst|recommend|suggestion|opinion|think|feel|love|hate|good|bad|great|awesome|terrible|help|please|thanks|thank|hello|hi|hey|good morning|good night|how are you|what's up)/i.test(lower)) {
    return { type: 'discuss', action: 'chat' };
  }

  // Edit/modify requests
  if (/^(edit|change|modify|update|fix|repair|improve|enhance)\b/i.test(text)) {
    return { type: 'command', action: 'execute', category: 'edit' };
  }

  // Status requests
  if (/^(status|show|display|list|show me)\b/i.test(text)) {
    return { type: 'status', action: 'query' };
  }

  // Default: conversational
  return { type: 'discuss', action: 'chat' };
}

// ═══ CONVERSATIONAL RESPONSES ═══

function handleConversation(text, intent) {
  const lower = text.toLowerCase();

  // Greetings
  if (/^(hi|hello|hey|good morning|good evening|good night|namaste|namaskar)/i.test(lower)) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return {
      text: `${greeting}! 👋 I'm MAULI, your AI assistant.\n\nI can help you with:\n• 💬 Discuss any topic — tech, ideas, projects\n• 🔍 Answer questions about anything\n• 🚀 Build apps, websites, or tools\n• 📊 Check your project status\n• 🤖 Manage your AI agent team\n\nWhat would you like to talk about?`,
      actions: []
    };
  }

  // How are you
  if (/how are you|how('s| is) it going|what('s| is) up|kasa ahe|kay chal|intezaar/i.test(lower)) {
    const projectCount = store.list('projects').length;
    const agentCount = store.list('agents').length;
    return {
      text: `I'm doing great! 🎉 Here's my status:\n\n🤖 **Agents:** ${agentCount} active and ready\n📁 **Projects:** ${projectCount} in the system\n⚡ **System:** All systems operational\n\nI'm always ready to help! What would you like to work on?`,
      actions: []
    };
  }

  // Thanks
  if (/^(thanks?|thank you|dhanyavaad|shukriya|cheers)/i.test(lower)) {
    return {
      text: `You're welcome! 😊 I'm always here to help.\n\nIs there anything else you'd like to discuss or build?`,
      actions: []
    };
  }

  // Opinions
  if (/what do you think|your opinion|do you like|best|worst|recommend|suggest/i.test(lower)) {
    return {
      text: `Great question! Here's my take:\n\nAs MAULI, I'm designed to help you build amazing things. My strengths are:\n\n🎯 **Project Planning** — I break down complex ideas into actionable steps\n🤖 **Multi-Agent Team** — 18 specialized agents working together\n🚀 **Full-Stack Building** — Web, mobile, desktop, and more\n📊 **Smart Learning** — I improve with every project\n\nWant me to demonstrate any of these capabilities? Just tell me what you want to build!`,
      actions: []
    };
  }

  // General conversation — be conversational and helpful
  const responses = [
    `That's interesting! Tell me more about what you're thinking.\n\nI can help with:\n• 💡 Brainstorming ideas\n• 🔍 Research and information\n• 🚀 Building projects\n• 📊 System management\n\nWhat would you like to explore?`,
    `I understand! As your AI assistant, I'm here to help with anything you need.\n\nWhether it's:\n• 💬 Discussing ideas and concepts\n• 🔍 Finding information\n• 🚀 Creating something new\n• 📊 Managing your projects\n\nJust let me know what you'd like to do!`,
    `Got it! I'm listening. 😊\n\nYou can ask me about:\n• 🤖 MAULI and how I work\n• 📁 Your projects and progress\n• 💡 Any topic you're curious about\n• 🚀 Building something new\n\nWhat's on your mind?`
  ];

  return {
    text: responses[Math.floor(Math.random() * responses.length)],
    actions: []
  };
}

// ═══ DISCUSSION HANDLER ═══

function handleDiscussion(text, intent) {
  const lower = text.toLowerCase();

  // Technology discussions
  if (/(ai|artificial intelligence|machine learning|ml|deep learning|neural|gpt|llm|chatgpt|openai|claude|gemini)/i.test(lower)) {
    return {
      text: `🤖 **AI & Machine Learning** — fascinating topic!\n\nHere's what's happening in AI right now:\n\n🧠 **Large Language Models** — GPT-4, Claude, Gemini are pushing boundaries\n🎨 **Generative AI** — Creating images, music, code, and more\n🚗 **Autonomous Systems** — Self-driving, robotics, drones\n🏥 **AI in Healthcare** — Drug discovery, diagnostics, personalized medicine\n\n**As MAULI, I use AI to:**\n• Plan and execute software projects\n• Generate code across multiple languages\n• Learn from each project to improve\n• Coordinate 18 specialized AI agents\n\nWant to build something with AI? Just tell me what!`,
      actions: []
    };
  }

  if (/(web|website|html|css|javascript|react|node|frontend|backend|fullstack|full-stack)/i.test(lower)) {
    return {
      text: `🌐 **Web Development** — my specialty!\n\n**Modern Web Stack:**\n• ⚛️ React/Vue/Angular for frontend\n• 🟢 Node.js/Python for backend\n• 🗄️ PostgreSQL/MongoDB for databases\n• ☁️ Cloud deployment (AWS, Vercel, Netlify)\n\n**I can build:**\n• Landing pages & portfolios\n• E-commerce stores\n• SaaS applications\n• Dashboard & admin panels\n• API backends\n\nJust say "Build a [type] website" and I'll get started!`,
      actions: []
    };
  }

  if (/(android|ios|mobile|app|phone|flutter|react native|swift|kotlin)/i.test(lower)) {
    return {
      text: `📱 **Mobile Development** — let's build something!\n\n**Options:**\n• 🤖 Android (Kotlin/Java)\n• 🍎 iOS (Swift/SwiftUI)\n• 🔄 Cross-platform (Flutter/React Native)\n• 🌐 Progressive Web Apps (PWA)\n\n**I can create:**\n• Native Android/iOS apps\n• Cross-platform apps\n• Mobile-optimized web apps\n• App Store ready builds\n\nSay "Build a [type] app for Android/iOS" and I'll handle it!`,
      actions: []
    };
  }

  if (/(pdf|document|report|invoice|resume|cv|certificate)/i.test(lower)) {
    return {
      text: `📄 **Document Generation** — I've got you covered!\n\n**I can create:**\n• 📄 PDF documents & reports\n• 📊 Data visualizations\n• 📋 Invoices & receipts\n• 📝 Resumes & CVs\n• 🎓 Certificates\n• 📈 Business reports\n\nJust tell me what document you need and I'll generate it!`,
      actions: []
    };
  }

  if (/(music|song|video|player|stream|audio)/i.test(lower)) {
    return {
      text: `🎵 **Media & Entertainment** — great topic!\n\n**I can build:**\n• 🎵 Music players & streaming apps\n• 🎬 Video players & galleries\n• 📻 Podcast apps\n• 🎮 Interactive media experiences\n• 📱 Media management tools\n\nWant me to build a music or video app? Just describe what you need!`,
      actions: []
    };
  }

  if (/(weather|forecast|temperature|rain|sun)/i.test(lower)) {
    return {
      text: `🌤️ **Weather** — I can help with that!\n\n**I can build:**\n• 🌤️ Weather apps with live data\n• 🗺️ Radar maps & forecasts\n• ⚠️ Severe weather alerts\n• 📊 Historical weather analytics\n\nWant a weather app? Just say "Build a weather app" and I'll create it with real-time data!`,
      actions: []
    };
  }

  if (/(game|gaming|play|fun|entertainment)/i.test(lower)) {
    return {
      text: `🎮 **Games & Entertainment** — fun topic!\n\n**I can build:**\n• 🎮 Browser games (2D/3D)\n• 🧩 Puzzle & trivia games\n• 🎯 Strategy games\n• 🏃 Action & arcade games\n• 📱 Mobile games\n\nWant me to build a game? Tell me what kind and I'll make it happen!`,
      actions: []
    };
  }

  if (/(ecommerce|shop|store|buy|sell|product|cart|payment|stripe)/i.test(lower)) {
    return {
      text: `🛒 **E-Commerce** — let's build a store!\n\n**Features I can include:**\n• 🛍️ Product catalog & search\n• 🛒 Shopping cart & checkout\n• 💳 Payment integration (Stripe, Razorpay)\n• 📦 Order management\n• 👤 User accounts & auth\n• 📊 Analytics dashboard\n\nSay "Build an e-commerce store" and I'll create a full online shop!`,
      actions: []
    };
  }

  // General discussion — be conversational
  return {
    text: `That's a great topic! 💡\n\nI'd love to discuss this with you. As MAULI, I can:\n\n• 💬 Chat about any subject\n• 🔍 Share knowledge and insights\n• 💡 Help brainstorm ideas\n• 🚀 Turn ideas into real projects\n\n**Want to go deeper?** I can:\n• Build an app around this topic\n• Research more information\n• Create a project plan\n\nWhat would you like to do next?`,
    actions: []
  };
}

// ═══ ABOUT MAULI ═══

function handleAbout(text, intent) {
  const lower = text.toLowerCase();
  const projectCount = store.list('projects').length;
  const taskCount = store.list('tasks').length;
  const agentCount = store.list('agents').length;
  const artifactCount = store.list('artifacts').length;

  return {
    text: `🤖 **MAULI 2.0** — Your AI Command Center\n\nI'm an autonomous AI platform that can build anything you imagine!\n\n📊 **System Stats:**\n• ${projectCount} projects created\n• ${taskCount} tasks executed\n• ${agentCount} AI agents active\n• ${artifactCount} artifacts generated\n\n🛠️ **What I Can Build:**\n• 🌐 Websites & web apps\n• 📱 Android & iOS apps\n• 🖥️ Desktop applications\n• 📄 PDF documents\n• 🎮 Games & interactive tools\n• 🛒 E-commerce stores\n• And much more!\n\n🧠 **How I Work:**\n1. You tell me what to build\n2. I plan the project\n3. My agent team executes\n4. You get the final product\n\nJust tell me what you want to create!`,
    actions: []
  };
}

// ═══ PROJECT INFO ═══

function handleProjectInfo(text, intent) {
  const lower = text.toLowerCase();
  const projects = store.list('projects');
  const agents = store.list('agents');
  const tasks = store.list('tasks');

  if (/(how many|count|total)/i.test(lower)) {
    return {
      text: `📊 **System Overview:**\n\n• 📁 **Projects:** ${projects.length}\n• 📋 **Tasks:** ${tasks.length}\n• 🤖 **Agents:** ${agents.length}\n• 📦 **Artifacts:** ${store.list('artifacts').length}\n\nAll systems operational! ✅`,
      actions: []
    };
  }

  if (/(completed|done|finished)/i.test(lower)) {
    const completed = projects.filter(p => p.state === 'completed');
    return {
      text: `✅ **Completed Projects:** ${completed.length}\n\n${completed.slice(-5).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id}`).join('\n') || 'No completed projects yet.'}\n\nWant me to build something new?`,
      actions: []
    };
  }

  if (/(active|working|progress|running)/i.test(lower)) {
    const active = projects.filter(p => p.state === 'active' || p.state === 'working');
    return {
      text: `🔄 **Active Projects:** ${active.length}\n\n${active.slice(-5).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id} (${p.state})`).join('\n') || 'No active projects.'}\n\nNeed anything else?`,
      actions: []
    };
  }

  if (/(agent|team|worker)/i.test(lower)) {
    const available = agents.filter(a => a.state === 'available').length;
    return {
      text: `👥 **Agent Team:** ${agents.length} agents\n\n✅ Available: ${available}\n🔄 Working: ${agents.length - available}\n\n**Agents:**\n${agents.map(a => `• ${a.name} (${a.capabilities?.join(', ') || 'general'})`).join('\n')}\n\nMy team is ready to work!`,
      actions: []
    };
  }

  // General project info
  const completed = projects.filter(p => p.state === 'completed').length;
  const active = projects.filter(p => p.state === 'active').length;
  return {
    text: `📁 **Project Status:**\n\n• ✅ Completed: ${completed}\n• 🔄 Active: ${active}\n• 📊 Total: ${projects.length}\n\n**Recent Projects:**\n${projects.slice(-5).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id} [${p.state}]`).join('\n') || 'No projects yet.'}\n\nWant to start a new project? Just tell me what to build!`,
    actions: []
  };
}

// ═══ COMMAND HANDLER ═══

async function handleCommand(text, intent, env) {
  try {
    seedAgents();
    const result = await planCommand(text, env);
    const project = result.project;
    const tasks = result.tasks || [];
    const status = result.status || 'unknown';

    let responseText = `🚀 **Project Created!**\n\n`;
    responseText += `📋 **Name:** ${project?.name || 'Unknown'}\n`;
    responseText += `📝 **Objective:** ${project?.objective || text}\n`;
    responseText += `📊 **Status:** ${status}\n`;
    responseText += `🎯 **Tasks:** ${tasks.length}\n\n`;

    if (tasks.length > 0) {
      responseText += `**Task Pipeline:**\n`;
      for (const t of tasks.slice(0, 6)) {
        const task = t.task || t;
        const state = task.state || 'queued';
        const icon = state === 'completed' ? '✅' : state === 'working' ? '🔄' : state === 'failed' ? '❌' : '⏳';
        responseText += `${icon} ${task.title || 'Task'}\n`;
      }
      if (tasks.length > 6) responseText += `... and ${tasks.length - 6} more\n`;
    }

    responseText += `\n💡 You can track progress in the Projects tab!`;
    return { text: responseText, actions: [{ type: 'project_created', projectId: project?.id, taskCount: tasks.length }] };
  } catch (error) {
    return { text: `❌ **Error:** ${error.message}\n\nPlease try again or rephrase.`, actions: [{ type: 'error', error: error.message }] };
  }
}

// ═══ QUESTION HANDLER ═══

function handleQuestion(text, intent) {
  const lower = text.toLowerCase();

  if (/how many (project|task|agent)/i.test(lower)) {
    return { text: `📊 **Counts:**\n• Projects: ${store.list('projects').length}\n• Tasks: ${store.list('tasks').length}\n• Agents: ${store.list('agents').length}`, actions: [] };
  }

  if (/what (is|are) (mauli|this system|this platform)/i.test(lower)) {
    return handleAbout(text, intent);
  }

  if (/(who|what) (are|r) you/i.test(lower)) {
    return handleAbout(text, intent);
  }

  if (/how (do|does|can) (i|you|this)/i.test(lower)) {
    return {
      text: `💡 **How it works:**\n\n1. **Tell me what to build** — describe your idea\n2. **I plan the project** — break it into tasks\n3. **My agents execute** — 18 specialists work on it\n4. **You get the result** — download and use!\n\n**Example commands:**\n• "Build a weather app"\n• "Create an e-commerce store"\n• "Make a PDF generator"\n\nWant to try?`,
      actions: []
    };
  }

  if (/(can you|are you able|do you)/i.test(lower)) {
    return {
      text: `✅ **Yes, I can!** Here's what I'm capable of:\n\n🌐 **Web:** Websites, web apps, APIs\n📱 **Mobile:** Android, iOS, cross-platform\n🖥️ **Desktop:** Windows, Mac, Linux apps\n📄 **Documents:** PDFs, reports, certificates\n🎮 **Games:** Browser games, interactive tools\n🛒 **Commerce:** E-commerce stores, payment systems\n\n**Just describe what you need and I'll build it!**`,
      actions: []
    };
  }

  return {
    text: `That's a great question! 💡\n\nI'm MAULI, your AI assistant. I can help with:\n• 🚀 Building projects\n• 💬 Discussing topics\n• 📊 Checking status\n• 🤖 Managing agents\n\nAsk me anything!`,
    actions: []
  };
}

// ═══ STATUS HANDLER ═══

function handleStatusRequest(text, intent) {
  const projects = store.list('projects');
  const tasks = store.list('tasks');
  const agents = store.list('agents');
  const completed = projects.filter(p => p.state === 'completed').length;
  const active = projects.filter(p => p.state === 'active').length;
  const working = tasks.filter(t => t.state === 'working').length;

  return {
    text: `📊 **System Status:**\n\n📁 **Projects:** ${projects.length} (${completed} completed, ${active} active)\n📋 **Tasks:** ${tasks.length} (${working} working)\n🤖 **Agents:** ${agents.length}\n📦 **Artifacts:** ${store.list('artifacts').length}\n\n✅ All systems operational!`,
    actions: []
  };
}

// ═══ HELP HANDLER ═══

function handleHelp(text) {
  return {
    text: `🤖 **MAULI Chat — What I Can Do:**\n\n💬 **Discuss Topics:**\n• Ask about tech, AI, coding, or anything!\n• Get opinions, recommendations, insights\n• Brainstorm ideas together\n\n🚀 **Build Projects:**\n• "Build a weather app"\n• "Create an e-commerce store"\n• "Make a calculator"\n\n📊 **Check Status:**\n• "How many projects?"\n• "Show active projects"\n• "What's the system status?"\n\n🤖 **About MAULI:**\n• "What is MAULI?"\n• "How does this work?"\n• "What can you do?"\n\n💡 **Tips:**\n• Be specific about what you want\n• I learn and improve over time\n• Ask me anything — I'm here to help!`,
    actions: []
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
    return ts && Date.now() - ts < 3600000;
  });
  return recent;
}

/**
 * Clone a project
 */
export function cloneProject(projectId, newObjective = null) {
  const original = store.get('projects', projectId);
  if (!original) return { error: 'Project not found' };
  const tasks = store.list('tasks').filter(t => t.projectId === projectId);
  const artifacts = store.list('artifacts').filter(a => a.projectId === projectId);
  const newId = id('project');
  const newProject = store.put('projects', {
    id: newId, name: `Clone: ${original.name}`,
    objective: newObjective || original.objective,
    founderCommand: `Clone of: ${original.founderCommand || original.objective}`,
    requirements: [...(original.requirements || [])],
    state: 'planning', clonedFrom: projectId,
    createdAt: now(), updatedAt: now()
  });
  store.addEvent('project.created', { projectId: newId, clonedFrom: projectId });
  for (const task of tasks) {
    const taskId = id('task');
    store.put('tasks', {
      id: taskId, projectId: newId, title: task.title, description: task.description,
      requiredCapabilities: task.requiredCapabilities, risk: task.risk, executor: task.executor,
      sequence: task.sequence, dependsOn: [], maxAttempts: task.maxAttempts || 3,
      state: 'queued', createdAt: now(), updatedAt: now()
    });
  }
  remember({ type: 'project_requirement', content: `Cloned project ${projectId} to ${newProject.id}`,
    scope: 'project', scopeId: newProject.id, importance: 'normal', source: 'clone' });
  return { project: newProject, originalId: projectId, clonedTaskCount: tasks.length, clonedArtifactCount: artifacts.length };
}
