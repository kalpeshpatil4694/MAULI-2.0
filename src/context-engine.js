/**
 * Batch 5 — deterministic context/headroom engine.
 * Worker-safe: no external tokenizer or model call is required.
 */

const DEFAULT_BUDGET = 8192;
const DEFAULT_RESERVE = 1024;
const DEFAULT_CHARS_PER_TOKEN = 4;

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (typeof value.content === 'string') return value.content;
    if (typeof value.text === 'string') return value.text;
    return JSON.stringify(value);
  }
  return String(value);
}

export function estimateTokens(value, charsPerToken = DEFAULT_CHARS_PER_TOKEN) {
  const text = textOf(value);
  if (!text) return 0;
  const ratio = Number(charsPerToken);
  const safeRatio = Number.isFinite(ratio) && ratio >= 1 ? ratio : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(text.length / safeRatio);
}

function clampBudget(value, fallback = DEFAULT_BUDGET) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function normalizeMessage(message, index) {
  if (!message || typeof message !== 'object') return null;
  const role = ['system', 'user', 'assistant', 'tool'].includes(message.role) ? message.role : 'user';
  const content = textOf(message.content);
  if (!content) return null;
  return { ...message, role, content, _index: index };
}

function words(text) {
  return new Set(String(text).toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []);
}

function relevanceScore(content, queryTerms) {
  if (!queryTerms.size) return 0;
  let score = 0;
  for (const word of words(content)) if (queryTerms.has(word)) score += 1;
  return score;
}

function compactText(text, maxTokens) {
  const budget = clampBudget(maxTokens, 1);
  const maxChars = Math.max(1, budget * DEFAULT_CHARS_PER_TOKEN);
  if (text.length <= maxChars) return text;

  // The final string is always sliced to the exact character budget so
  // estimateTokens(compactText(...)) can never exceed maxTokens.
  const marker = '...';
  if (maxChars <= marker.length) return text.slice(0, maxChars);

  const payloadChars = maxChars - marker.length;
  const headChars = Math.ceil(payloadChars / 2);
  const tailChars = payloadChars - headChars;
  return `${text.slice(0, headChars)}${marker}${tailChars ? text.slice(-tailChars) : ''}`.slice(0, maxChars);
}

function makeCandidate(message, index, latestUser, queryTerms) {
  const role = message.role;
  const mandatory = role === 'system' || (role === 'user' && index === latestUser);
  const recency = index / 1000;
  const relevance = relevanceScore(message.content, queryTerms);
  const roleWeight = role === 'system' ? 10000 : role === 'user' ? 5000 : role === 'tool' ? 2000 : 1000;
  return {
    message,
    mandatory,
    score: (mandatory ? 100000 : 0) + roleWeight + relevance * 100 + recency,
    tokens: estimateTokens(message.content)
  };
}

export function selectContext(messages = [], options = {}) {
  const normalized = messages.map(normalizeMessage).filter(Boolean);
  const budgetTokens = clampBudget(options.budgetTokens, DEFAULT_BUDGET);
  const reserveTokens = Math.max(0, Math.min(budgetTokens - 1, Number.isFinite(Number(options.reserveTokens)) ? Math.floor(Number(options.reserveTokens)) : DEFAULT_RESERVE));
  const usableBudget = Math.max(1, budgetTokens - reserveTokens);
  const latestUser = [...normalized].map((m, i) => [m, i]).reverse().find(([m]) => m.role === 'user')?.[1] ?? -1;
  const currentText = latestUser >= 0 ? normalized[latestUser].content : normalized.map(m => m.content).join('\n');
  const queryTerms = words(currentText);
  const candidates = normalized.map((message, index) => makeCandidate(message, index, latestUser, queryTerms));
  const mandatory = candidates.filter(x => x.mandatory);
  const optional = candidates.filter(x => !x.mandatory).sort((a, b) => b.score - a.score);
  const selected = [];
  let used = 0;
  const dropped = [];

  for (const candidate of mandatory) {
    const tokens = candidate.tokens;
    if (used + tokens <= usableBudget) {
      selected.push(candidate);
      used += tokens;
    } else {
      const remaining = Math.max(1, usableBudget - used);
      const compressed = { ...candidate, message: { ...candidate.message, content: compactText(candidate.message.content, remaining) } };
      compressed.tokens = estimateTokens(compressed.message.content);
      if (compressed.tokens <= remaining) {
        selected.push(compressed);
        used += compressed.tokens;
      } else {
        dropped.push(candidate);
      }
    }
  }

  for (const candidate of optional) {
    if (selected.some(x => x.message._index === candidate.message._index)) continue;
    if (used + candidate.tokens <= usableBudget) {
      selected.push(candidate);
      used += candidate.tokens;
    } else dropped.push(candidate);
  }

  selected.sort((a, b) => a.message._index - b.message._index);
  return {
    messages: selected.map(x => { const { _index, ...message } = x.message; return message; }),
    usedTokens: used,
    budgetTokens,
    reserveTokens,
    droppedCount: dropped.length,
    droppedMessages: dropped.map(x => x.message),
    compressed: selected.some(x => x.message.content !== normalized.find(m => m._index === x.message._index)?.content),
    headroomTokens: Math.max(0, usableBudget - used)
  };
}

export function prepareContext(messages = [], options = {}) {
  const result = selectContext(messages, options);
  return {
    messages: result.messages,
    metadata: {
      estimatedInputTokens: estimateTokens(messages),
      selectedInputTokens: result.usedTokens,
      budgetTokens: result.budgetTokens,
      reserveTokens: result.reserveTokens,
      headroomTokens: result.headroomTokens,
      droppedCount: result.droppedCount,
      compressed: result.compressed
    }
  };
}

export function summarizeText(value, maxTokens = 256) {
  const text = textOf(value).replace(/\s+/g, ' ').trim();
  return compactText(text, maxTokens);
}

export function buildContextEnvelope({ task = {}, project = {}, agent = {}, importantFacts = [], recentEvents = [], memory = [], budgetTokens = DEFAULT_BUDGET } = {}) {
  const sections = [
    ['task', task, 100],
    ['project', project, 90],
    ['agent', agent, 80],
    ['importantFacts', importantFacts, 95],
    ['memory', memory, 70],
    ['recentEvents', recentEvents, 60]
  ];
  const items = sections.map(([type, value, priority]) => ({ type, priority, content: summarizeText(value, Math.min(512, Math.max(32, Math.floor(budgetTokens / 8)))) }));
  const ordered = items.sort((a, b) => b.priority - a.priority);
  let used = 0;
  const selected = [];
  for (const item of ordered) {
    const tokens = estimateTokens(item.content);
    if (used + tokens > budgetTokens) continue;
    selected.push(item);
    used += tokens;
  }
  return { sections: selected, usedTokens: used, budgetTokens, headroomTokens: Math.max(0, budgetTokens - used) };
}

export const CONTEXT_DEFAULTS = Object.freeze({ budgetTokens: DEFAULT_BUDGET, reserveTokens: DEFAULT_RESERVE });
