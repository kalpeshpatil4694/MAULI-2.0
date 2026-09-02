import { store } from './store.js';
import { now } from './core.js';
import { remember } from './memory.js';

/**
 * Enhanced Agent Learning System — tracks agent skills, patterns,
 * collaboration effectiveness, and provides learning recommendations.
 */

export function recordAgentTaskLearning({ agentId, task, success, verification = null }) {
  if (!agentId || !task) return null;
  const agent = store.get('agents', agentId);
  if (!agent) return null;
  
  const metadata = { ...(agent.metadata ?? {}), learning: { ...(agent.metadata?.learning ?? {}) } };
  const key = (task.requiredCapabilities ?? []).slice().sort().join('|') || 'general';
  
  // Track basic learning
  const current = metadata.learning[key] ?? {
    attempts: 0, successes: 0, failures: 0,
    successRate: 0, confidence: 0, lastOutcomeAt: null,
    avgDuration: 0, patterns: [], improvements: []
  };
  
  current.attempts += 1;
  if (success) current.successes += 1;
  else current.failures += 1;
  current.successRate = current.successes / current.attempts;
  current.confidence = Math.min(1, current.attempts / 10);
  current.lastOutcomeAt = now();
  
  // Track patterns — what works and what doesn't
  if (!current.patterns) current.patterns = [];
  if (task.title) {
    const pattern = extractPattern(task.title, success);
    if (pattern) {
      const existing = current.patterns.find(p => p.type === pattern.type);
      if (existing) {
        existing.count += 1;
        existing.lastSeen = now();
        if (success) existing.successCount = (existing.successCount || 0) + 1;
      } else {
        current.patterns.push({
          type: pattern.type,
          description: pattern.description,
          count: 1,
          successCount: success ? 1 : 0,
          lastSeen: now()
        });
      }
    }
  }
  
  // Track improvements over time
  if (!current.improvements) current.improvements = [];
  if (current.attempts > 1 && current.attempts % 5 === 0) {
    const recentRate = current.successes / current.attempts;
    current.improvements.push({
      at: now(),
      successRate: recentRate,
      confidence: current.confidence,
      attempts: current.attempts
    });
    // Keep only last 10 improvement snapshots
    if (current.improvements.length > 10) {
      current.improvements = current.improvements.slice(-10);
    }
  }
  
  metadata.learning[key] = current;
  
  // Track cross-skill capabilities
  if (!metadata.skillTree) metadata.skillTree = {};
  for (const cap of (task.requiredCapabilities ?? [])) {
    if (!metadata.skillTree[cap]) {
      metadata.skillTree[cap] = { level: 0, xp: 0, lastUsed: null };
    }
    const skill = metadata.skillTree[cap];
    skill.xp += success ? 10 : 2;
    skill.lastUsed = now();
    // Level up every 50 XP
    skill.level = Math.floor(skill.xp / 50) + 1;
  }
  
  // Track collaboration effectiveness
  if (!metadata.collaboration) metadata.collaboration = {};
  if (verification?.id) {
    metadata.collaboration.verificationsPassed = (metadata.collaboration.verificationsPassed || 0) + (success ? 1 : 0);
    metadata.collaboration.totalVerifications = (metadata.collaboration.totalVerifications || 0) + 1;
  }
  
  const updated = store.put('agents', { ...agent, metadata, id: agent.id });
  
  // Store learning event in memory
  remember({
    type: 'agent.task_learning',
    content: {
      agentId,
      capabilityProfile: key,
      success,
      confidence: current.confidence,
      patterns: current.patterns.length,
      skillTreeSize: Object.keys(metadata.skillTree).length
    },
    importance: success ? 'normal' : 'high',
    scope: 'task',
    scopeId: task.id,
    source: 'agent-learning',
    tags: [task.executor, ...(task.requiredCapabilities ?? [])]
  });
  
  return updated;
}

/**
 * Get learning profile for an agent
 */
export function getAgentTaskLearning(agentId, capabilities = []) {
  const agent = store.get('agents', agentId);
  if (!agent) return null;
  const key = capabilities.slice().sort().join('|') || 'general';
  return agent.metadata?.learning?.[key] ?? null;
}

/**
 * Get skill tree for an agent
 */
export function getAgentSkillTree(agentId) {
  const agent = store.get('agents', agentId);
  if (!agent) return null;
  return agent.metadata?.skillTree ?? {};
}

/**
 * Get collaboration stats for an agent
 */
export function getAgentCollaborationStats(agentId) {
  const agent = store.get('agents', agentId);
  if (!agent) return null;
  return agent.metadata?.collaboration ?? {};
}

/**
 * Learning-adjusted success rate (higher confidence = more weight on actual rate)
 */
export function learningAdjustedRate(profile) {
  if (!profile || !profile.attempts) return null;
  const confidence = Number.isFinite(profile.confidence) ? profile.confidence : Math.min(1, profile.attempts / 10);
  return 0.5 + ((profile.successRate ?? 0) - 0.5) * confidence;
}

/**
 * Get the best agent for a task based on learning data
 */
export function getBestAgentForTask(capabilities = []) {
  const agents = store.list('agents');
  let best = null;
  let bestScore = -1;
  
  for (const agent of agents) {
    if (agent.state !== 'available') continue;
    
    const caps = new Set(agent.capabilities ?? []);
    const matchScore = capabilities.filter(c => caps.has(c)).length / Math.max(capabilities.length, 1);
    
    const skillTree = agent.metadata?.skillTree ?? {};
    const avgLevel = capabilities.length > 0
      ? capabilities.reduce((sum, c) => sum + (skillTree[c]?.level || 0), 0) / capabilities.length
      : 0;
    
    const learning = agent.metadata?.learning ?? {};
    const profileKey = capabilities.slice().sort().join('|') || 'general';
    const learningProfile = learning[profileKey];
    const adjustedRate = learningProfile ? (learningAdjustedRate(learningProfile) ?? 0.5) : 0.5;
    
    const score = matchScore * 40 + (avgLevel / 10) * 30 + adjustedRate * 30;
    
    if (score > bestScore) {
      bestScore = score;
      best = agent;
    }
  }
  
  return best;
}

/**
 * Extract learning pattern from task title
 */
function extractPattern(title, success) {
  if (!title) return null;
  const lower = title.toLowerCase();
  
  // App type patterns
  if (/calculator|math|arithmetic/i.test(lower)) return { type: 'calculator', description: 'Calculator applications' };
  if (/game|puzzle|chess|card|arcade/i.test(lower)) return { type: 'game', description: 'Game applications' };
  if (/e-commerce|shop|store|cart|marketplace/i.test(lower)) return { type: 'ecommerce', description: 'E-commerce platforms' };
  if (/chat|messenger|message|conversation/i.test(lower)) return { type: 'messaging', description: 'Messaging applications' };
  if (/tracker|location|gps|map/i.test(lower)) return { type: 'tracker', description: 'Location tracking apps' };
  if (/player|video|music|audio|stream/i.test(lower)) return { type: 'media', description: 'Media player applications' };
  if (/security|protect|encrypt|firewall|auth/i.test(lower)) return { type: 'security', description: 'Security applications' };
  if (/pdf|document|report|invoice|certificate/i.test(lower)) return { type: 'document', description: 'Document generation' };
  if (/web|website|blog|portal|landing/i.test(lower)) return { type: 'web', description: 'Web applications' };
  if (/mobile|app|android|ios|flutter/i.test(lower)) return { type: 'mobile', description: 'Mobile applications' };
  
  // Technology patterns
  if (/api|rest|graphql|endpoint/i.test(lower)) return { type: 'api', description: 'API development' };
  if (/database|sql|schema|migration/i.test(lower)) return { type: 'database', description: 'Database work' };
  if (/ai|machine.learning|neural|deep.learning/i.test(lower)) return { type: 'ai', description: 'AI/ML applications' };
  if (/dashboard|admin|analytics|report/i.test(lower)) return { type: 'dashboard', description: 'Dashboard applications' };
  if (/todo|task|project|kanban/i.test(lower)) return { type: 'productivity', description: 'Productivity tools' };
  if (/weather|forecast|temperature/i.test(lower)) return { type: 'weather', description: 'Weather applications' };
  if (/social|feed|post|share|community/i.test(lower)) return { type: 'social', description: 'Social applications' };
  if (/blog|cms|content|article/i.test(lower)) return { type: 'content', description: 'Content management' };
  if (/payment|stripe|billing|subscription/i.test(lower)) return { type: 'payment', description: 'Payment systems' };
  if (/iot|sensor|device|mqtt/i.test(lower)) return { type: 'iot', description: 'IoT applications' };
  if (/scraping|crawl|extract|data.mining/i.test(lower)) return { type: 'scraping', description: 'Web scraping' };
  if (/realtime|real.time|websocket|live/i.test(lower)) return { type: 'realtime', description: 'Real-time applications' };
  
  return { type: 'general', description: 'General software' };
}

/**
 * Get system-wide learning stats
 */
export function getSystemLearningStats() {
  const agents = store.list('agents');
  let totalAttempts = 0;
  let totalSuccesses = 0;
  let totalPatterns = 0;
  let totalSkills = 0;
  
  for (const agent of agents) {
    const learning = agent.metadata?.learning ?? {};
    const skillTree = agent.metadata?.skillTree ?? {};
    
    for (const profile of Object.values(learning)) {
      totalAttempts += profile.attempts || 0;
      totalSuccesses += profile.successes || 0;
      totalPatterns += (profile.patterns || []).length;
    }
    
    totalSkills += Object.keys(skillTree).length;
  }
  
  return {
    totalAttempts,
    totalSuccesses,
    overallSuccessRate: totalAttempts > 0 ? totalSuccesses / totalAttempts : 0,
    totalPatterns,
    totalSkills,
    agentCount: agents.length
  };
}
