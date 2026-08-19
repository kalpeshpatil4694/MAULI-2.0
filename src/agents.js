import { capability, id, now } from './core.js';
import { store } from './store.js';

export const AGENT_STATES = ['registered','available','assigned','working','verifying','completed','blocked','escalated','offline'];

export function registerAgent({ name, role, department = 'General', capabilities = [], tools = [], metadata = {} }) {
  const agent = store.put('agents', { id: id('agent'), name, role, department, capabilities, tools, state: 'available', heartbeatAt: now(), metadata });
  store.addEvent('agent.registered', agent);
  return agent;
}

export function updateAgent(idValue, patch) {
  const current = store.get('agents', idValue);
  if (!current) return null;
  const next = store.put('agents', { ...current, ...patch, id: current.id });
  store.addEvent('agent.updated', next);
  return next;
}

export function listAgents() { return store.list('agents'); }

export function scoreAgent(agent, requiredCapabilities = [], options = {}) {
  const required = [...new Set(requiredCapabilities)];
  const caps = new Set(agent.capabilities ?? []);
  const matched = required.filter(c => caps.has(c));
  if (required.length && matched.length !== required.length) return -Infinity;
  let score = matched.length * 100;
  score += Math.min((agent.capabilities ?? []).length, 20);
  if (options.department && agent.department === options.department) score += 25;
  if (options.preferredRole && agent.role === options.preferredRole) score += 15;
  if (agent.state === 'available') score += 20;
  const metadata = agent.metadata ?? {};
  if (Number.isFinite(metadata.successRate)) score += Math.max(0, Math.min(20, metadata.successRate * 20));
  if (Number.isFinite(metadata.priority)) score += metadata.priority;
  return score;
}

export function selectAgents(requiredCapabilities = [], department = null, options = {}) {
  return listAgents()
    .filter(a => a.state === 'available' && (!department || a.department === department))
    .map(agent => ({ agent, score: scoreAgent(agent, requiredCapabilities, { ...options, department }) }))
    .filter(x => Number.isFinite(x.score))
    .sort((a,b) => b.score - a.score || String(a.agent.id).localeCompare(String(b.agent.id)))
    .map(x => x.agent);
}

export function selectBestAgent(requiredCapabilities = [], options = {}) { return selectAgents(requiredCapabilities, options.department ?? null, options)[0] ?? null; }

export function seedAgents() {
  if (listAgents().length) return listAgents();
  const defaults = [
    ['SK Executive','Executive','Executive',['planning','governance','delegation']],
    ['Research Agent','Research','Research',['research','analysis']],
    ['Product Agent','Product','Business',['requirements','product-planning']],
    ['Frontend Agent','Engineer','Engineering',['frontend','javascript','ui']],
    ['Backend Agent','Engineer','Engineering',['backend','api','javascript']],
    ['Database Agent','Engineer','Engineering',['database','schema','sql']],
    ['Security Agent','Reviewer','Security',['security','audit']],
    ['QA Agent','Tester','Quality',['testing','verification']]
  ];
  return defaults.map(([name, role, department, caps]) => registerAgent({ name, role, department, capabilities: caps }));
}

export { capability };
