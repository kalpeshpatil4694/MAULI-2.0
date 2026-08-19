const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * MAULI Intelligence Bus
 *
 * The rest of MAULI talks to these functions instead of depending directly
 * on a specific AI provider/model. This keeps L1 free/open-model adapters
 * replaceable and makes the same Core usable by future L2/L3 models.
 */

function resolveModel(env, options = {}) {
  return options.model ?? env?.MAULI_MODEL ?? DEFAULT_MODEL;
}

function getProvider(env, options = {}) {
  return options.provider ?? env?.MAULI_AI_PROVIDER ?? 'cloudflare';
}

async function cloudflareGenerate(env, messages, options = {}) {
  if (!env?.AI?.run) throw new Error('Cloudflare AI binding is not configured');

  const model = resolveModel(env, options);
  const response = await env.AI.run(model, {
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 1200
  });

  return response?.response ?? response;
}

/**
 * Provider-independent text generation entry point.
 * New providers should be added here, not throughout MAULI Core.
 */
export async function generateAI(env, messages, options = {}) {
  const provider = getProvider(env, options);

  switch (provider) {
    case 'cloudflare':
      return cloudflareGenerate(env, messages, options);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

export async function generate(env, messages, options = {}) {
  return generateAI(env, messages, options);
}

export async function reason(env, messages, options = {}) {
  return generateAI(env, messages, {
    ...options,
    temperature: options.temperature ?? 0.1,
    maxTokens: options.maxTokens ?? 1800
  });
}

export async function code(env, messages, options = {}) {
  return generateAI(env, messages, {
    ...options,
    temperature: options.temperature ?? 0.1,
    maxTokens: options.maxTokens ?? 2400
  });
}

export async function interpretWithAI(env, command, options = {}) {
  const system = [
    'You are MAULI Executive AI.',
    'Return concise JSON only.',
    'Schema:',
    '{"objective":string,"requirements":string[],"capabilities":string[],"risks":string[],"acceptanceCriteria":string[]}',
    'Do not execute tools.',
    'Do not invent completed work.'
  ].join(' ');

  const raw = await reason(env, [
    { role: 'system', content: system },
    { role: 'user', content: String(command) }
  ], options);

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      objective: String(parsed?.objective ?? command),
      requirements: Array.isArray(parsed?.requirements) ? parsed.requirements : [],
      capabilities: Array.isArray(parsed?.capabilities) ? parsed.capabilities : [],
      risks: Array.isArray(parsed?.risks) ? parsed.risks : [],
      acceptanceCriteria: Array.isArray(parsed?.acceptanceCriteria) ? parsed.acceptanceCriteria : []
    };
  } catch {
    return {
      objective: String(command),
      requirements: [],
      capabilities: [],
      risks: [],
      acceptanceCriteria: [],
      raw
    };
  }
}

export function getAIConfig(env) {
  return {
    provider: getProvider(env),
    model: resolveModel(env),
    architecture: 'MAULI Intelligence Bus',
    upgradeable: true
  };
}
