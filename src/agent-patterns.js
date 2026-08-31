/**
 * Agent Patterns — proven templates from awesome-llm-apps (100k+ stars).
 * Based on github.com/Shubhamsaboo/awesome-llm-apps
 */
import { id, now } from './core.js';
import { store } from './store.js';

const AGENT_PATTERNS = {
  research_assistant: {
    name: 'Research Assistant',
    description: 'Deep research with source verification',
    agents: ['Research Agent', 'Product Agent'],
    steps: ['Search topic', 'Read sources', 'Extract key findings', 'Verify claims', 'Generate report'],
    capabilities: ['research', 'analysis', 'verification'],
    template: {
      system: 'You are a thorough research assistant. Always cite sources. Verify facts before presenting them.',
      workflow: 'search → read → extract → verify → report'
    }
  },
  code_reviewer: {
    name: 'Code Reviewer',
    description: 'Automated code review with security checks',
    agents: ['QA Agent', 'Security Agent'],
    steps: ['Read code', 'Check syntax', 'Review logic', 'Security scan', 'Suggest improvements'],
    capabilities: ['testing', 'security', 'verification'],
    template: {
      system: 'You are an expert code reviewer. Check for bugs, security issues, and improvements.',
      workflow: 'read → syntax → logic → security → suggest'
    }
  },
  content_creator: {
    name: 'Content Creator',
    description: 'Generate blog posts, docs, and marketing content',
    agents: ['Creative Agent', 'Frontend Agent'],
    steps: ['Understand topic', 'Research audience', 'Create outline', 'Write content', 'Format for web'],
    capabilities: ['design', 'ui-ux', 'creative'],
    template: {
      system: 'You are a creative content writer. Create engaging, SEO-friendly content.',
      workflow: 'understand → research → outline → write → format'
    }
  },
  data_analyst: {
    name: 'Data Analyst',
    description: 'Analyze data and generate insights',
    agents: ['Data Agent', 'AI/ML Agent'],
    steps: ['Load data', 'Clean data', 'Analyze patterns', 'Generate charts', 'Write insights'],
    capabilities: ['data-analysis', 'visualization', 'charts'],
    template: {
      system: 'You are a data analyst. Find patterns and create visualizations.',
      workflow: 'load → clean → analyze → visualize → insights'
    }
  },
  api_builder: {
    name: 'API Builder',
    description: 'Design and build RESTful APIs',
    agents: ['Backend Agent', 'API Agent', 'Database Agent'],
    steps: ['Design endpoints', 'Create schema', 'Implement handlers', 'Add auth', 'Test endpoints'],
    capabilities: ['backend', 'api', 'rest', 'database'],
    template: {
      system: 'You are an API architect. Design clean, RESTful, well-documented APIs.',
      workflow: 'design → schema → implement → auth → test'
    }
  },
  mobile_app_builder: {
    name: 'Mobile App Builder',
    description: 'Build cross-platform mobile applications',
    agents: ['Mobile Agent', 'Frontend Agent', 'Backend Agent'],
    steps: ['Design UI', 'Create screens', 'Implement navigation', 'Add features', 'Build for platforms'],
    capabilities: ['mobile', 'android', 'ios', 'flutter'],
    template: {
      system: 'You are a mobile app developer. Build beautiful, performant cross-platform apps.',
      workflow: 'design → screens → navigation → features → build'
    }
  },
  security_auditor: {
    name: 'Security Auditor',
    description: 'Comprehensive security audit and hardening',
    agents: ['Security Agent', 'QA Agent'],
    steps: ['Scan dependencies', 'Check auth', 'Review data flow', 'Test vulnerabilities', 'Generate report'],
    capabilities: ['security', 'audit', 'testing'],
    template: {
      system: 'You are a security auditor. Find and fix vulnerabilities before deployment.',
      workflow: 'scan → auth → flow → test → report'
    }
  },
  full_stack_builder: {
    name: 'Full-Stack Builder',
    description: 'End-to-end application development',
    agents: ['Frontend Agent', 'Backend Agent', 'Database Agent', 'DevOps Agent'],
    steps: ['Plan architecture', 'Design database', 'Build API', 'Create UI', 'Deploy'],
    capabilities: ['frontend', 'backend', 'database', 'deployment'],
    template: {
      system: 'You are a full-stack developer. Build complete, production-ready applications.',
      workflow: 'plan → database → API → UI → deploy'
    }
  }
};

/**
 * Get all agent patterns
 */
export function getAgentPatterns() {
  return AGENT_PATTERNS;
}

/**
 * Get pattern by name
 */
export function getPattern(name) {
  return AGENT_PATTERNS[name] || null;
}

/**
 * Get pattern for a project type
 */
export function getPatternForProject(projectObjective) {
  const lower = projectObjective.toLowerCase();

  if (/research|analyze|study|investigate/.test(lower)) return AGENT_PATTERNS.research_assistant;
  if (/review|audit|check|test/.test(lower)) return AGENT_PATTERNS.code_reviewer;
  if (/blog|content|write|post|article/.test(lower)) return AGENT_PATTERNS.content_creator;
  if (/data|chart|analytics|dashboard|report/.test(lower)) return AGENT_PATTERNS.data_analyst;
  if (/api|endpoint|rest|graphql/.test(lower)) return AGENT_PATTERNS.api_builder;
  if (/mobile|app|android|ios|flutter/.test(lower)) return AGENT_PATTERNS.mobile_app_builder;
  if (/security|protect|encrypt|auth/.test(lower)) return AGENT_PATTERNS.security_auditor;
  if (/build|create|develop|make|full/.test(lower)) return AGENT_PATTERNS.full_stack_builder;

  return AGENT_PATTERNS.full_stack_builder; // Default
}

/**
 * Get pattern categories
 */
export function getPatternCategories() {
  return Object.entries(AGENT_PATTERNS).map(([key, pattern]) => ({
    id: key,
    name: pattern.name,
    description: pattern.description,
    agentCount: pattern.agents.length,
    capabilities: pattern.capabilities
  }));
}
