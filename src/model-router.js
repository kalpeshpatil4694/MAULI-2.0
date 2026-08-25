import { modelRegistry } from './model-registry.js';

const COMPLEXITY_WEIGHTS = {
  simple: { quality: 0.20, speed: 0.35, cost: 0.30, reasoning: 0.15 },
  medium: { quality: 0.30, speed: 0.20, cost: 0.20, reasoning: 0.30 },
  complex: { quality: 0.30, speed: 0.10, cost: 0.10, reasoning: 0.50 },
  critical: { quality: 0.35, speed: 0.05, cost: 0.05, reasoning: 0.55 }
};

const CAPABILITY_ALIASES = {
  coding: ['coding', 'software-development', 'backend', 'frontend', 'javascript'],
  code: ['coding', 'software-development', 'backend', 'frontend', 'javascript'],
  analysis: ['analysis', 'research'],
  development: ['software-development', 'coding']
};

function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }

export function classifyComplexity(task = {}) {
  const explicit = String(task.complexity ?? '').toLowerCase();
  if (Object.hasOwn(COMPLEXITY_WEIGHTS, explicit)) return explicit;
  const caps = Array.isArray(task.requiredCapabilities) ? task.requiredCapabilities : [];
  const text = String(task.description ?? task.objective ?? '').toLowerCase();
  if (task.riskLevel === 'critical' || /\b(critical|production|migration|secrets|destructive)\b/i.test(text)) return 'critical';
  if (caps.length >= 4 || /\b(architecture|e-commerce|ecommerce|platform|multi-service)\b/i.test(text)) return 'complex';
  if (caps.length >= 2 || /\b(integrat|database|api|security|backend|frontend)\b/i.test(text)) return 'medium';
  return 'simple';
}

export function expandCapabilities(required = []) {
  const set = new Set(required.filter(Boolean).map(String));
  for (const capability of [...set]) for (const alias of CAPABILITY_ALIASES[capability.toLowerCase()] ?? []) set.add(alias);
  return [...set];
}

export function scoreModel(model, { complexity = 'medium', estimatedContext = 0, riskLevel = 'normal', avoidModels = [] } = {}) {
  if (!model?.id || avoidModels.includes(model.id)) return -Infinity;
  const contextWindow = Number(model.contextWindow ?? 0);
  if (contextWindow < Number(estimatedContext)) return -Infinity;
  if (riskLevel === 'critical' && model.riskLevel === 'restricted') return -Infinity;
  if (riskLevel === 'high' && model.riskLevel === 'restricted') return -Infinity;
  const w = COMPLEXITY_WEIGHTS[complexity] ?? COMPLEXITY_WEIGHTS.medium;
  const quality = clamp(Number(model.qualityScore ?? 0));
  const speed = clamp(Number(model.speedScore ?? 0));
  const cost = clamp(Number(model.costScore ?? 0));
  const reasoning = clamp(Number(model.reasoningScore ?? 0));
  const reliability = clamp(Number(model.reliabilityScore ?? 0));
  const contextFit = estimatedContext > 0 ? clamp(100 - (Number(estimatedContext) / Math.max(1, contextWindow)) * 100) : 100;
  return quality * w.quality + speed * w.speed + cost * w.cost + reasoning * w.reasoning + reliability * 0.10 + contextFit * 0.10;
}

function rank(candidates, scoringOptions) {
  return candidates.map(model => ({ model, score: scoreModel(model, scoringOptions) }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score || a.model.id.localeCompare(b.model.id));
}

export function routeModel(task = {}, options = {}) {
  const required = expandCapabilities(task.requiredCapabilities ?? []);
  const complexity = classifyComplexity(task);
  const riskLevel = task.riskLevel ?? (complexity === 'critical' ? 'critical' : 'normal');
  const estimatedContext = Math.max(0, Number(task.estimatedContext ?? task.contextTokens ?? 0));
  const avoidModels = options.avoidModels ?? [];
  const candidates = modelRegistry.candidates(required, {
    provider: options.provider,
    minContextWindow: estimatedContext,
    riskLevel,
    excludedModels: avoidModels
  });
  const scored = rank(candidates, { complexity, estimatedContext, riskLevel, avoidModels });
  const selected = scored[0]?.model ?? null;
  const fallback = scored[1]?.model ?? null;
  return {
    selected,
    fallback,
    complexity,
    riskLevel,
    requiredCapabilities: required,
    candidates: scored.map(({ model, score }) => ({ modelId: model.id, provider: model.provider, score: Number(score.toFixed(4)) })),
    reason: selected ? 'best-fit capability/quality/speed/cost/reliability/context score' : 'no eligible model with required capabilities and context',
    routable: Boolean(selected)
  };
}

export function routeForRetry(task = {}, previousModelId) {
  return routeModel(task, { avoidModels: previousModelId ? [previousModelId] : [] });
}

export { COMPLEXITY_WEIGHTS };
