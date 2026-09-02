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

// ═══ APP-SPECIFIC FEATURES ═══
// Detailed feature lists for common app types — shown in chat responses
const APP_FEATURES = {
  calculator: {
    name: 'Calculator',
    icon: '🧮',
    features: ['Basic operations (+, −, ×, ÷)', 'Scientific functions (sin, cos, tan, log, √)', 'History log', 'Keyboard support', 'Responsive design', 'Dark/Light theme'],
    tech: 'HTML + CSS + JavaScript'
  },
  weather: {
    name: 'Weather App',
    icon: '🌤️',
    features: ['Current temperature & conditions', '5-day forecast', 'Location search', 'Weather icons & animations', 'Humidity, wind speed, UV index', 'Responsive mobile layout'],
    tech: 'HTML + CSS + JavaScript + Weather API'
  },
  todo: {
    name: 'Todo List',
    icon: '📋',
    features: ['Add/edit/delete tasks', 'Mark complete', 'Filter (All/Active/Completed)', 'Local storage persistence', 'Drag & drop reorder', 'Due dates & priority'],
    tech: 'HTML + CSS + JavaScript'
  },
  ecommerce: {
    name: 'E-Commerce Store',
    icon: '🛒',
    features: ['Product catalog with images', 'Search & filter', 'Shopping cart', 'Checkout flow', 'Payment integration', 'Order tracking', 'Admin dashboard'],
    tech: 'React + Node.js + Database'
  },
  game: {
    name: 'Game',
    icon: '🎮',
    features: ['Game canvas rendering', 'Score tracking', 'High score leaderboard', 'Sound effects', 'Multiple levels', 'Responsive controls'],
    tech: 'HTML5 Canvas + JavaScript'
  },
  notes: {
    name: 'Notes App',
    icon: '📝',
    features: ['Create/edit/delete notes', 'Rich text formatting', 'Search notes', 'Categories & tags', 'Cloud sync', 'Export to PDF'],
    tech: 'HTML + CSS + JavaScript'
  },
  chat: {
    name: 'Chat App',
    icon: '💬',
    features: ['Real-time messaging', 'User authentication', 'Chat rooms', 'Emoji support', 'Read receipts', 'Online status'],
    tech: 'React + WebSocket + Node.js'
  },
  dashboard: {
    name: 'Admin Dashboard',
    icon: '📊',
    features: ['Charts & graphs', 'Data tables', 'User management', 'Settings panel', 'Real-time updates', 'Export reports'],
    tech: 'React + Charts Library + API'
  },
  music: {
    name: 'Music Player',
    icon: '🎵',
    features: ['Audio playback', 'Playlist management', 'Play/pause/skip controls', 'Volume slider', 'Seek bar', 'Album art display'],
    tech: 'HTML + CSS + JavaScript + Web Audio API'
  },
  portfolio: {
    name: 'Portfolio Website',
    icon: '💼',
    features: ['Hero section', 'About me', 'Project gallery', 'Skills section', 'Contact form', 'Responsive design', 'Smooth animations'],
    tech: 'HTML + CSS + JavaScript'
  },
  blog: {
    name: 'Blog/CMS',
    icon: '📰',
    features: ['Create/edit/delete posts', 'Rich text editor', 'Categories & tags', 'Comments system', 'Search functionality', 'RSS feed'],
    tech: 'React + Node.js + Database'
  },
  invoice: {
    name: 'Invoice Generator',
    icon: '📄',
    features: ['Create invoices', 'Add line items', 'Tax calculations', 'PDF export', 'Client management', 'Invoice history'],
    tech: 'HTML + CSS + JavaScript + PDF library'
  },
  fitness: {
    name: 'Fitness Tracker',
    icon: '💪',
    features: ['Workout logging', 'Exercise library', 'Progress charts', 'Calorie tracking', 'Goal setting', 'Rest timer'],
    tech: 'React + Charts + Local Storage'
  },
  recipe: {
    name: 'Recipe App',
    icon: '🍳',
    features: ['Recipe browser', 'Search & filter', 'Step-by-step cooking mode', 'Ingredient scaling', 'Favorites & meal plan', 'Nutrition info'],
    tech: 'HTML + CSS + JavaScript'
  },
  social: {
    name: 'Social Media App',
    icon: '👥',
    features: ['User profiles', 'Post feed', 'Like & comment', 'Follow system', 'Notifications', 'Image uploads'],
    tech: 'React + Node.js + Database + Storage'
  },
  erp: {
    name: 'ERP System',
    icon: '🏢',
    features: ['Inventory management', 'Sales tracking', 'Purchase orders', 'Employee management', 'Financial reports', 'Multi-user roles'],
    tech: 'React + Node.js + Database'
  },
  kanban: {
    name: 'Kanban Board',
    icon: '📌',
    features: ['Drag & drop cards', 'Multiple boards', 'Labels & priorities', 'Due dates', 'Task assignments', 'Progress tracking'],
    tech: 'HTML + CSS + JavaScript'
  },
  streaming: {
    name: 'Streaming App',
    icon: '📺',
    features: ['Video player', 'Content library', 'Search & browse', 'Watchlist', 'Quality settings', 'Subtitles support'],
    tech: 'React + Video Player + API'
  },
  booking: {
    name: 'Booking System',
    icon: '📅',
    features: ['Calendar view', 'Time slot selection', 'Booking confirmation', 'Email reminders', 'Admin panel', 'Availability management'],
    tech: 'React + Node.js + Calendar'
  },
  survey: {
    name: 'Survey/Form Builder',
    icon: '📝',
    features: ['Drag & drop builder', 'Multiple question types', 'Conditional logic', 'Response analytics', 'Export results', 'Share via link'],
    tech: 'React + Node.js + Charts'
  }
};

function getAppFeatures(text) {
  const lower = text.toLowerCase();
  if (/calculator|calc|math|arithmetic|सोप/.test(lower)) return APP_FEATURES.calculator;
  if (/weather|forecast|मौसम|temperature/.test(lower)) return APP_FEATURES.weather;
  if (/todo|task.list|to.do|कार्य/.test(lower)) return APP_FEATURES.todo;
  if (/ecommerce|e.commerce|shop|store|cart|दुकान|ओळ/.test(lower)) return APP_FEATURES.ecommerce;
  if (/game|गेम|puzzle|chess|arcade/.test(lower)) return APP_FEATURES.game;
  if (/note|notepad|notebook|सुचना|टिप/.test(lower)) return APP_FEATURES.notes;
  if (/chat|messenger|संवाद|message/.test(lower)) return APP_FEATURES.chat;
  if (/dashboard|admin|control.panel|डॅशबोर्ड/.test(lower)) return APP_FEATURES.dashboard;
  if (/music|song|player|गाणे|संगीत/.test(lower)) return APP_FEATURES.music;
  if (/portfolio|website|landing|पोर्टफोलिओ/.test(lower)) return APP_FEATURES.portfolio;
  if (/blog|cms|article|ब्लॉग/.test(lower)) return APP_FEATURES.blog;
  if (/invoice|bill|receipt|बिल/.test(lower)) return APP_FEATURES.invoice;
  if (/fitness|workout|gym|exercise|व्यायाम/.test(lower)) return APP_FEATURES.fitness;
  if (/recipe|cooking|food|पाककला/.test(lower)) return APP_FEATURES.recipe;
  if (/social|friend|post|शेअर/.test(lower)) return APP_FEATURES.social;
  if (/erp|inventory|management|व्यवस्थापन/.test(lower)) return APP_FEATURES.erp;
  if (/kanban|board|project.management|तिकीट/.test(lower)) return APP_FEATURES.kanban;
  if (/stream|video|youtube|व्हिडिओ/.test(lower)) return APP_FEATURES.streaming;
  if (/booking|appointment|reservation|बुकिंग/.test(lower)) return APP_FEATURES.booking;
  if (/survey|form|quiz|प्रश्नावली/.test(lower)) return APP_FEATURES.survey;
  return null;
}

function formatFeatureList(appInfo) {
  if (!appInfo) return '';
  return `**${appInfo.icon} ${appInfo.name} Features:**\n` + appInfo.features.map(f => `• ${f}`).join('\n') + `\n\n🛠️ **Tech:** ${appInfo.tech}`;
}

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
    case 'build_status': response = handleBuildStatus(text, intent); break;
    case 'news': response = await handleNews(text, intent); break;
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

  // Marathi/Hindi build requests (must come BEFORE general Marathi chat)
  if (/banva|banvay|tayar|build|create|make|develop|design|implement/.test(lower)) {
    return { type: 'command', action: 'execute', category: 'create' };
  }

  // Marathi/Hindi general chat (no build intent)
  if (/(kasa ahe|kay chal|namaskar|namaste|dhanyavaad|shukriya|bagh|sang|kar|de|ghya|theva|pan|ani|mag|tar|mahiti|project|command)/i.test(lower)) {
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

  // Build status requests
  if (/\b(build.?status|project.?status|what.?happening|progress|progress.?report|how.?going|kay.?chal|update.?build|latest.?update|build.?progress|working.?on)\b/i.test(lower)) {
    return { type: 'build_status', action: 'query' };
  }

  // News requests (before general discussion)
  if (/\b(news|बातमी|समाचार|headlines|ताज्या|today.*(news|happen)|what.*(happen|going)|current.*(event|affair)|latest.*(news|update)|tell.*(news|me))\b/i.test(lower)) {
    return { type: 'news', action: 'fetch' };
  }

  // Discussion topics
  if (/(weather|today|music|movie|food|travel|sports|tech|ai|coding|programming|javascript|python|web|app|phone|android|iphone|laptop|computer|restaurant|price|cost|best|worst|recommend|suggestion|opinion|think|feel|love|hate|good|bad|great|awesome|terrible|help|please|thanks|thank|hello|hi|hey|good morning|good night|how are you|what's up)/i.test(lower)) {
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

  // NEW: Additional discussion topics
  if (/(devops|ci.cd|deploy|docker|kubernetes|cloud|aws|azure|gcp)/i.test(lower)) {
    return {
      text: `☁️ **DevOps & Cloud** — let's automate everything!\n\n**I can help with:**\n• 🔄 CI/CD pipeline setup\n• 🐳 Docker containerization\n• ☸️ Kubernetes orchestration\n• ☁️ Cloud deployment (AWS, Azure, GCP)\n• 📊 Monitoring & alerting\n• 🔐 Security hardening\n\nWant to build a deployment pipeline? Just ask!`,
      quickReplies: ['Build a CI/CD pipeline', 'Deploy to cloud', 'Setup monitoring']
    };
  }

  if (/(security|protect|encrypt|auth|login|password|oauth)/i.test(lower)) {
    return {
      text: `🔒 **Security** — protecting your apps!\n\n**I can help with:**\n• 🔐 Authentication systems (OAuth, JWT)\n• 🛡️ Security audits & vulnerability scans\n• 🔒 Encryption & data protection\n• 👤 User management & roles\n• 📋 Compliance checks\n\nWant to build a secure app? Let's talk about security!`,
      quickReplies: ['Build auth system', 'Security audit', 'Build secure app']
    };
  }

  if (/(database|sql|mysql|postgres|mongo|redis|data)/i.test(lower)) {
    return {
      text: `🗄️ **Database & Data** — organizing your data!\n\n**I can help with:**\n• 🗄️ Database design & schema\n• 📊 Data analysis & insights\n• 🔄 ETL pipelines\n• 📈 Data visualization\n• 🔍 Search & indexing\n\nWant to build a data-driven app? Let's design your database!`,
      quickReplies: ['Design database', 'Build data dashboard', 'ETL pipeline']
    };
  }

  if (/(iot|sensor|device|mqtt|raspberry|arduino)/i.test(lower)) {
    return {
      text: `📡 **IoT & Devices** — connecting the physical world!\n\n**I can build:**\n• 📡 IoT device management\n• 📊 Real-time monitoring dashboards\n• 🔔 Alert systems\n• 📱 Mobile control apps\n• 🔄 Data pipelines for sensors\n\nWant to build an IoT system? Tell me about your devices!`,
      quickReplies: ['Build IoT dashboard', 'Device management', 'Real-time monitoring']
    };
  }

  if (/(saas|subscription|billing|tenant|multi.tenant)/i.test(lower)) {
    return {
      text: `💼 **SaaS & Subscriptions** — building recurring revenue!\n\n**I can build:**\n• 💼 Multi-tenant SaaS platforms\n• 💳 Subscription & billing systems\n• 👤 User management & roles\n• 📊 Analytics dashboards\n• 🔐 Tenant isolation\n\nWant to build a SaaS product? Let's plan your architecture!`,
      quickReplies: ['Build SaaS platform', 'Billing system', 'Multi-tenant app']
    };
  }

  // General discussion — be conversational
  return {
    text: `That's a great topic! 💡\n\nI'd love to discuss this with you. As MAULI, I can:\n\n• 💬 Chat about any subject\n• 🔍 Share knowledge and insights\n• 💡 Help brainstorm ideas\n• 🚀 Turn ideas into real projects\n\n**Want to go deeper?** I can:\n• Build an app around this topic\n• Research more information\n• Create a project plan\n\nWhat would you like to do next?`,
    quickReplies: ['Build something', 'Discuss more', 'Show examples']
  };
}

// ═══ BUILD STATUS HANDLER ═══

function handleBuildStatus(text, intent) {
  const projects = store.list('projects');
  const allTasks = store.list('tasks');
  const agents = store.list('agents');
  
  // Get the most recent active/queued project
  const recentProject = projects
    .filter(p => ['active', 'working', 'queued', 'completed'].includes(p.state))
    .sort((a, b) => String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || '')))[0];
  
  if (!recentProject) {
    return {
      text: `📊 **No Active Projects**\n\nThere are no projects currently building or recently completed.\n\n**Total Projects:** ${projects.length}\n**Total Tasks:** ${allTasks.length}\n\n💡 Tell me what to build and I'll start a new project!`,
      quickReplies: ['Build a web app', 'Build a calculator', 'Show projects']
    };
  }
  
  const projectTasks = allTasks.filter(t => t.projectId === recentProject.id);
  const completed = projectTasks.filter(t => t.state === 'completed').length;
  const working = projectTasks.filter(t => t.state === 'working' || t.state === 'assigned').length;
  const failed = projectTasks.filter(t => t.state === 'failed').length;
  const blocked = projectTasks.filter(t => t.state === 'blocked').length;
  const queued = projectTasks.filter(t => t.state === 'queued').length;
  const total = projectTasks.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const progressBar = '█'.repeat(Math.round(progressPct / 10)) + '░'.repeat(10 - Math.round(progressPct / 10));
  
  let responseText = `📊 **Build Status — ${recentProject.name || recentProject.objective || 'Project'}**\n\n`;
  responseText += `📋 **Objective:** ${recentProject.objective || 'N/A'}\n`;
  responseText += `📌 **Project State:** ${recentProject.state}\n\n`;
  
  // Progress bar
  responseText += `**⚙️ Progress:**\n`;
  responseText += `\`${progressBar}\` ${progressPct}%\n`;
  responseText += `✅ Done: ${completed} | 🔄 Active: ${working} | ⏳ Queue: ${queued}`;
  if (blocked > 0) responseText += ` | 🚫 Blocked: ${blocked}`;
  if (failed > 0) responseText += ` | ❌ Failed: ${failed}`;
  responseText += `\n\n`;
  
  // Detailed task status
  if (projectTasks.length > 0) {
    responseText += `**📋 Tasks:**\n`;
    for (const task of projectTasks.slice(0, 10)) {
      const agent = task.assignedAgentId ? agents.find(a => a.id === task.assignedAgentId) : null;
      const state = task.state || 'queued';
      const icon = state === 'completed' ? '✅' : state === 'working' ? '🔄' : state === 'assigned' ? '📌' : state === 'failed' ? '❌' : state === 'blocked' ? '🚫' : '⏳';
      const agentName = agent ? agent.name : '—';
      responseText += `${icon} **${task.title || task.id}**\n`;
      responseText += `   🤖 ${agentName}`;
      if (task.risk) responseText += ` | Risk: ${task.risk}`;
      if (task.executor) responseText += ` | Type: ${task.executor.replace('internal.', '')}`;
      responseText += `\n`;
    }
    if (projectTasks.length > 10) responseText += `   ... and ${projectTasks.length - 10} more tasks\n`;
  }
  
  // Active agents
  const activeAgents = agents.filter(a => a.state !== 'available' && a.state !== 'offline');
  if (activeAgents.length > 0) {
    responseText += `\n**🤖 Active Agents:**\n`;
    for (const a of activeAgents.slice(0, 5)) {
      responseText += `• ${a.name} (${a.state})\n`;
    }
  }
  
  // Summary
  responseText += `\n**📈 Summary:** ${completed}/${total} tasks completed`;
  if (progressPct === 100) {
    responseText += `\n🎉 **Build Complete!** All tasks finished successfully.`;
  } else if (working > 0) {
    responseText += `\n⚡ **Building** — ${working} task(s) currently being processed.`;
  } else if (queued > 0) {
    responseText += `\n📤 **Queued** — ${queued} task(s) waiting to be picked up.`;
  }
  
  return {
    text: responseText,
    quickReplies: ['Build another', 'Show projects', 'Help']
  };
}

// ═══ NEWS HANDLER ═══

async function handleNews(text, intent) {
  const lower = text.toLowerCase();
  const now_date = new Date();
  const dateStr = now_date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now_date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  // Determine news category from the query
  let category = 'general';
  let categoryIcon = '📰';
  
  if (/(tech|technology|AI|artificial intelligence|coding|programming|software|startup|apple|google|microsoft|meta|openai|gpt|llm)/i.test(lower)) {
    category = 'technology'; categoryIcon = '💻';
  } else if (/(sports|cricket|football|tennis|ipl|olympic|match|game|player)/i.test(lower)) {
    category = 'sports'; categoryIcon = '⚽';
  } else if (/(politic|government|minister|election|parliament|law|policy)/i.test(lower)) {
    category = 'politics'; categoryIcon = '🏛️';
  } else if (/(business|economy|market|stock|share|trade|finance|bank)/i.test(lower)) {
    category = 'business'; categoryIcon = '📈';
  } else if (/(entertainment|movie|film|music|celebrity|actor|song|album)/i.test(lower)) {
    category = 'entertainment'; categoryIcon = '🎬';
  } else if (/(health|medical|covid|disease|doctor|hospital|vaccine)/i.test(lower)) {
    category = 'health'; categoryIcon = '🏥';
  } else if (/(world|international|global|country|war|peace)/i.test(lower)) {
    category = 'world'; categoryIcon = '🌍';
  } else if (/(maharashtra|mumbai|pune|nagpur|india|desi|local)/i.test(lower)) {
    category = 'maharashtra'; categoryIcon = '🇮🇳';
  }
  
  // Build news source links based on category
  const newsLinks = {
    general: [
      { name: 'Google News', url: 'https://news.google.com' },
      { name: 'BBC News', url: 'https://www.bbc.com/news' },
      { name: 'Reuters', url: 'https://www.reuters.com' }
    ],
    technology: [
      { name: 'TechCrunch', url: 'https://techcrunch.com' },
      { name: 'The Verge', url: 'https://www.theverge.com' },
      { name: 'Ars Technica', url: 'https://arstechnica.com' },
      { name: 'Hacker News', url: 'https://news.ycombinator.com' }
    ],
    sports: [
      { name: 'ESPN', url: 'https://www.espn.com' },
      { name: 'Cricbuzz', url: 'https://www.cricbuzz.com' },
      { name: 'Star Sports', url: 'https://www.star Sports.com' }
    ],
    politics: [
      { name: 'NDTV', url: 'https://www.ndtv.com' },
      { name: 'Times of India', url: 'https://timesofindia.indiatimes.com' },
      { name: 'The Hindu', url: 'https://www.thehindu.com' }
    ],
    business: [
      { name: 'Economic Times', url: 'https://economictimes.indiatimes.com' },
      { name: 'Moneycontrol', url: 'https://www.moneycontrol.com' },
      { name: 'Bloomberg', url: 'https://www.bloomberg.com' }
    ],
    entertainment: [
      { name: 'IMDb', url: 'https://www.imdb.com' },
      { name: 'Times of India - Entertainment', url: 'https://timesofindia.indiatimes.com/entertainment' },
      { name: 'YouTube Trending', url: 'https://www.youtube.com/feed/trending' }
    ],
    health: [
      { name: 'WHO', url: 'https://www.who.int' },
      { name: 'Healthline', url: 'https://www.healthline.com' },
      { name: 'WebMD', url: 'https://www.webmd.com' }
    ],
    world: [
      { name: 'Al Jazeera', url: 'https://www.aljazeera.com' },
      { name: 'BBC World', url: 'https://www.bbc.com/news/world' },
      { name: 'CNN', url: 'https://www.cnn.com' }
    ],
    maharashtra: [
      { name: 'Loksatta', url: 'https://www.loksatta.com' },
      { name: 'Maharashtra Times', url: 'https://maharashtratimes.com' },
      { name: 'Sakal', url: 'https://www.esakal.com' },
      { name: 'Lokmat', url: 'https://www.lokmat.com' }
    ]
  };
  
  const links = newsLinks[category] || newsLinks.general;
  const linksText = links.map(l => `• [${l.name}](${l.url})`).join('\n');
  
  // Category-specific tips
  const tips = {
    technology: '🤖 Top Tech Topics: AI advancements, new software releases, startup funding, cybersecurity updates, and emerging technologies.',
    sports: '🏆 Stay updated with live scores, match schedules, transfer news, and tournament brackets.',
    politics: '🏛️ Follow parliamentary sessions, policy updates, election news, and government announcements.',
    business: '💰 Track market movements, corporate earnings, economic indicators, and investment opportunities.',
    entertainment: '🎭 Discover new releases, celebrity news, award shows, and trending content.',
    health: '🏥 Get the latest on medical research, health tips, wellness advice, and public health updates.',
    world: '🌍 Stay informed about international affairs, global conflicts, climate news, and diplomatic events.',
    maharashtra: '🇮🇳 महाराष्ट्रातील ताज्या बातम्या — राजकीय, खेळ, मनोरंजन आणि बऱ्याच अन्य बातम्या.',
    general: '📰 Here are the latest headlines from around the world.'
  };
  
  return {
    text: `${categoryIcon} **${category.charAt(0).toUpperCase() + category.slice(1)} News** — ${dateStr} ${timeStr}\n\n${tips[category]}\n\n**🔗 Read Latest News:**\n${linksText}\n\n💡 **Tip:** You can ask me about specific topics like "AI news", "cricket scores", "Maharashtra news", "stock market" etc. for category-specific updates!`,
    quickReplies: ['Tech news', 'Sports news', 'Maharashtra news', 'World news', 'Business news']
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
    
    // Detect app-specific features from the user's request
    const appInfo = getAppFeatures(text);
    
    const result = await planCommand(text, env);
    const project = result.project;
    const tasks = result.tasks || [];
    const status = result.status || 'unknown';

    // Count task states for progress
    const completed = tasks.filter(t => (t.task || t).state === 'completed').length;
    const working = tasks.filter(t => (t.task || t).state === 'working' || (t.task || t).state === 'assigned').length;
    const failed = tasks.filter(t => (t.task || t).state === 'failed').length;
    const total = tasks.length;
    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const progressBar = '█'.repeat(Math.round(progressPct / 10)) + '░'.repeat(10 - Math.round(progressPct / 10));

    let responseText = `🚀 **Project Build Started!**\n\n`;
    responseText += `📋 **Name:** ${project?.name || 'Unknown'}\n`;
    responseText += `📝 **Objective:** ${project?.objective || text}\n`;
    responseText += `📊 **Status:** ${status}\n`;
    responseText += `🎯 **Total Tasks:** ${total}\n\n`;

    // Build progress section
    responseText += `**⚙️ Build Progress:**\n`;
    responseText += `\`${progressBar}\` ${progressPct}%\n`;
    responseText += `✅ Completed: ${completed} | 🔄 Working: ${working} | ⏳ Pending: ${total - completed - working - failed}`;
    if (failed > 0) responseText += ` | ❌ Failed: ${failed}`;
    responseText += `\n\n`;

    // Show specific features/functions the app will include
    if (appInfo) {
      responseText += `${formatFeatureList(appInfo)}\n\n`;
    }

    // Build phases explanation
    responseText += `**🔧 Build Pipeline Phases:**\n`;
    responseText += `1️⃣ **Research** — Validate requirements\n`;
    responseText += `2️⃣ **Planning** — Define architecture & plan\n`;
    responseText += `3️⃣ **Backend** — Implement API & server logic\n`;
    responseText += `4️⃣ **Database** — Design schema & persistence\n`;
    responseText += `5️⃣ **Frontend** — Build UI & user experience\n`;
    responseText += `6️⃣ **Security** — Security review & audit\n`;
    responseText += `7️⃣ **Testing** — QA verification & testing\n\n`;

    // Detailed task pipeline with agents
    if (tasks.length > 0) {
      responseText += `**📋 Task Details:**\n`;
      for (const t of tasks.slice(0, 8)) {
        const task = t.task || t;
        const agent = t.selectedAgent;
        const state = task.state || 'queued';
        const icon = state === 'completed' ? '✅' : state === 'working' ? '🔄' : state === 'assigned' ? '📌' : state === 'failed' ? '❌' : '⏳';
        const agentName = agent ? agent.name : (task.assignedAgentId ? 'Assigned' : 'Unassigned');
        const risk = task.risk === 'high' ? '🔴' : task.risk === 'medium' ? '🟡' : '🟢';
        responseText += `${icon} **${task.title || 'Task'}**\n`;
        responseText += `   🤖 ${agentName} ${risk} Risk: ${task.risk || 'low'}`;
        if (task.toolNames && task.toolNames.length) responseText += ` | 🔧 Tools: ${task.toolNames.length}`;
        responseText += `\n`;
      }
      if (tasks.length > 8) responseText += `   ... and ${tasks.length - 8} more tasks\n`;
    }

    // Status-specific messages
    if (status === 'awaiting_approval') {
      responseText += `\n⏳ **Waiting for approval** — This project requires your approval before execution starts.`;
    } else if (status === 'queued') {
      responseText += `\n📤 **Queued** — Project is queued for execution. The scheduler will pick it up shortly.`;
    } else if (status === 'completed') {
      responseText += `\n🎉 **Build Complete!** All tasks have been executed and verified.`;
    } else {
      responseText += `\n⚡ **Building in progress** — Agents are working on your project.`;
    }

    responseText += `\n\n💡 Say **"build status"** to check latest progress!`;
    return {
      text: responseText,
      actions: [{ type: 'project_created', projectId: project?.id, taskCount: tasks.length }],
      quickReplies: ['Build status', 'Build another', 'Show my projects']
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
