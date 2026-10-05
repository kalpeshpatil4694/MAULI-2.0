/**
 * Groq Integration — a free, fast OpenAI-compatible LLM API used as MAULI's fallback
 * provider when Cloudflare Workers AI is unavailable or its daily allowance is spent.
 *
 * Groq is a CLOUD service (api.groq.com), so unlike Ollama it needs the network: it is the
 * cloud fallback in the chain Workers AI → Groq → deterministic templates, not the offline
 * path. Its purpose is to keep a founder's project getting a model-built app when Workers AI
 * has run out (4006) instead of dropping straight to a template.
 */
import { withDeadline } from './core.js';

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GROQ_DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = 60_000;
// A whole-app prompt asks for five complete files (HTML + JS + CSS + manifest + README).
// Capped at 3000 tokens the completion was cut mid-file for anything but the smallest app,
// so the JSON never parsed and the executor fell through to a template — measured live:
// only 3 of 9 generations produced usable output before this change. llama-3.3-70b has a
// far larger budget, so the ceiling is raised and an operator can tune or lower it.
const GROQ_MAX_TOKENS_CEILING = 8000;

/** The ceiling for one completion: operator override, else the Groq ceiling. */
export function groqMaxTokens(env, options = {}) {
  const override = Number(env?.MAULI_AI_MAX_TOKENS);
  const ceiling = Number.isFinite(override) && override > 0 ? override : GROQ_MAX_TOKENS_CEILING;
  const requested = Number(options.maxTokens);
  return Math.min(ceiling, Math.max(900, Number.isFinite(requested) && requested > 0 ? requested : 900));
}

/**
 * A missing or blank key is a configuration state, not a runtime failure. It is thrown as
 * its own error type so callers can tell "Groq is not set up" (fall through to templates,
 * do not record an outage) from "Groq answered badly".
 */
export class GroqConfigError extends Error {
  constructor(message = 'Groq is not configured: set GROQ_API_KEY') {
    super(message);
    this.name = 'GroqConfigError';
  }
}

export function groqApiKey(env) {
  const key = env?.GROQ_API_KEY ?? env?.MAULI_GROQ_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

/** Is Groq usable right now? False for a missing, blank or non-string key. */
export function groqConfigured(env) {
  return Boolean(groqApiKey(env));
}

export function groqModel(env, options = {}) {
  return options.groqModel ?? env?.MAULI_GROQ_MODEL ?? GROQ_DEFAULT_MODEL;
}

function groqTimeoutMs(env, options = {}) {
  return Number(options.timeoutMs ?? env?.MAULI_AI_TIMEOUT_MS ?? GROQ_TIMEOUT_MS);
}

/**
 * One chat completion. Returns the assistant message text as a string, matching the shape
 * `cloudflareGenerate` returns so the two providers are interchangeable to `generateAI`.
 * Every failure path throws a plain Error with a reason an operator can act on; the key is
 * never echoed back.
 */
export async function groqGenerate(env, messages, options = {}) {
  const key = groqApiKey(env);
  if (!key) throw new GroqConfigError();
  const model = groqModel(env, options);
  const body = {
    model,
    messages: (Array.isArray(messages) ? messages : [])
      .filter((m) => m && m.role && m.content != null)
      .map((m) => ({ role: m.role, content: m.content })),
    temperature: options.temperature ?? 0.2,
    // The pipeline asks for enough tokens to emit a complete multi-file artifact. A 3000
    // ceiling truncated exactly the large apps this provider exists to generate, so the
    // budget is honoured up to the (overridable) ceiling instead of being pinned low.
    max_tokens: groqMaxTokens(env, options)
  };

  const response = await withDeadline(fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  }), groqTimeoutMs(env, options), `Groq (${model})`);

  if (!response.ok) {
    // 401/403 is a bad key, and 429 is the free-tier rate limit — name both so the founder
    // sees a fixable cause instead of an opaque HTTP number.
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Groq rejected the API key (HTTP ${response.status}); check GROQ_API_KEY`);
    }
    if (response.status === 429) {
      throw new Error('Groq rate limit reached (HTTP 429); falling back to deterministic templates');
    }
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  // An empty completion is not a success: returning '' would be parsed as no files and the
  // project would silently lose its app. Fail so the caller falls through.
  if (content == null || String(content).trim() === '') throw new Error('Groq returned an empty response');
  return content;
}

export { GROQ_BASE, GROQ_DEFAULT_MODEL };
