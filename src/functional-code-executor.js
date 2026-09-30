import { code } from './ai.js';
import { registerArtifact } from './artifacts.js';
import { registerExecutor, grantExecutor } from './executor-registry.js';
import { generateFromTemplate } from './app-templates.js';

const WEB_REQUIRED = ['www/index.html', 'www/app.js', 'www/styles.css'];
const COMMON_REQUIRED = ['package.json', 'README.md'];

// Errors are objects, so a plain JSON.stringify turned every thrown model failure into
// "{}" — the one message an operator needs when generation falls back to a template came
// out empty. Coerce the message first, then serialise anything genuinely structured.
function text(v) {
  if (v == null) return '';
  if (v instanceof Error) return v.message || String(v);
  if (typeof v === 'object') { try { return JSON.stringify(v) ?? ''; } catch { return String(v); } }
  return String(v);
}
function filesOf(value) {
  const out = [];
  for (const f of Array.isArray(value) ? value : []) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') continue;
    const path = f.path.replace(/^\/+/, '').replace(/\.\.(?:[\\/])/g, '').replace(/\\/g, '/');
    if (!path || path.startsWith('node_modules/')) continue;
    out.push({ path, content: f.content });
  }
  return [...new Map(out.map(f => [f.path, f])).values()];
}

function parseModel(raw) {
  if (raw && typeof raw === 'object') return raw;
  let s = text(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

function isWebTask(task) {
  const caps = new Set((task?.requiredCapabilities ?? []).map(String));
  const title = text(task?.title || task?.description);
  return caps.has('frontend') || caps.has('ui') || /frontend|web|website|dashboard|mobile app|application UI|video call|screen|record/i.test(title);
}

function invalid(files, task) {
  if (!files || files.length === 0) return true;
  const paths = new Set(files.map(f => f.path));
  const combined = files.map(f => f.content).join('\n');
  if (combined.trim().length < 200) return true;
  if (isWebTask(task)) {
    if (!paths.has('www/index.html')) return true;
    const js = files.find(f => f.path === 'www/app.js')?.content || '';
    const css = files.find(f => f.path === 'www/styles.css')?.content || '';
    if (js.trim().length < 50) return true;
    return false;
  }
  return false;
}

function resolveRuntimeEnv(env) {
  if (env?.AI?.run) return env;
  if (env?.env?.AI?.run) return env.env;
  if (env?.runtimeEnv?.AI?.run) return env.runtimeEnv;
  if (env?.bindings?.AI?.run) return env.bindings;
  return null;
}

const AI_ATTEMPT_TIMEOUT_MS = 40_000;

/**
 * A model that answers with an empty {} manifest has produced a project that cannot be
 * installed — the APK build needs a real package.json — so this repairs rather than
 * rejects. Rejecting would throw the whole app away and fall back to a template, which is
 * a worse answer than a correct manifest for code the founder never has to read.
 */
function ensurePackageJson(files, objective) {
  const list = Array.isArray(files) ? files : [];
  const words = String(objective || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    // Drop the instruction words: a package named "build-a-pomodoro-timer-web-app"
    // describes the request, not the project.
    .filter(w => w && !['build','create','make','a','an','the','simple','app','application','web','website','with','that','for','me'].includes(w))
    .slice(0, 3);
  const name = words.join('-').slice(0, 30) || 'mauli-app';
  const isEmpty = (content) => {
    const raw = String(content ?? '').trim();
    if (!raw) return true;
    try {
      const parsed = JSON.parse(raw);
      return !parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length === 0;
    } catch { return false; }
  };
  const index = list.findIndex(f => f.path === 'package.json');
  const manifest = JSON.stringify({ name, version: '1.0.0', private: true, scripts: { start: 'npx serve www' } }, null, 2);
  if (index === -1) return [...list, { path: 'package.json', content: manifest }];
  if (isEmpty(list[index].content)) list[index] = { ...list[index], content: manifest };
  return list;
}

const DEFAULT_CODE_MODEL_FALLBACK = '@cf/qwen/qwen3-30b-a3b-fp8';

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('AI generation timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const WEB_TASK_PROMPT = `You are a senior web developer generating a COMPLETE, WORKING web application.

OUTPUT FORMAT: Return ONLY a valid JSON object with this exact structure:
{"summary":"brief description","files":[{"path":"www/index.html","content":"FULL HTML"},{"path":"www/app.js","content":"FULL JAVASCRIPT"},{"path":"www/styles.css","content":"FULL CSS"},{"path":"package.json","content":"{\"name\":\"my-app\",\"version\":\"1.0.0\",\"scripts\":{\"start\":\"npx serve www\"}}"},{"path":"README.md","content":"# App"}],"tests":["test description"],"notes":["note"]}

CRITICAL RULES:
0. package.json MUST be a real manifest with at least "name", "version" and "scripts". NEVER output an empty {} for it — an empty manifest breaks the build and the app cannot be installed.
1. www/index.html MUST be a complete, standalone HTML file with <!DOCTYPE html>, <html>, <head>, <body> tags
2. www/app.js MUST contain ALL JavaScript logic — event handlers, functions, DOM manipulation
3. www/styles.css MUST contain ALL styles — layout, colors, responsive design, animations
4. The app MUST be fully functional when opened in a browser
5. Use modern CSS (flexbox, grid, variables) and clean JavaScript (ES6+)
6. Include proper error handling and user feedback
7. Make it visually polished with good colors, spacing, and typography
8. Include ALL features mentioned in the task description
9. Use localStorage for data persistence when needed
10. NO placeholders, NO "TODO", NO incomplete code

EXAMPLE FOR A TODO APP:
{"summary":"A responsive todo app with add/delete/complete features","files":[{"path":"www/index.html","content":"<!DOCTYPE html><html><head><title>Todo App</title><link rel='stylesheet' href='styles.css'></head><body><div class='container'><h1>My Todos</h1><div class='input-group'><input id='todoInput' placeholder='Add a todo...'><button onclick='addTodo()'>Add</button></div><ul id='todoList'></ul></div><script src='app.js'></script></body></html>"},{"path":"www/app.js","content":"let todos=JSON.parse(localStorage.getItem('todos')||'[]');function render(){const list=document.getElementById('todoList');list.innerHTML=todos.map((t,i)=>'<li class="'+(t.done?'done':'')+'"><span onclick='toggleTodo('+i+')>'+t.text+'</span><button onclick='deleteTodo('+i+')'>×</button></li>').join('');localStorage.setItem('todos',JSON.stringify(todos))}function addTodo(){const input=document.getElementById('todoInput');if(!input.value.trim())return;todos.push({text:input.value.trim(),done:false});input.value='';render()}function toggleTodo(i){todos[i].done=!todos[i].done;render()}function deleteTodo(i){todos.splice(i,1);render()}render()"},{"path":"www/styles.css","content":"*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#1a1a2e;color:#eee;min-height:100vh;display:flex;justify-content:center;padding:40px 20px}.container{width:100%;max-width:500px}h1{text-align:center;margin-bottom:20px;color:#00d4ff}.input-group{display:flex;gap:8px;margin-bottom:20px}input{flex:1;padding:12px;border-radius:8px;border:1px solid #333;background:#16213e;color:#eee;font-size:16px}button{padding:12px 24px;border:none;border-radius:8px;background:#00d4ff;color:#000;font-weight:bold;cursor:pointer}ul{list-style:none}li{display:flex;align-items:center;justify-content:space-between;padding:12px;margin-bottom:8px;background:#16213e;border-radius:8px;border-left:3px solid #00d4ff}li.done{opacity:.5;border-left-color:#666}li span{cursor:pointer;flex:1}li button{padding:4px 12px;background:#ff4757;color:#fff;border-radius:4px}"},{"path":"package.json","content":"{}"},{"path":"README.md","content":"# Todo App\nA responsive todo application."}],"tests":["Add a todo","Complete a todo","Delete a todo"],"notes":["Uses localStorage for persistence"]}`;

const BACKEND_PROMPT = `You are a backend developer generating server-side code.

OUTPUT FORMAT: Return ONLY a valid JSON object:
{"summary":"brief description","files":[{"path":"server.js","content":"FULL SERVER CODE"},{"path":"package.json","content":"FULL PACKAGE.JSON"},{"path":"README.md","content":"# App"}],"tests":["test"],"notes":["note"]}

RULES:
1. Generate complete, working server code
2. Include proper error handling
3. Include package.json with all dependencies
4. Make it production-ready`;

/**
 * Run the real AI generation path and report what came back, WITHOUT persisting anything.
 *
 * generateFunctionalArtifact() is only reachable through the scheduler, which cannot start
 * until the project row exists — so when D1 writes are refused (the account's daily
 * rows_written ceiling, for example) the AI path becomes impossible to test at all: the
 * only symptom is "completed" with a template behind it, which looks identical to the AI
 * path working. This runs the identical prompt, parsing and validation loop against the
 * real binding and returns the verdict, so the two can be told apart.
 */
export async function probeAiGeneration(objective, { env, acceptance = [], includeContent = false } = {}) {
  const runtimeEnv = resolveRuntimeEnv(env);
  if (!runtimeEnv?.AI?.run) {
    return { available: false, reason: 'no-ai-binding', model: env?.MAULI_CODE_MODEL ?? DEFAULT_CODE_MODEL_FALLBACK };
  }
  const systemPrompt = WEB_TASK_PROMPT + '\n\nTask: ' + objective + '\nAcceptance criteria: ' + JSON.stringify(acceptance);
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = attempt === 0 ? objective : objective + '\n\nIMPORTANT: Your previous response was invalid. Generate COMPLETE source code for all files. Each file must have full, working code. Output ONLY the JSON object.';
      const raw = await withTimeout(code(runtimeEnv, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], { maxTokens: 3000 }), AI_ATTEMPT_TIMEOUT_MS);
      const parsed = parseModel(raw);
      const files = ensurePackageJson(filesOf(parsed?.files), objective);
      // Validate against a web task: this probe uses the web prompt, so it must be held to
      // the same bar the executor applies (a real index.html plus real app.js/styles.css),
      // or it would report success for output the executor would reject and fall back.
      const bad = invalid(files, { title: objective });
      if (!bad && files.length) {
        return {
          available: true, generated: true, attempt: attempt + 1,
          fileCount: files.length,
          files: includeContent
            ? files.map(f => ({ path: f.path, bytes: String(f.content ?? '').length, content: String(f.content ?? '') }))
            : files.map(f => ({ path: f.path, bytes: String(f.content ?? '').length })),
          summary: text(parsed.summary ?? '').slice(0, 300),
          hasPlaceholder: /AI generation unavailable|placeholder|TODO: implement/i.test(files.map(f => String(f.content)).join('\n')),
          preview: String(files.find(f => /index\.html$/i.test(f.path))?.content ?? files[0]?.content ?? '').slice(0, 400),
        };
      }
      lastError = bad ? 'output rejected: missing required files or too little code' : 'model returned no usable files';
    } catch (error) { lastError = text(error); }
  }
  return { available: true, generated: false, error: text(lastError).slice(0, 400), model: env?.MAULI_CODE_MODEL ?? null };
}

async function generateFunctionalArtifact({ task, env, agentId }) {
  const runtimeEnv = resolveRuntimeEnv(env);
  const objective = text(task.description || task.title || 'Build a software application');
  const acceptance = Array.isArray(task.acceptance) ? task.acceptance : [];
  const webTask = isWebTask(task);

  // If no AI binding, use templates directly
  if (!runtimeEnv?.AI?.run) {
    const templateResult = generateFromTemplate({ objective, capabilities: task.requiredCapabilities || [] });
    if (templateResult.files?.length > 0) {
      const artifact = registerArtifact({
        projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
        content: { summary: templateResult.summary, files: templateResult.files, tests: templateResult.tests || [], notes: templateResult.notes || [] },
        metadata: { generatedBy: 'app-templates', template: templateResult.projectType, fileCount: templateResult.files.length }
      });
      return { type: 'code', artifactId: artifact.id, summary: templateResult.summary, files: templateResult.files, tests: templateResult.tests || [], notes: templateResult.notes || [], acceptance };
    }
    // Generate a basic functional app instead of just a README stub
    const stubFiles = [
      { path: 'www/index.html', content: '<!DOCTYPE html><html><head><title>' + objective.slice(0,60) + '</title><link rel="stylesheet" href="styles.css"></head><body><div class="container"><h1>' + objective.slice(0,80) + '</h1><p>Generated by MAULI 2.0</p><div id="app"></div></div><script src="app.js"></script></body></html>' },
      { path: 'www/app.js', content: 'document.getElementById("app").innerHTML="<p>App placeholder — AI generation unavailable.</p>";' },
      { path: 'www/styles.css', content: '*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0b1120;color:#e8ecf4;min-height:100vh;display:flex;justify-content:center;padding:40px}.container{max-width:600px;text-align:center}h1{font-size:1.5rem;margin-bottom:12px;color:#00d4ff}' },
      { path: 'package.json', content: '{}' },
      { path: 'README.md', content: '# ' + objective + '\n\nGenerated by MAULI 2.0. AI binding unavailable — template fallback used.' }
    ];
    const artifact = registerArtifact({
      projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
      content: { summary: 'Basic placeholder for: ' + objective, files: stubFiles, tests: [], notes: ['AI binding unavailable — minimal template used'] },
      metadata: { generatedBy: 'functional-code-executor', stub: true, fileCount: stubFiles.length }
    });
    return { type: 'code', artifactId: artifact.id, summary: artifact.content.summary, files: stubFiles, tests: [], notes: ['AI binding unavailable'], acceptance };
  }

  // Try AI generation with improved prompts
  const basePrompt = webTask ? WEB_TASK_PROMPT : BACKEND_PROMPT;
  const systemPrompt = basePrompt + '\n\nTask: ' + objective + '\nAcceptance criteria: ' + JSON.stringify(acceptance);

  let parsed = null, lastError = '';
  // Two attempts (not three): each attempt is a Workers AI request, and a hung or slow
  // generation must not outlive the invocation window — after the timeout we fall back
  // to templates so the task still completes instead of dying with an expired lease.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const prompt = attempt === 0 ? objective : objective + '\n\nIMPORTANT: Your previous response was invalid. Generate COMPLETE source code for all files. Each file must have full, working code. Output ONLY the JSON object.';
      parsed = parseModel(await withTimeout(code(runtimeEnv, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], { maxTokens: 3000 }), AI_ATTEMPT_TIMEOUT_MS));
      if (!parsed || invalid(filesOf(parsed.files), task)) { parsed = null; }
    } catch (e) { lastError = text(e); parsed = null; }
  }

  // If AI succeeded, use its output
  const files = ensurePackageJson(filesOf(parsed?.files), objective);
  if (!invalid(files, task)) {
    const tests = Array.isArray(parsed.tests) ? parsed.tests.map(text).filter(Boolean).slice(0, 20) : [];
    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(text).filter(Boolean).slice(0, 20) : [];
    const artifact = registerArtifact({
      projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
      content: { summary: text(parsed.summary || 'AI-generated implementation for ' + objective), files, tests, notes },
      metadata: { generatedBy: 'functional-code-executor', aiGenerated: true, fileCount: files.length, taskType: webTask ? 'web-ui' : 'backend' }
    });
    return { type: 'code', artifactId: artifact.id, summary: artifact.content.summary, files, tests, notes, acceptance };
  }

  // Fallback to templates
  const templateResult = generateFromTemplate({ objective, capabilities: task.requiredCapabilities || [] });
  if (templateResult.files?.length > 0) {
    const artifact = registerArtifact({
      projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
      content: { summary: templateResult.summary, files: templateResult.files, tests: templateResult.tests || [], notes: [...(templateResult.notes || []), 'Template fallback used'] },
      metadata: { generatedBy: 'app-templates', template: templateResult.projectType, fileCount: templateResult.files.length, aiFailed: true, aiError: lastError }
    });
    return { type: 'code', artifactId: artifact.id, summary: templateResult.summary, files: templateResult.files, tests: templateResult.tests || [], notes: templateResult.notes || [], acceptance };
  }

  throw new Error('Code generation failed: AI returned invalid code and no template matched.');
}

registerExecutor('internal.code', generateFunctionalArtifact, {
  description: 'Generates real functional source code using AI with template fallback',
  risk: 'low', scope: 'internal', capabilities: ['coding', 'software-development']
});
grantExecutor('internal.code', 'internal');
