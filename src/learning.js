import { id, now } from './core.js';
import { store } from './store.js';
import { remember } from './memory.js';

export const LEARNING_TYPES = Object.freeze(['success_pattern','failure_pattern','agent_performance','model_performance','tool_performance','recovery_pattern']);
export const LEARNING_OUTCOMES = Object.freeze(['success','failure','recovered']);
export const LEARNING_SCOPES = Object.freeze(['founder','company','project','task','agent','tool']);

const clamp = (v, min = 0, max = 1) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; };
const text = v => { if (v == null) return ''; if (typeof v === 'string') return v.trim(); try { return JSON.stringify(v); } catch { return String(v); } };
const tagsOf = v => [...new Set((Array.isArray(v) ? v : [v]).filter(Boolean).map(String))].slice(0, 50);
const fingerprintOf = ({ type, scope, scopeId, pattern }) => [type, scope, scopeId ?? '', text(pattern).toLowerCase().replace(/\s+/g, ' ')].join('|');

function confidenceOf(item) {
  const observations = Math.max(1, Number(item.observations) || 1);
  const successes = Math.max(0, Number(item.successes) || 0);
  const failures = Math.max(0, Number(item.failures) || 0);
  const empirical = (successes + 1) / (successes + failures + 2);
  const evidence = 1 - Math.exp(-observations / 10);
  return clamp((empirical + evidence) / 2);
}

export function recordLearning({ type, pattern, outcome, scope = 'company', scopeId = null, agentId = null, modelId = null, toolId = null, recoveryAction = null, evidence = null, confidence = null, source = 'system', tags = [] } = {}) {
  if (!LEARNING_TYPES.includes(type)) throw new Error(`Unsupported learning type: ${type}`);
  if (!LEARNING_OUTCOMES.includes(outcome)) throw new Error(`Unsupported learning outcome: ${outcome}`);
  if (!LEARNING_SCOPES.includes(scope)) throw new Error(`Unsupported learning scope: ${scope}`);
  if (!text(pattern)) throw new Error('Learning pattern is required');
  const fingerprint = fingerprintOf({ type, scope, scopeId, pattern });
  const existing = store.list('learning').find(x => x.fingerprint === fingerprint && x.status === 'active');
  const base = existing ?? { id: id('learn'), type, pattern, scope, scopeId, agentId, modelId, toolId, recoveryAction, observations: 0, successes: 0, failures: 0, recovered: 0, confidence: 0.5, tags: [], evidence: [], source, fingerprint, status: 'active', createdAt: now() };
  const updated = { ...base, agentId: agentId ?? base.agentId ?? null, modelId: modelId ?? base.modelId ?? null, toolId: toolId ?? base.toolId ?? null, recoveryAction: recoveryAction ?? base.recoveryAction ?? null, observations: base.observations + 1, successes: base.successes + (outcome === 'success' ? 1 : 0), failures: base.failures + (outcome === 'failure' ? 1 : 0), recovered: base.recovered + (outcome === 'recovered' ? 1 : 0), tags: tagsOf([...(base.tags ?? []), ...tagsOf(tags)]), evidence: [...(base.evidence ?? []), ...(evidence == null ? [] : [evidence])].slice(-20), updatedAt: now() };
  updated.confidence = confidence == null ? confidenceOf(updated) : clamp(confidence);
  const saved = store.put('learning', updated);
  remember({ type: 'learning', content: { learningId: saved.id, type, pattern, outcome, confidence: saved.confidence }, scope, scopeId, importance: saved.confidence >= 0.8 ? 'high' : 'normal', source: 'learning-engine', confidence: saved.confidence, tags: saved.tags });
  store.addEvent('learning.recorded', { learningId: saved.id, type, outcome, confidence: saved.confidence, scope, scopeId });
  return saved;
}

export function observeExecutionLearning({ task = null, execution = null, verification = null, recovery = null, agentId = null, modelId = null, toolId = null } = {}) {
  const passed = verification?.passed === true || execution?.state === 'completed';
  const recovered = Boolean(recovery?.action && recovery.action !== 'none' && passed);
  const scope = task?.projectId ? 'project' : 'company';
  const scopeId = task?.projectId ?? null;
  const pattern = text(task?.requiredCapabilities?.length ? task.requiredCapabilities : task?.title ?? 'execution').slice(0, 300);
  const records = [recordLearning({ type: passed ? 'success_pattern' : 'failure_pattern', pattern, outcome: recovered ? 'recovered' : passed ? 'success' : 'failure', scope, scopeId, agentId: agentId ?? task?.agentId ?? task?.assignedAgentId, modelId, toolId, recoveryAction: recovery?.action ?? null, evidence: { taskId: task?.id ?? null, executionId: execution?.executionId ?? execution?.id ?? null, verificationPassed: Boolean(verification?.passed) } })];
  const effectiveAgent = agentId ?? task?.agentId ?? task?.assignedAgentId;
  if (effectiveAgent) records.push(recordLearning({ type: 'agent_performance', pattern: String(effectiveAgent), outcome: passed ? 'success' : 'failure', scope: 'agent', scopeId: effectiveAgent, agentId: effectiveAgent, evidence: { taskId: task?.id ?? null } }));
  if (modelId) records.push(recordLearning({ type: 'model_performance', pattern: String(modelId), outcome: passed ? 'success' : 'failure', scope: 'company', modelId, evidence: { taskId: task?.id ?? null } }));
  if (toolId) records.push(recordLearning({ type: 'tool_performance', pattern: String(toolId), outcome: passed ? 'success' : 'failure', scope: 'tool', scopeId: toolId, toolId, evidence: { taskId: task?.id ?? null } }));
  if (recovery?.action) records.push(recordLearning({ type: 'recovery_pattern', pattern: String(recovery.action), outcome: passed ? 'recovered' : 'failure', scope: 'company', evidence: { taskId: task?.id ?? null, classification: recovery.classification ?? null } }));
  return records;
}

export function getLearning({ scope = null, scopeId = null, type = null, query = '', limit = 20, minConfidence = 0 } = {}) {
  const max = Math.max(1, Math.min(100, Number(limit) || 20));
  const q = text(query).toLowerCase();
  return store.list('learning').filter(x => x.status === 'active' && (!scope || x.scope === scope) && (!scopeId || x.scopeId === scopeId) && (!type || x.type === type) && Number(x.confidence) >= clamp(minConfidence)).filter(x => !q || `${x.pattern} ${JSON.stringify(x.tags ?? [])}`.toLowerCase().includes(q)).sort((a,b) => Number(b.confidence)-Number(a.confidence) || Number(b.observations)-Number(a.observations) || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,max);
}

export function retireLearning(learningId) { const item = store.get('learning', learningId); if (!item) return null; const updated = store.put('learning', { ...item, status: 'retired', retiredAt: now() }); store.addEvent('learning.retired', { learningId }); return updated; }
export function learningSnapshot() { const items = store.list('learning').filter(x => x.status === 'active'); return { count: items.length, highConfidence: items.filter(x => x.confidence >= 0.8).length, averageConfidence: items.length ? items.reduce((s,x)=>s+Number(x.confidence||0),0)/items.length : 0 }; }
