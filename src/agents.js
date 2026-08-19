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

export function selectAgents(requiredCapabilities = [], department = null) {
  return listAgents().filter(a => a.state === 'available' && (!department || a.department === department))
    .filter(a => requiredCapabilities.every(c => a.capabilities.includes(c)))
    .sort((a,b) => b.capabilities.length - a.capabilities.length);
}

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
