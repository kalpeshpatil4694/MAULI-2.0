const DEFAULT_MODELS = [
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    provider: 'cloudflare',
    capabilities: ['research','analysis','requirements','planning','product-planning','frontend','ui','backend','api','database','schema','sql','javascript','coding','security','audit','testing','verification','artifact-e2e','software-development'],
    contextWindow: 32768,
    reasoningScore: 90,
    codingScore: 88,
    qualityScore: 88,
    speedScore: 82,
    costScore: 90,
    reliabilityScore: 85,
    riskLevel: 'normal',
    enabled: true
  }
];

const SCORE_FIELDS = ['reasoningScore','codingScore','qualityScore','speedScore','costScore','reliabilityScore'];
const RISK_LEVELS = new Set(['low','normal','high','critical','restricted']);

function clone(model) { return { ...model, capabilities: [...(model.capabilities ?? [])] }; }
function validScore(value) { return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100; }

function validateModel(model) {
  if (!model?.id || typeof model.id !== 'string') throw new Error('Model id is required');
  if (!model?.provider || typeof model.provider !== 'string') throw new Error('Model provider is required');
  if (!Array.isArray(model.capabilities)) throw new Error('Model capabilities must be an array');
  if (!Number.isFinite(Number(model.contextWindow)) || Number(model.contextWindow) <= 0) throw new Error('Model contextWindow must be positive');
  for (const key of SCORE_FIELDS) if (!validScore(model[key])) throw new Error(`Model ${key} must be between 0 and 100`);
  if (!RISK_LEVELS.has(model.riskLevel ?? 'normal')) throw new Error('Model riskLevel is invalid');
}

export class ModelRegistry {
  constructor(models = DEFAULT_MODELS) {
    this.models = new Map();
    for (const model of models) this.register(model);
  }
  register(model) {
    const current = this.models.get(model?.id) ?? {};
    const next = { ...current, ...model, capabilities: [...new Set(model?.capabilities ?? current.capabilities ?? [])], riskLevel: model?.riskLevel ?? current.riskLevel ?? 'normal', enabled: model?.enabled !== false };
    validateModel(next);
    this.models.set(next.id, clone(next));
    return clone(next);
  }
  get(id) { const model = this.models.get(id); return model ? clone(model) : null; }
  list({ enabledOnly = false } = {}) { return [...this.models.values()].filter(model => !enabledOnly || model.enabled !== false).map(clone); }
  candidates(requiredCapabilities = [], { provider, minContextWindow = 0, riskLevel = 'normal', excludedModels = [] } = {}) {
    const required = [...new Set(requiredCapabilities.filter(Boolean).map(String))];
    const excluded = new Set(excludedModels);
    return this.list({ enabledOnly: true }).filter(model => {
      if (excluded.has(model.id)) return false;
      if (provider && model.provider !== provider) return false;
      if (Number(model.contextWindow) < Number(minContextWindow)) return false;
      if (riskLevel === 'critical' && model.riskLevel === 'restricted') return false;
      if (riskLevel === 'high' && model.riskLevel === 'restricted') return false;
      const capabilities = new Set(model.capabilities ?? []);
      return required.every(capability => capabilities.has(capability));
    });
  }
}

export const modelRegistry = new ModelRegistry();
export { DEFAULT_MODELS, validateModel };
