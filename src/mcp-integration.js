/**
 * MCP Integration — connects agents to Model Context Protocol servers.
 * Based on github.com/punkpeye/awesome-mcp-servers (15k+ stars)
 * MCP = "USB-C for AI" — standardized tool connectivity.
 */
import { id, now } from './core.js';
import { store } from './store.js';
import { remember } from './memory.js';

const MCP_SERVERS = {
  filesystem: {
    name: 'Filesystem MCP',
    description: 'Read/write files on local filesystem',
    capabilities: ['file.read', 'file.write', 'file.list', 'file.search'],
    category: 'core',
    agents: ['Frontend Agent', 'Backend Agent', 'DevOps Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem'
  },
  github: {
    name: 'GitHub MCP',
    description: 'Interact with GitHub repos, issues, PRs',
    capabilities: ['git.clone', 'git.commit', 'git.push', 'issue.create', 'pr.create'],
    category: 'core',
    agents: ['DevOps Agent', 'Backend Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github'
  },
  postgres: {
    name: 'PostgreSQL MCP',
    description: 'Query and manage PostgreSQL databases',
    capabilities: ['db.query', 'db.schema', 'db.migrate'],
    category: 'database',
    agents: ['Database Agent', 'Backend Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres'
  },
  puppeteer: {
    name: 'Puppeteer MCP',
    description: 'Control browser for scraping and testing',
    capabilities: ['browser.navigate', 'browser.screenshot', 'browser.click', 'browser.scrape'],
    category: 'browser',
    agents: ['Research Agent', 'Frontend Agent', 'QA Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer'
  },
  slack: {
    name: 'Slack MCP',
    description: 'Send messages and manage Slack channels',
    capabilities: ['chat.send', 'channel.list', 'message.search'],
    category: 'communication',
    agents: ['SK Executive', 'DevOps Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack'
  },
  memory: {
    name: 'Memory MCP',
    description: 'Persistent knowledge graph storage',
    capabilities: ['memory.store', 'memory.retrieve', 'memory.search', 'memory.graph'],
    category: 'core',
    agents: ['All Agents'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory'
  },
  brave: {
    name: 'Brave Search MCP',
    description: 'Web search via Brave Search API',
    capabilities: ['web.search', 'web.news', 'web.images'],
    category: 'search',
    agents: ['Research Agent', 'Product Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search'
  },
  google_drive: {
    name: 'Google Drive MCP',
    description: 'Access Google Drive files and folders',
    capabilities: ['drive.read', 'drive.write', 'drive.search', 'drive.share'],
    category: 'storage',
    agents: ['Frontend Agent', 'Product Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/google-drive'
  },
  sqlite: {
    name: 'SQLite MCP',
    description: 'Local SQLite database operations',
    capabilities: ['db.local.query', 'db.local.schema', 'db.local.backup'],
    category: 'database',
    agents: ['Database Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite'
  },
  fetch: {
    name: 'Fetch MCP',
    description: 'HTTP fetch for API calls and web requests',
    capabilities: ['http.get', 'http.post', 'http.put', 'http.delete'],
    category: 'core',
    agents: ['Backend Agent', 'Research Agent'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch'
  }
};

/**
 * Get MCP servers for a specific agent
 */
export function getMCPForAgent(agentName) {
  return Object.values(MCP_SERVERS).filter(s =>
    s.agents.includes(agentName) || s.agents.includes('All Agents')
  );
}

/**
 * Get MCP servers by capability
 */
export function getMCPByCapability(capability) {
  const lower = capability.toLowerCase();
  return Object.values(MCP_SERVERS).filter(s =>
    s.capabilities.some(c => c.includes(lower) || lower.includes(c.split('.')[0]))
  );
}

/**
 * Get all MCP servers
 */
export function getAllMCPServers() {
  return MCP_SERVERS;
}

/**
 * Get MCP categories
 */
export function getMCPCategories() {
  const cats = {};
  for (const server of Object.values(MCP_SERVERS)) {
    if (!cats[server.category]) cats[server.category] = [];
    cats[server.category].push(server.name);
  }
  return cats;
}

/**
 * Suggest MCP servers for a project
 */
export function suggestMCPForProject(projectObjective) {
  const lower = projectObjective.toLowerCase();
  const suggestions = [];

  if (/scrape|crawl|web|data|research/.test(lower)) suggestions.push(MCP_SERVERS.puppeteer);
  if (/database|sql|query|data/.test(lower)) suggestions.push(MCP_SERVERS.postgres, MCP_SERVERS.sqlite);
  if (/file|read|write|code|develop/.test(lower)) suggestions.push(MCP_SERVERS.filesystem);
  if (/git|repo|commit|deploy/.test(lower)) suggestions.push(MCP_SERVERS.github);
  if (/search|find|research|look/.test(lower)) suggestions.push(MCP_SERVERS.brave);
  if (/message|chat|notify|team/.test(lower)) suggestions.push(MCP_SERVERS.slack);
  if (/memory|remember|knowledge|learn/.test(lower)) suggestions.push(MCP_SERVERS.memory);
  if (/api|http|fetch|request/.test(lower)) suggestions.push(MCP_SERVERS.fetch);

  // Always suggest memory and filesystem as defaults
  if (!suggestions.includes(MCP_SERVERS.memory)) suggestions.push(MCP_SERVERS.memory);
  if (!suggestions.includes(MCP_SERVERS.filesystem)) suggestions.push(MCP_SERVERS.filesystem);

  return suggestions;
}

/**
 * Record MCP usage
 */
export function recordMCPUsage(projectId, serverName, capability, success) {
  remember({
    type: 'technical_knowledge',
    content: { action: 'mcp_usage', serverName, capability, success },
    scope: 'project',
    scopeId: projectId,
    importance: 'normal',
    source: 'mcp-integration'
  });
}
