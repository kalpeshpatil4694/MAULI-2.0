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

function cleanList(value, limit = 30) { return Array.isArray(value) ? value.map(x => String(x).trim()).filter(Boolean).slice(0, limit) : []; }
function isCalculatorCommand(command) { return /\bcalculator\b|basic arithmetic|calculation history|clear history|addition|subtraction|multiplication|division/i.test(String(command ?? '')); }
function normalizePlan(parsed, command) {
  const objective = String(parsed?.objective ?? command).trim() || String(command);
  const requirements = cleanList(parsed?.requirements);
  const acceptanceCriteria = cleanList(parsed?.acceptanceCriteria);
  const risks = cleanList(parsed?.risks, 20);
  const capabilities = [...new Set(cleanList(parsed?.capabilities).map(x => x.toLowerCase()).filter(x => CAPABILITIES.includes(x)))];
  if (isCalculatorCommand(command)) {
    const calculatorRequirements = ['User can perform addition, subtraction, multiplication, and division','User can view calculation history','User can clear calculation history','App is responsive and mobile-friendly'];
    return { objective, requirements: [...new Set([...calculatorRequirements, ...requirements.filter(r => !/backend|api|database|persistence schema|server/i.test(r))])], capabilities: ['planning','product-planning','frontend','ui','security','testing'], risks, acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : ['All arithmetic operations work','History can be viewed and cleared','Responsive mobile UI is present','Security and final verification pass'] };
  }
  return { objective, requirements, capabilities, risks, acceptanceCriteria };
}
function extractJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw ?? '').trim();
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) { try { return JSON.parse(fenced); } catch {} }
  const first = text.indexOf('{'); const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(text.slice(first, last + 1)); } catch {} }
  return null;
}
export function freePlanFromCommand(command) {
  const text = String(command ?? '').trim(); const capabilities = ['planning']; const requirements = [text]; const acceptanceCriteria = ['Clear requirements','Execution plan','Verification'];
  if (isCalculatorCommand(text)) { capabilities.push('product-planning','frontend','ui','security','testing'); requirements.push('User can perform addition, subtraction, multiplication, and division','User can view calculation history','User can clear calculation history','App is responsive and mobile-friendly'); acceptanceCriteria.splice(0, acceptanceCriteria.length,'All arithmetic operations work','Calculation history can be viewed and cleared','Responsive mobile-friendly UI is present','Security review and final verification pass'); }
  else if (/(e-commerce|ecommerce|online store|online shop|shop|store)/i.test(text)) { capabilities.push('product-planning','frontend','backend','database','security','testing'); requirements.push('Product catalog and product details','Shopping cart and checkout flow','Order and customer data persistence','Basic authentication and security review','Responsive user interface'); acceptanceCriteria.splice(0, acceptanceCriteria.length,'Product catalog is defined','Cart and checkout flow is defined','Order and customer persistence is defined','Security review is included','Testing plan is included'); }
  else if (/(website|web app|application|platform|software|app)/i.test(text)) { capabilities.push('product-planning','frontend','backend','testing'); requirements.push('User interface','Application/API structure','Basic verification'); }
  else if (/(research|analysis|study)/i.test(text)) { capabilities.push('research','verification'); requirements.push('Research questions and evidence','Independent verification'); }
  return { objective:text, requirements, capabilities:[...new Set(capabilities)], risks:['AI model unavailable; deterministic free planning fallback used'], acceptanceCriteria };
}
export async function interpretWithAI(env, command, options = {}) {
  const system = ['You are MAULI Executive AI for a software company.','Analyze the Founder command before any execution.','Return one valid JSON object only. Do not use markdown fences or explanatory text.','Never claim work is completed. You are planning only.',`Allowed capabilities: ${CAPABILITIES.join(', ')}.`,'Select only capabilities genuinely needed. For a calculator web app, use planning, product-planning, frontend/ui, security, and testing; do not invent backend, API, database, or persistence tasks unless the Founder explicitly requests a server or persistent backend.','Requirements must be concrete and testable. Acceptance criteria must describe observable completion conditions.','Risks must mention meaningful execution or approval concerns, not generic filler.','Schema: {"objective":string,"requirements":string[],"capabilities":string[],"risks":string[],"acceptanceCriteria":string[]}'].join(' ');
  const raw = await reason(env, [{ role:'system', content:system }, { role:'user', content:String(command) }], options);
  const parsed = extractJson(raw);
  if (!parsed) return { objective:String(command ?? '').trim(), requirements:[], capabilities:[], risks:['Model output was not valid JSON; planning was not accepted'], acceptanceCriteria:[], planningStatus:'invalid_model_output' };
  return normalizePlan(parsed, command);
}
export function getAIConfig(env) { return { provider:getProvider(env), model:resolveModel(env), architecture:'MAULI Intelligence Bus', upgradeable:true, fallback:'deterministic-free-planner' }; }
