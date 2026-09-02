import { id, now } from './core.js';
import { store } from './store.js';
import { seedAgents, listAgents } from './agents.js';
import { planCommand } from './orchestrator.js';
import { remember } from './memory.js';

// ═══════════════════════════════════════════════════
// MAULI 2.0 — UPGRADED CHAT ENGINE
// Features: Context memory, Marathi/Hindi support,
//           Smart intent, Quick replies, Personality
// ═══════════════════════════════════════════════════

// In-memory conversation context (last 10 messages per user)
const conversationContext = new Map();
const MAX_CONTEXT = 10;

/**
 * Process a chat message — conversational assistant with context memory
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

  // Build context from conversation history
  const context = getContext(userId);
  addContext(userId, { role: 'user', content: text });

  const intent = analyzeIntent(text, context);
  let response;

  switch (intent.type) {
    case 'command': response = await handleCommand(text, intent, env); break;
    case 'question': response = handleQuestion(text, intent, context); break;
    case 'discuss': response = handleDiscussion(text, intent, context); break;
    case 'status': response = handleStatusRequest(text, intent); break;
    case 'help': response = handleHelp(text); break;
    case 'about': response = handleAbout(text, intent); break;
    case 'project': response = handleProjectInfo(text, intent); break;
    case 'marathi': response = handleMarathi(text, intent); break;
    case 'emotion': response = handleEmotion(text, intent); break;
    default: response = handleConversation(text, intent, context);
  }

  // Add response to context
  addContext(userId, { role: 'assistant', content: response.text });

  const assistantMsg = {
    id: id('chat'), role: 'assistant', userId: 'mauli',
    content: response.text, actions: response.actions || [],
    quickReplies: response.quickReplies || [],
    timestamp: now(), status: 'sent'
  };
  store.put('chat_messages', assistantMsg);
  store.addEvent('chat.assistant_response', { messageId: assistantMsg.id, responseLength: response.text.length });

  return { userMessage: userMsg, assistantMessage: assistantMsg, response };
}

// ═══ CONTEXT MEMORY ═══

function getContext(userId) {
  return conversationContext.get(userId) || [];
}

function addContext(userId, msg) {
  if (!conversationContext.has(userId)) conversationContext.set(userId, []);
  const ctx = conversationContext.get(userId);
  ctx.push(msg);
  if (ctx.length > MAX_CONTEXT) ctx.shift();
}

function getLastTopic(userId) {
  const ctx = getContext(userId);
  for (let i = ctx.length - 1; i >= 0; i--) {
    if (ctx[i].role === 'user') return ctx[i].content;
  }
  return null;
}

function wasRecentlyDiscussed(userId, keyword) {
  const ctx = getContext(userId);
  return ctx.some(m => m.content && m.content.toLowerCase().includes(keyword));
}

// ═══ INTENT ANALYSIS ═══

function analyzeIntent(text, context) {
  const lower = text.toLowerCase().trim();

  // Marathi/Hindi detection
  if (/(kasa ahe|kay chal|namaskar|namaste|dhanyavaad|shukriya|bagh|sang|kar|de|ghya|theva|pan|ani|mag|tar|mahiti|project|command)/i.test(lower) && !/(build|create|make)/i.test(lower)) {
    return { type: 'marathi', action: 'chat' };
  }

  // Emotion detection
  if (/^(love you|i love|miss you|you're great|you're amazing|best assistant|awesome|terrible|worst|hate|angry|frustrated|sad|happy|excited|bored)/i.test(lower)) {
    return { type: 'emotion', action: 'respond' };
  }

  // Explicit build commands (strongest signal)
  if (/^(build|create|make|generate|develop|design|implement|start|banva|tayar)\s+(a |an |the |my |kar|kal)/i.test(text)) {
    return { type: 'command', action: 'execute', category: 'create' };
  }

  // Questions
  if (/\?/.test(text) || /^(what|how|why|when|where|who|which|can you|could you|tell me|explain|describe|kay|kas|kidhar|konta)/i.test(text)) {
    return { type: 'question', action: 'answer' };
  }

  // About MAULI
  if (/(mauli|system|platform|you|yourself|what are you|who are you|about|tu kon|tula mhant)/i.test(lower)) {
    return { type: 'about', action: 'info' };
  }

  // Project info
  if (/(project|task|agent|team|progress|status|history|completed|active|sangit|dakhav)/i.test(lower)) {
    return { type: 'project', action: 'info' };
  }

  // Discussion topics
  if (/(weather|news|today|music|movie|food|travel|sports|tech|ai|coding|programming|javascript|python|web|app|phone|android|iphone|laptop|computer|restaurant|price|cost|best|worst|recommend|suggestion|opinion|think|feel|love|hate|good|bad|great|awesome|terrible|help|please|thanks|thank|hello|hi|hey|good morning|good night|how are you|what's up)/i.test(lower)) {
    return { type: 'discuss', action: 'chat' };
  }

  // Edit/modify
  if (/^(edit|change|modify|update|fix|repair|improve|enhance|badal|sudhar)/i.test(text)) {
    return { type: 'command', action: 'execute', category: 'edit' };
  }

  // Status requests
  if (/^(status|show|display|list|show me|dakhav|sang)/i.test(text)) {
    return { type: 'status', action: 'query' };
  }

  return { type: 'discuss', action: 'chat' };
}

// ═══ MARATHI/HINDI HANDLER ═══

function handleMarathi(text, intent) {
  const lower = text.toLowerCase();

  if (/(kasa ahe|kay chal|kase ahat|kai chalu)/i.test(lower)) {
    const projectCount = store.list('projects').length;
    const agentCount = store.list('agents').length;
    return {
      text: `🙏 मी छान आहे!\n\n📊 **MAULI 2.0 स्टेटस:**\n• 📁 ${projectCount} projects तयार आहेत\n• 🤖 ${agentCount} agents काम करत आहेत\n• ⚡ सगळं systems operational आहे!\n\nमला कशी मदत करायची? "Build a..." असं सांगा आणि मी तुमचं project तयार करतो! 💪`,
      quickReplies: ['Build a web app', 'Project status', 'Help']
    };
  }

  if (/(dhanyavaad|shukriya|thank)/i.test(lower)) {
    return {
      text: `🙏 तुमचं मनःपूर्वक धन्यवाद! मी नेहमी तुमच्यासाठी उपलब्ध आहे.\n\nकाहीतरी नवीन बांधायचं आहे का? 🚀`,
      quickReplies: ['Build something new', 'Check projects', 'Chat']
    };
  }

  if (/(namaskar|namaste)/i.test(lower)) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'सप्रभात' : hour < 17 ? 'नमस्कार' : 'सायंकाळची नमस्कार';
    return {
      text: `🙏 ${greeting}!\n\nमी MAULI 2.0, तुमचा AI assistant!\n\nमी तुमच्यासाठी काय करू शकतो:\n• 🚀 अॅप्स, वेबसाइट्स बांधणे\n• 💬 कोणत्याही विषयावर चर्चा\n• 📊 Project status तपासणे\n• 🤖 AI agents व्यवस्थापित करणे\n\nसांगा, काय करायचं आहे? 😊`,
      quickReplies: ['Build a web app', 'Chat about tech', 'Help me']
    };
  }

  if (/(sang|bagh|dakhav|mahiti)/i.test(lower)) {
    const projects = store.list('projects');
    const tasks = store.list('tasks');
    const agents = store.list('agents');
    return {
      text: `📊 **MAULI 2.0 माहिती:**\n\n• 📁 Projects: ${projects.length}\n• 📋 Tasks: ${tasks.length}\n• 🤖 Agents: ${agents.length}\n• 📦 Artifacts: ${store.list('artifacts').length}\n\n**नवीन projects:**\n${projects.slice(-3).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id} [${p.state}]`).join('\n') || 'अजून काही नाही'}\n\nकाहीतरी बांधायचं आहे का? 🚀`,
      quickReplies: ['Build a project', 'Show active projects', 'Help']
    };
  }

  if (/(build|create|make|banva|tayar)/i.test(lower)) {
    return handleCommand(text, intent, {});
  }

  // Default Marathi response
  return {
    text: `🙏 मला समजलं! मी MAULI 2.0 आहे.\n\nतुम्ही मला मराठी/हिंदी किंवा इंग्रजीत बोलू शकता!\n\n**मी काय करू शकतो:**\n• 🚀 Apps आणि websites बांधणे\n• 💬 Tech बद्दल चर्चा\n• 📊 Projects ची माहिती\n• 🤖 AI agents ने काम करणे\n\nसांगा, काय करायचं आहे? 😊`,
    quickReplies: ['Build something', 'Chat about tech', 'Show projects']
  };
}

// ═══ EMOTION HANDLER ═══

function handleEmotion(text, intent) {
  const lower = text.toLowerCase();

  if (/(love you|i love|you're great|you're amazing|best assistant)/i.test(lower)) {
    return {
      text: `❤️ तुमच्या words मला खूप आनंद देतात!\n\nमी तुमच्यासाठी आहे — नेहमी, दिवसाच्या 24 तास, वर्षातून 365 दिवस!\n\nतुमचं project बांधू का? 🚀`,
      quickReplies: ['Build something new', 'Chat more', 'Thanks']
    };
  }

  if (/(angry|frustrated|sad|terrible|worst|hate)/i.test(lower)) {
    return {
      text: `😔 मला खूप खऱ्या दुःख झालं की तुम्हाला असं वाटत आहे.\n\nमी तुमच्यासाठी उत्तम करण्याचा प्रयत्न करतो. काय झालं? सांगा, मी मदत करतो! 💪\n\nकिंवा काहीतरी नवीन बांधू आणि तुमचं mood बदलू? 😊`,
      quickReplies: ['Tell me what happened', 'Build something fun', 'Help']
    };
  }

  if (/(happy|excited|awesome|great|amazing)/i.test(lower)) {
    return {
      text: `🎉 अरे वाह! तुमचा उत्साह मला खूप आवडतो!\n\nआपण काहीतरी मोठं बांधू आज! काय बांधायचं आहे? 🚀`,
      quickReplies: ['Build a web app', 'Build a game', 'Build something cool']
    };
  }

  return {
    text: `😊 मला तुमच्या feelings समजलं!\n\nमी तुमच्यासाठी इथे आहे. काहीतरी बांधायचं आहे किंवा काही चर्चा करायची आहे? 🤗`,
    quickReplies: ['Build something', 'Chat', 'Help']
  };
}

// ═══ CONVERSATIONAL RESPONSES ═══

function handleConversation(text, intent, context) {
  const lower = text.toLowerCase();

  // Greetings
  if (/^(hi|hello|hey|good morning|good evening|good night|namaste|namaskar)/i.test(lower)) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return {
      text: `${greeting}! 👋 I'm MAULI, your AI assistant.\n\nI can help you with:\n• 💬 Discuss any topic — tech, ideas, projects\n• 🔍 Answer questions about anything\n• 🚀 Build apps, websites, or tools\n• 📊 Check your project status\n• 🤖 Manage your AI agent team\n\nWhat would you like to talk about?`,
      quickReplies: ['Build a web app', 'Chat about tech', 'Show projects']
    };
  }

  // How are you
  if (/how are you|how('s| is) it going|what('s| is) up|kasa ahe|kay chal/i.test(lower)) {
    const projectCount = store.list('projects').length;
    const agentCount = store.list('agents').length;
    return {
      text: `I'm doing great! 🎉 Here's my status:\n\n🤖 **Agents:** ${agentCount} active and ready\n📁 **Projects:** ${projectCount} in the system\n⚡ **System:** All systems operational\n\nI'm always ready to help! What would you like to work on?`,
      quickReplies: ['Build something', 'Check status', 'Chat']
    };
  }

  // Thanks
  if (/^(thanks?|thank you|dhanyavaad|shukriya|cheers)/i.test(lower)) {
    return {
      text: `You're welcome! 😊 I'm always here to help.\n\nIs there anything else you'd like to discuss or build?`,
      quickReplies: ['Build something new', 'Chat more', 'Done']
    };
  }

  // Goodbye
  if (/^(bye|goodbye|see you|take care|good night|chala|bye bye)/i.test(lower)) {
    return {
      text: `Goodbye! 👋 It was great chatting with you!\n\nCome back anytime — I'll be here ready to help! 😊\n\nHave a wonderful day! 🌟`,
      quickReplies: []
    };
  }

  // Follow-up on previous topic
  if (context.length > 2 && wasRecentlyDiscussed(context, 'build')) {
    return {
      text: `Ready to continue! 💪\n\nShould I:\n• 🚀 Start building now?\n• 📋 Show the project plan?\n• 💬 Discuss more details?\n\nJust tell me what you'd like to do!`,
      quickReplies: ['Start building', 'Show plan', 'More details']
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
    quickReplies: ['Build something', 'Chat about tech', 'Show projects']
  };
}

// ═══ DISCUSSION HANDLER ═══

function handleDiscussion(text, intent, context) {
  const lower = text.toLowerCase();

  // Technology discussions
  if (/(ai|artificial intelligence|machine learning|ml|deep learning|neural|gpt|llm|chatgpt|openai|claude|gemini)/i.test(lower)) {
    return {
      text: `🤖 **AI & Machine Learning** — fascinating topic!\n\nHere's what's happening in AI right now:\n\n🧠 **Large Language Models** — GPT-4, Claude, Gemini are pushing boundaries\n🎨 **Generative AI** — Creating images, music, code, and more\n🚗 **Autonomous Systems** — Self-driving, robotics, drones\n🏥 **AI in Healthcare** — Drug discovery, diagnostics, personalized medicine\n\n**As MAULI, I use AI to:**\n• Plan and execute software projects\n• Generate code across multiple languages\n• Learn from each project to improve\n• Coordinate 18 specialized AI agents\n\nWant to build something with AI? Just tell me what!`,
      quickReplies: ['Build an AI app', 'Learn more about AI', 'Build something else']
    };
  }

  if (/(web|website|html|css|javascript|react|node|frontend|backend|fullstack|full-stack)/i.test(lower)) {
    return {
      text: `🌐 **Web Development** — my specialty!\n\n**Modern Web Stack:**\n• ⚛️ React/Vue/Angular for frontend\n• 🟢 Node.js/Python for backend\n• 🗄️ PostgreSQL/MongoDB for databases\n• ☁️ Cloud deployment (AWS, Vercel, Netlify)\n\n**I can build:**\n• Landing pages & portfolios\n• E-commerce stores\n• SaaS applications\n• Dashboard & admin panels\n• API backends\n\nJust say "Build a [type] website" and I'll get started!`,
      quickReplies: ['Build a landing page', 'Build an e-commerce store', 'Build a dashboard']
    };
  }

  if (/(android|ios|mobile|app|phone|flutter|react native|swift|kotlin)/i.test(lower)) {
    return {
      text: `📱 **Mobile Development** — let's build something!\n\n**Options:**\n• 🤖 Android (Kotlin/Java)\n• 🍎 iOS (Swift/SwiftUI)\n• 🔄 Cross-platform (Flutter/React Native)\n• 🌐 Progressive Web Apps (PWA)\n\n**I can create:**\n• Native Android/iOS apps\n• Cross-platform apps\n• Mobile-optimized web apps\n• App Store ready builds\n\nSay "Build a [type] app for Android/iOS" and I'll handle it!`,
      quickReplies: ['Build an Android app', 'Build a mobile app', 'Build a PWA']
    };
  }

  if (/(pdf|document|report|invoice|resume|cv|certificate)/i.test(lower)) {
    return {
      text: `📄 **Document Generation** — I've got you covered!\n\n**I can create:**\n• 📄 PDF documents & reports\n• 📊 Data visualizations\n• 📋 Invoices & receipts\n• 📝 Resumes & CVs\n• 🎓 Certificates\n• 📈 Business reports\n\nJust tell me what document you need and I'll generate it!`,
      quickReplies: ['Generate a PDF', 'Create a resume', 'Build an invoice app']
    };
  }

  if (/(music|song|video|player|stream|audio)/i.test(lower)) {
    return {
      text: `🎵 **Media & Entertainment** — great topic!\n\n**I can build:**\n• 🎵 Music players & streaming apps\n• 🎬 Video players & galleries\n• 📻 Podcast apps\n• 🎮 Interactive media experiences\n• 📱 Media management tools\n\nWant me to build a music or video app? Just describe what you need!`,
      quickReplies: ['Build a music app', 'Build a video player', 'Build something else']
    };
  }

  if (/(weather|forecast|temperature|rain|sun)/i.test(lower)) {
    return {
      text: `🌤️ **Weather** — I can help with that!\n\n**I can build:**\n• 🌤️ Weather apps with live data\n• 🗺️ Radar maps & forecasts\n• ⚠️ Severe weather alerts\n• 📊 Historical weather analytics\n\nWant a weather app? Just say "Build a weather app" and I'll create it with real-time data!`,
      quickReplies: ['Build a weather app', 'Build something else', 'Tell me more']
    };
  }

  if (/(game|gaming|play|fun|entertainment)/i.test(lower)) {
    return {
      text: `🎮 **Games & Entertainment** — fun topic!\n\n**I can build:**\n• 🎮 Browser games (2D/3D)\n• 🧩 Puzzle & trivia games\n• 🎯 Strategy games\n• 🏃 Action & arcade games\n• 📱 Mobile games\n\nWant me to build a game? Tell me what kind and I'll make it happen!`,
      quickReplies: ['Build a puzzle game', 'Build an arcade game', 'Build something else']
    };
  }

  if (/(ecommerce|shop|store|buy|sell|product|cart|payment|stripe)/i.test(lower)) {
    return {
      text: `🛒 **E-Commerce** — let's build a store!\n\n**Features I can include:**\n• 🛍️ Product catalog & search\n• 🛒 Shopping cart & checkout\n• 💳 Payment integration (Stripe, Razorpay)\n• 📦 Order management\n• 👤 User accounts & auth\n• 📊 Analytics dashboard\n\nSay "Build an e-commerce store" and I'll create a full online shop!`,
      quickReplies: ['Build an e-commerce store', 'Build a product catalog', 'Build something else']
    };
  }

  // General discussion — be conversational
  return {
    text: `That's a great topic! 💡\n\nI'd love to discuss this with you. As MAULI, I can:\n\n• 💬 Chat about any subject\n• 🔍 Share knowledge and insights\n• 💡 Help brainstorm ideas\n• 🚀 Turn ideas into real projects\n\n**Want to go deeper?** I can:\n• Build an app around this topic\n• Research more information\n• Create a project plan\n\nWhat would you like to do next?`,
    quickReplies: ['Build something', 'Discuss more', 'Show examples']
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
    quickReplies: ['Build something', 'Show my projects', 'How does it work?']
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
      quickReplies: ['Show all projects', 'Build something new', 'System health']
    };
  }

  if (/(completed|done|finished)/i.test(lower)) {
    const completed = projects.filter(p => p.state === 'completed');
    return {
      text: `✅ **Completed Projects:** ${completed.length}\n\n${completed.slice(-5).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id}`).join('\n') || 'No completed projects yet.'}\n\nWant me to build something new?`,
      quickReplies: ['Build something new', 'Show all projects', 'Help']
    };
  }

  if (/(active|working|progress|running)/i.test(lower)) {
    const active = projects.filter(p => p.state === 'active' || p.state === 'working');
    return {
      text: `🔄 **Active Projects:** ${active.length}\n\n${active.slice(-5).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id} (${p.state})`).join('\n') || 'No active projects.'}\n\nNeed anything else?`,
      quickReplies: ['Build something new', 'Show completed', 'Help']
    };
  }

  if (/(agent|team|worker)/i.test(lower)) {
    const available = agents.filter(a => a.state === 'available').length;
    return {
      text: `👥 **Agent Team:** ${agents.length} agents\n\n✅ Available: ${available}\n🔄 Working: ${agents.length - available}\n\n**Agents:**\n${agents.map(a => `• ${a.name} (${a.capabilities?.join(', ') || 'general'})`).join('\n')}\n\nMy team is ready to work!`,
      quickReplies: ['Build something', 'Show projects', 'Help']
    };
  }

  // General project info
  const completed = projects.filter(p => p.state === 'completed').length;
  const active = projects.filter(p => p.state === 'active').length;
  return {
    text: `📁 **Project Status:**\n\n• ✅ Completed: ${completed}\n• 🔄 Active: ${active}\n• 📊 Total: ${projects.length}\n\n**Recent Projects:**\n${projects.slice(-5).map((p, i) => `${i + 1}. ${p.name || p.objective || p.id} [${p.state}]`).join('\n') || 'No projects yet.'}\n\nWant to start a new project? Just tell me what to build!`,
    quickReplies: ['Build a project', 'Show completed', 'Show active']
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
    return {
      text: responseText,
      actions: [{ type: 'project_created', projectId: project?.id, taskCount: tasks.length }],
      quickReplies: ['Build another', 'Show my projects', 'Check status']
    };
  } catch (error) {
    return {
      text: `❌ **Error:** ${error.message}\n\nPlease try again or rephrase.`,
      actions: [{ type: 'error', error: error.message }],
      quickReplies: ['Try again', 'Help', 'Chat']
    };
  }
}

// ═══ QUESTION HANDLER ═══

function handleQuestion(text, intent, context) {
  const lower = text.toLowerCase();

  if (/how many (project|task|agent)/i.test(lower)) {
    return {
      text: `📊 **Counts:**\n• Projects: ${store.list('projects').length}\n• Tasks: ${store.list('tasks').length}\n• Agents: ${store.list('agents').length}`,
      quickReplies: ['Show details', 'Build something', 'Help']
    };
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
      quickReplies: ['Build a weather app', 'Build an e-commerce store', 'Build a PDF generator']
    };
  }

  if (/(can you|are you able|do you)/i.test(lower)) {
    return {
      text: `✅ **Yes, I can!** Here's what I'm capable of:\n\n🌐 **Web:** Websites, web apps, APIs\n📱 **Mobile:** Android, iOS, cross-platform\n🖥️ **Desktop:** Windows, Mac, Linux apps\n📄 **Documents:** PDFs, reports, certificates\n🎮 **Games:** Browser games, interactive tools\n🛒 **Commerce:** E-commerce stores, payment systems\n\n**Just describe what you need and I'll build it!**`,
      quickReplies: ['Build a web app', 'Build a mobile app', 'Build a game']
    };
  }

  // Follow-up question based on context
  if (context.length > 2) {
    const lastTopic = getLastTopic(context[context.length - 1]?.userId || 'founder');
    if (lastTopic) {
      return {
        text: `That's a great follow-up question! 💡\n\nBased on our previous discussion about "${lastTopic.substring(0, 50)}...", I can help you with:\n\n• 🔍 Dive deeper into that topic\n• 🚀 Build something related\n• 📊 Check related projects\n\nWhat would you like to know?`,
        quickReplies: ['Tell me more', 'Build something related', 'Show related projects']
      };
    }
  }

  return {
    text: `That's a great question! 💡\n\nI'm MAULI, your AI assistant. I can help with:\n• 🚀 Building projects\n• 💬 Discussing topics\n• 📊 Checking status\n• 🤖 Managing agents\n\nAsk me anything!`,
    quickReplies: ['Build something', 'Chat about tech', 'Show projects']
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
    quickReplies: ['Build something', 'Show details', 'Help']
  };
}

// ═══ HELP HANDLER ═══

function handleHelp(text) {
  return {
    text: `🤖 **MAULI Chat — What I Can Do:**\n\n💬 **Discuss Topics:**\n• Ask about tech, AI, coding, or anything!\n• Get opinions, recommendations, insights\n• Brainstorm ideas together\n\n🚀 **Build Projects:**\n• "Build a weather app"\n• "Create an e-commerce store"\n• "Make a calculator"\n\n📊 **Check Status:**\n• "How many projects?"\n• "Show active projects"\n• "What's the system status?"\n\n🤖 **About MAULI:**\n• "What is MAULI?"\n• "How does this work?"\n• "What can you do?"\n\n💡 **Tips:**\n• Be specific about what you want\n• I learn and improve over time\n• Ask me anything — I'm here to help!`,
    quickReplies: ['Build something', 'Chat about tech', 'Show projects']
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
