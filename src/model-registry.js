const DEFAULT_MODELS = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', provider: 'cloudflare', capabilities: ['research','planning','product-planning','frontend','ui','backend','api','database','schema','sql','security','testing','verification','artifact-e2e'], contextWindow: 32768, reasoningScore: 90, codingScore: 88, qualityScore: 88, speedScore: 82, costScore: 90, reliabilityScore: 85, riskLevel: 'normal', enabled: true }
];
function clone(model) { return { ...model, capabilities: [...(model.capabilities ?? [])] }; }
export class ModelRegistry {
  constructor(models = DEFAULT_MODELS) { this.models = new Map(models.map(model => [model.id, clone(model)])); }
  register(model) { if (!model?.id || !model?.provider) throw new Error('Model id and provider are required'); const current=this.models.get(model.id)??{}; const next={...current,...model,capabilities:[...new Set(model.capabilities??current.capabilities??[])]}; this.models.set(next.id,clone(next)); return clone(next); }
  get(id) { const model=this.models.get(id); return model?clone(model):null; }
  list({enabledOnly=false}={}) { return [...this.models.values()].filter(model=>!enabledOnly||model.enabled!==false).map(clone); }
  candidates(requiredCapabilities=[],{provider,minContextWindow=0,riskLevel}={}) { const required=[...new Set(requiredCapabilities.filter(Boolean))]; return this.list({enabledOnly:true}).filter(model=>{if(provider&&model.provider!==provider)return false;if(Number(model.contextWindow??0)<Number(minContextWindow))return false;if(riskLevel==='critical'&&model.riskLevel==='restricted')return false;const caps=new Set(model.capabilities??[]);return required.every(cap=>caps.has(cap));}); }
}
export const modelRegistry = new ModelRegistry();
export { DEFAULT_MODELS };
