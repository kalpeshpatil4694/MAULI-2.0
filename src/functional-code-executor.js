import { code } from './ai.js';
import { registerArtifact } from './artifacts.js';
import { registerExecutor, grantExecutor } from './executor-registry.js';
import { generateFromTemplate } from './app-templates.js';
import { analyzeGeneratedApp } from './generated-app-quality.js';
import { generateFullStackApp } from './fullstack-codegen.js';
import { store } from './store.js';
import { hasBackendEntryPoint } from './production-runtime.js';

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

// The bounded repair loop: Detect → Diagnose → Fix → Rebuild → Retest.
// "Detect" is the static fidelity gate run on the model's own output. "Diagnose" turns
// the violation codes into a repair instruction. "Fix/Rebuild" is one more AI attempt
// whose prompt carries the diagnosis. "Retest" re-runs the same gate. Bounded to one
// repair per generation attempt, so a persistently bad model cannot spin forever — the
// bounded attempts + template fallback below remain the outer safety net.
const MAX_REPAIR_ATTEMPTS = 1;

function repairInstruction(violationCodes) {
  const lines = {
    'no-persistence': 'The app never stores data. In the handler that adds or changes data, call localStorage.setItem with the full updated state, and load it back with localStorage.getItem on startup so it survives a refresh.',
    'no-requirement-evidence': 'None of the founder\'s requirements are visible in the code. Implement every listed requirement for real — no prose, working features only.',
    'unbound-handler': 'The HTML references handler functions that are never defined. Define every onclick/onchange handler the markup calls, with working bodies.',
    'noop-handler': 'Some handlers do nothing (log/alert only). Give every handler a real body that updates state, the DOM, or storage.',
    'no-interaction': 'The page has no working controls. Add bound, functioning controls for the app\'s core feature.',
    'mocked-api': 'An API is faked with a literal resolved response. Call the real backend, or persist locally with localStorage — never fake success.',
    'demo-marker': 'Remove demo wording — this must be a working product.',
    'coming-soon': 'Remove "coming soon" wording — this must be a working product.',
    'todo-marker': 'Remove TODO/FIXME markers and implement the feature.',
    'placeholder': 'Remove placeholder implementations and write the real logic.',
    'not-implemented': 'Implement the feature the "not implemented" marker stands in for.',
    'lorem-ipsum': 'Replace lorem ipsum with the real UI and data.',
    'ai-unavailable-stub': 'Remove the stub page and generate the real app.',
    'mock-disclaimer': 'Remove the mock/simulation disclaimer and implement the real behavior.',
    'fake-async': 'Timers are used as a substitute for real state changes. Make every timer-driven update change real state.',
    'realtime-not-implemented': 'Real-time was requested. Implement it for real (WebSocket, SSE, or a bounded polling loop against a real endpoint).',
    'broken-navigation': 'The app links to pages/assets it does not contain, so clicks open nothing. Either emit every linked .html file under www/ or remove the link — every href/src must resolve to a file that is in your output.'
  };
  return violationCodes
    .map((code) => lines[code] ?? ('Fix the '+code+' problem.'))
    .map((s) => '- '+s)
    .join('\n');
}

/**
 * Run the model once, parse, validate structurally, then run the fidelity gate on the
 * result; on gate failure spend at most MAX_REPAIR_ATTEMPTS extra model calls whose
 * prompt names exactly what the gate found. Returns the best valid files or null.
 */
async function generateWithRepair({ runtimeEnv, systemPrompt, objective, acceptance, task, attempts = MAX_REPAIR_ATTEMPTS + 1 }) {
  let lastError = '';
  let bestValid = null, bestQuality = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const gate = attempt > 0;
    const prompt = gate
      ? objective + '\n\nYour previous code failed the functional review: it looked like an app but parts did not actually work. Fix EXACTLY these problems and return the COMPLETE fixed app as JSON:\n' + repairInstruction(lastError.split(',').map(s => s.trim()).filter(Boolean))
      : objective;
    try {
      const raw = await withTimeout(code(runtimeEnv, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], { maxTokens: 3000 }), AI_ATTEMPT_TIMEOUT_MS);
      const parsed = parseModel(raw);
      const files = ensurePackageJson(filesOf(parsed?.files), objective);
      if (!parsed || invalid(files, task)) { lastError = 'invalid output (missing required files or too little code)'; continue; }
      // Detect + Retest: the same static gate the QA pipeline enforces, run eagerly so
      // the fix happens inside this task instead of failing six gates later.
      const quality = analyzeGeneratedApp(files, { objective, requirements: task?.requirements ?? [] });
      if (!quality.passed) {
        // Keep the best structurally-valid output; if even the repair cannot pass the
        // gate it is still registered with its violations recorded and the QA gate
        // remains the hard bar that blocks delivery.
        if (!bestValid) { bestValid = files; bestQuality = quality; }
        lastError = quality.violations.map(v => v.code).join(',');
        continue;
      }
      return { files, parsed, quality };
    } catch (e) { lastError = text(e); }
  }
  return bestValid
    ? { files: bestValid, parsed: null, quality: bestQuality }
    : { files: null, parsed: null, quality: null, error: lastError };
}

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
7. Make it visually polished with good colors, spacing, and typography. A working app that LOOKS like a demo is not finished: ship real product presentation, not a bare wireframe.
7a. DESIGN THE UI LIKE A PRODUCT, NOT A DEMO: a sticky sidebar or top bar with the product name and ICON navigation (inline SVG icons, never an icon font or CDN), a gradient hero/header, card-based sections with rounded corners and soft shadows, colour-coded stat/KPI cards, an illustrated EMPTY STATE (inline SVG), hover states on every interactive row, and real spacing hierarchy.
7b. GRAPHICS MUST BE INLINE AND DATA-DRIVEN: all artwork as inline <svg> or CSS (gradients, shapes). NEVER <img src="..."> to a file you did not emit, and never reference an external image/font/chart CDN — an asset that does not load is the "graphics missing" defect. Any chart must be computed from the app's own data (bars sized by the stored values), never a hard-coded picture.
7c. Derive the accent colour from the product (CSS variables, one hue + one gradient partner). Two products must not ship the identical purple.
8. Include ALL features mentioned in the task description. Every screen must be RESPONSIVE (media queries for phone/tablet), and long lists need an empty state, not a blank gap.
9. Persist data with localStorage so it survives refresh — a tracker/list/history/note app MUST call localStorage.setItem (or fetch to a real API) from the handler that adds/changes data, and MUST reload persisted data on startup
10. NO placeholders, NO "TODO", NO incomplete code
11. MULTI-SCREEN APPS SHIP REAL PAGES: if the product has more than one screen (dashboard, list/queue, reports, settings, auth), emit ONE .html file per screen under www/ — for example www/index.html, www/reports.html, www/settings.html — and connect them with a shared top navigation of plain links: <a href="reports.html">Reports</a>. Every href and src in your HTML MUST point to a file that EXISTS in your files array; never link to a page you did not emit (a link that opens nothing is a broken product). Single-screen tools (a calculator, a timer, a converter) stay one page.

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
        // Structural validity is not functionality: report the fidelity gate's verdict too,
        // so the probe route cannot suggest an app is deliverable when it is a demo.
        const quality = analyzeGeneratedApp(files, { objective });
        return {
          available: true, generated: true, attempt: attempt + 1,
          fidelity: { passed: quality.passed, score: quality.score, violations: quality.violations.map(v => v.code) },
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

/**
 * The architecture the project's extracted specification selected, when one is available.
 * A project with no spec is a legacy project: the generation path behaves exactly as it did
 * before requirement extraction existed.
 */
function architectureFor(task) {
  const project = task?.projectId ? store.get('projects', task.projectId) : null;
  const architecture = project?.architecture ?? null;
  const spec = project?.requirementSpec ?? null;
  if (!architecture || !spec) return { architecture: null, spec: null, project: null };
  return { architecture, spec, project };
}

// The detector lives in src/production-runtime.js so the gate, the delivery and the
// acceptance executor cannot disagree about what a backend is. Re-exported here because this
// module is where it used to live.
export { hasBackendEntryPoint } from './production-runtime.js';

/**
 * Generate the product the specification asks for, when it owes a backend.
 *
 * A template cannot produce this: every template is a browser page, and a founder who asked
 * for accounts, shared records or live updates cannot be given one. This compiles the
 * architecture instead, and it is the honest answer to "MAULI could not write that with a
 * model today" — a real Worker over real D1 rather than a static imitation of one.
 */
function generateFromArchitecture({ task, agentId, objective, acceptance }) {
  const { architecture, spec } = architectureFor(task);
  if (!architecture || !spec || architecture.backend !== true) return null;
  if (spec.understanding === 'BLOCKED') return null;
  let built;
  try { built = generateFullStackApp(spec, architecture, { objective }); }
  catch (error) { return { error: `Full-stack generation failed: ${text(error)}` }; }
  const quality = analyzeGeneratedApp(built.files, { objective, requirements: spec.requirements.map(r => r.title) });
  const artifact = registerArtifact({
    projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
    content: { summary: built.summary, files: built.files, tests: built.tests || [], notes: built.notes || [] },
    metadata: {
      generatedBy: 'fullstack-codegen', architecture: architecture.id, architectureLabel: architecture.label,
      apiBase: `/api/${built.table}s`, table: built.table,
      specVersion: spec.specVersion, requirements: spec.requirements.map(r => ({ id: r.id, title: r.title, critical: r.critical })),
      fileCount: built.files.length, fidelity: { passed: quality.passed, score: quality.score, violations: quality.violations.map(v => v.code) }
    }
  });
  return {
    type: 'code', artifactId: artifact.id, summary: built.summary, files: built.files,
    tests: built.tests || [], notes: built.notes || [], acceptance
  };
}

async function generateFunctionalArtifact({ task, env, agentId }) {
  const runtimeEnv = resolveRuntimeEnv(env);
  const objective = text(task.description || task.title || 'Build a software application');
  const acceptance = Array.isArray(task.acceptance) ? task.acceptance : [];
  const webTask = isWebTask(task);

  // If no AI binding, use templates directly
  if (!runtimeEnv?.AI?.run) {
    const architectural = generateFromArchitecture({ task, agentId, objective, acceptance });
    if (architectural?.error) throw new Error(architectural.error);
    if (architectural?.artifactId) return architectural;
    const templateResult = generateFromTemplate({ objective, capabilities: task.requiredCapabilities || [] });
    if (templateResult.files?.length > 0) {
      // A template emits a single index.html. Shipped like that, the project has no
      // package.json, so the build flow (which requires www/index.html + package.json)
      // cannot turn it into an APK and the founder gets a download that does nothing.
      // The fallback must be as deliverable as the real thing.
      templateResult.files = ensurePackageJson(templateResult.files, objective);
      const artifact = registerArtifact({
        projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
        content: { summary: templateResult.summary, files: templateResult.files, tests: templateResult.tests || [], notes: templateResult.notes || [] },
        metadata: { generatedBy: 'app-templates', template: templateResult.projectType, fileCount: templateResult.files.length, templateMatched: templateResult.templateMatched === true }
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

  let lastError = '';
  // Bounded generation + repair: up to MAX_REPAIR_ATTEMPTS+1 model calls. A failed repair
  // prompt names exactly what the fidelity gate found (Detect → Diagnose → Fix → Retest).
  // After the loop we fall back to templates so the task still completes inside its lease
  // instead of dying when the invocation window expires.
  let { files, parsed, quality, error } = await generateWithRepair({ runtimeEnv, systemPrompt, objective, acceptance, task });
  lastError = error ?? '';

  // If AI produced code that ALSO passed the fidelity gate, ship it. When even the repair
  // could not pass, the AI output is a demo by the founder's own definition — it must not
  // be registered as the requested product. Fall through to the deterministic template,
  // which is itself fidelity-gated, and record why the AI output was refused.
  if (files && quality && !quality.passed) {
    lastError = 'functional fidelity failed: ' + quality.violations.map(v => v.code).join(', ');
  }
  if (files && (!quality || quality.passed)) {
    // A model that returns a working PAGE for a product that owes a SERVER has returned a
    // different product. This happened live: the Workers AI allowance reset mid-test, the
    // model wrote a laundry counter in localStorage, scored 92 on the static gate (the
    // real-time violation is only a warning) and would have been merged over the correct
    // full-stack build. A static page is not an acceptable answer to a specification that
    // selected a Worker API.
    const architectureRequired = architectureFor(task).architecture?.backend === true;
    if (architectureRequired && !hasBackendEntryPoint(files)) {
      lastError = 'model returned a browser-only page for a product that requires a backend API';
      files = null;
    }
  }
  if (files && (!quality || quality.passed)) {
    const tests = Array.isArray(parsed?.tests) ? parsed.tests.map(text).filter(Boolean).slice(0, 20) : [];
    const notes = Array.isArray(parsed?.notes) ? parsed.notes.map(text).filter(Boolean).slice(0, 20) : [];
    const artifact = registerArtifact({
      projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
      content: { summary: text(parsed?.summary || 'AI-generated implementation for ' + objective), files, tests, notes },
      metadata: {
        generatedBy: 'functional-code-executor', aiGenerated: true, fileCount: files.length, taskType: webTask ? 'web-ui' : 'backend',
        fidelity: quality ? { passed: quality.passed, score: quality.score, violations: quality.violations.map(v => v.code) } : null
      }
    });
    return { type: 'code', artifactId: artifact.id, summary: artifact.content.summary, files, tests, notes, acceptance };
  }

  // Fallback: the architecture the founder's own specification selected. A model that could
  // not produce the requested product does not license a different one.
  const architectural = generateFromArchitecture({ task, agentId, objective, acceptance });
  if (architectural?.error) throw new Error(architectural.error);
  if (architectural?.artifactId) {
    return { ...architectural, notes: [...(architectural.notes ?? []), `Model output refused (${lastError || 'unusable'}); built from the founder's specification instead`] };
  }
  const templateResult = generateFromTemplate({ objective, capabilities: task.requiredCapabilities || [] });
  if (templateResult.files?.length > 0) {
    // Same requirement as the branch above: a fallback project still has to be installable.
    templateResult.files = ensurePackageJson(templateResult.files, objective);
    const artifact = registerArtifact({
      projectId: task.projectId, taskId: task.id, agentId, type: 'code-workspace',
      content: { summary: templateResult.summary, files: templateResult.files, tests: templateResult.tests || [], notes: [...(templateResult.notes || []), 'Template fallback used'] },
      metadata: { generatedBy: 'app-templates', template: templateResult.projectType, fileCount: templateResult.files.length, aiFailed: true, aiError: lastError, templateMatched: templateResult.templateMatched === true }
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
