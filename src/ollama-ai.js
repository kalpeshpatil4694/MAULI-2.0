/**
 * Ollama Integration — run LLMs locally for free.
 * Based on github.com/ollama/ollama (120k+ stars)
 * Benefits: Free, Private, Offline, Custom models
 */
import { now } from './core.js';
import { store } from './store.js';
import { remember } from './memory.js';

const OLLAMA_BASE = 'http://localhost:11434';

const RECOMMENDED_MODELS = {
  'general': { name: 'llama3.3', size: '70B', description: 'Best all-around model' },
  'code': { name: 'codellama', size: '34B', description: 'Best for code generation' },
  'fast': { name: 'phi3', size: '3.8B', description: 'Fastest responses' },
  'creative': { name: 'mistral', size: '7B', description: 'Creative writing' },
  'analysis': { name: 'gemma2', size: '9B', description: 'Data analysis' },
  'reasoning': { name: 'deepseek-r1', size: '7B', description: 'Chain of thought reasoning' },
  'multilingual': { name: 'qwen2.5', size: '7B', description: 'Multilingual support (Hindi, Marathi, etc.)' },
  'small': { name: 'tinyllama', size: '1.1B', description: 'Minimal resources' }
};

/**
 * Check if Ollama is running
 */
export async function checkOllama() {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return { available: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return {
      available: true,
      models: (data.models || []).map(m => ({
        name: m.name,
        size: m.size,
        modified: m.modified_at
      }))
    };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

/**
 * Generate text with Ollama
 */
export async function ollamaGenerate(prompt, options = {}) {
  const model = options.model || 'llama3.3';
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 2048;

  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens }
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json();
    return { success: true, response: data.response, model, evalDuration: data.eval_duration };
  } catch (e) {
    return { success: false, error: e.message, model };
  }
}

/**
 * Chat completion with Ollama
 */
export async function ollamaChat(messages, options = {}) {
  const model = options.model || 'llama3.3';

  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: { temperature: options.temperature ?? 0.7 }
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
    const data = await resp.json();
    return { success: true, response: data.message?.content, model };
  } catch (e) {
    return { success: false, error: e.message, model };
  }
}

/**
 * Generate code with Ollama
 */
export async function ollamaCode(prompt, options = {}) {
  const systemPrompt = `You are an expert software developer. Generate clean, production-ready code.
Return ONLY the code with no explanation unless asked. Use proper formatting and comments.`;

  return ollamaChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ], { model: options.model || 'codellama', temperature: 0.2, ...options });
}

/**
 * Generate reasoning/analysis with Ollama
 */
export async function ollamaReason(prompt, options = {}) {
  const systemPrompt = `You are an analytical reasoning engine. Think step by step.
Break down complex problems into components. Provide clear analysis.`;

  return ollamaChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ], { model: options.model || 'deepseek-r1', temperature: 0.1, ...options });
}

/**
 * Generate creative content with Ollama
 */
export async function ollamaCreative(prompt, options = {}) {
  const systemPrompt = `You are a creative content generator. Create engaging, original content.
Use vivid language, proper structure, and compelling narratives.`;

  return ollamaChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ], { model: options.model || 'mistral', temperature: 0.8, ...options });
}

/**
 * Generate multilingual content (Hindi, Marathi, etc.)
 */
export async function ollamaMultilingual(prompt, language = 'Hindi', options = {}) {
  const systemPrompt = `You are a multilingual expert. Respond in ${language}.
Use natural, native-level ${language} with proper grammar and cultural context.`;

  return ollamaChat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ], { model: options.model || 'qwen2.5', temperature: 0.7, ...options });
}

/**
 * Get recommended models
 */
export function getRecommendedModels() {
  return RECOMMENDED_MODELS;
}

/**
 * Get model for a specific task
 */
export function getModelForTask(taskType) {
  return RECOMMENDED_MODELS[taskType] || RECOMMENDED_MODELS.general;
}

/**
 * Pull/install a model
 */
export async function pullModel(modelName) {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(300000) // 5 min timeout for large models
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { success: true, model: modelName };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Record Ollama usage
 */
export function recordOllamaUsage(projectId, model, success) {
  remember({
    type: 'technical_knowledge',
    content: { action: 'ollama_usage', model, success },
    scope: 'project',
    scopeId: projectId,
    importance: 'normal',
    source: 'ollama-ai'
  });
}
