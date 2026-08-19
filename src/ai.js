const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function generateAI(env, messages, options = {}) {
  if (!env?.AI?.run) throw new Error('AI binding is not configured');
  const model = options.model ?? env.MAULI_MODEL ?? DEFAULT_MODEL;
  const response = await env.AI.run(model, { messages, temperature: options.temperature ?? 0.2, max_tokens: options.maxTokens ?? 1200 });
  return response?.response ?? response;
}

export async function interpretWithAI(env, command) {
  const system = 'You are MAULI Executive AI. Return concise JSON with objective, requirements (array), capabilities (array), risks (array), and acceptanceCriteria (array). Do not execute tools.';
  const raw = await generateAI(env, [{ role:'system', content:system }, { role:'user', content:String(command) }]);
  try { return JSON.parse(raw); } catch { return { objective:String(command), requirements:[], capabilities:[], risks:[], acceptanceCriteria:[], raw }; }
}
