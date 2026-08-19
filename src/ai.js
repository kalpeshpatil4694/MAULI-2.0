const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function resolveModel(env, options = {}) { return options.model ?? env?.MAULI_MODEL ?? DEFAULT_MODEL; }
function getProvider(env, options = {}) { return options.provider ?? env?.MAULI_AI_PROVIDER ?? 'cloudflare'; }

async function cloudflareGenerate(env, messages, options = {}) {
  if (!env?.AI?.run) throw new Error('Cloudflare AI binding is not configured');
  const response = await env.AI.run(resolveModel(env, options), { messages, temperature: options.temperature ?? 0.2, max_tokens: options.maxTokens ?? 1200 });
  return response?.response ?? response;
}

export async function generateAI(env, messages, options = {}) {
  switch (getProvider(env, options)) {
    case 'cloudflare': return cloudflareGenerate(env, messages, options);
    default: throw new Error(`Unsupported AI provider: ${getProvider(env, options)}`);
  }
}
export async function generate(env, messages, options = {}) { return generateAI(env, messages, options); }
export async function reason(env, messages, options = {}) { return generateAI(env, messages, { ...options, temperature: options.temperature ?? 0.1, maxTokens: options.maxTokens ?? 1800 }); }
export async function code(env, messages, options = {}) { return generateAI(env, messages, { ...options, temperature: options.temperature ?? 0.1, maxTokens: options.maxTokens ?? 2400 }); }

const CAPABILITIES = ['research','planning','product-planning','frontend','ui','backend','api','database','schema','sql','security','testing','verification'];

function normalizePlan(parsed, command) {
  const requirements = Array.isArray(parsed?.requirements) ? parsed.requirements.map(String).filter(Boolean).slice(0, 30) : [];
  const capabilities = Array.isArray(parsed?.capabilities) ? [...new Set(parsed.capabilities.map(String).map(x => x.toLowerCase()).filter(x => CAPABILITIES.includes(x)))] : [];
  const acceptanceCriteria = Array.isArray(parsed?.acceptanceCriteria) ? parsed.acceptanceCriteria.map(String).filter(Boolean).slice(0, 30) : [];
  return { objective: String(parsed?.objective ?? command), requirements, capabilities, risks: Array.isArray(parsed?.risks) ? parsed.risks.map(String).slice(0, 20) : [], acceptanceCriteria };
}

export async function interpretWithAI(env, command, options = {}) {
  const system = [
    'You are MAULI Executive AI for a software company.',
    'Analyze the Founder command before any execution.',
    'Return JSON only. Never claim work is completed.',
    'Break the request into concrete requirements and select capabilities needed to execute it.',
    `Allowed capabilities: ${CAPABILITIES.join(', ')}.`,
    'For a software product, include only capabilities genuinely needed; prefer research/product-planning first, then frontend/backend/database/security/testing as applicable.',
    'Schema: {"objective":string,"requirements":string[],"capabilities":string[],"risks":string[],"acceptanceCriteria":string[]}'
  ].join(' ');
  const raw = await reason(env, [{ role:'system', content:system }, { role:'user', content:String(command) }], options);
  try { return normalizePlan(typeof raw === 'string' ? JSON.parse(raw) : raw, command); }
  catch { return { objective:String(command), requirements:[], capabilities:[], risks:[], acceptanceCriteria:[], raw }; }
}

export function getAIConfig(env) { return { provider:getProvider(env), model:resolveModel(env), architecture:'MAULI Intelligence Bus', upgradeable:true }; }
