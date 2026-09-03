import { code } from './ai.js';
import { registerArtifact } from './artifacts.js';
import { registerExecutor, grantExecutor } from './executor-registry.js';
import { generateFromTemplate } from './app-templates.js';

const WEB_REQUIRED = ['www/index.html', 'www/app.js', 'www/styles.css'];
const COMMON_REQUIRED = ['package.json', 'README.md'];

function text(v) { return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }
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

const WEB_TASK_PROMPT = `You are a senior web developer generating a COMPLETE, WORKING web application.

OUTPUT FORMAT: Return ONLY a valid JSON object with this exact structure:
{"summary":"brief description","files":[{"path":"www/index.html","content":"FULL HTML"},{"path":"www/app.js","content":"FULL JAVASCRIPT"},{"path":"www/styles.css","content":"FULL CSS"},{"path":"package.json","content":"{}"},{"path":"README.md","content":"# App"}],"tests":["test description"],"notes":["note"]}

CRITICAL RULES:
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
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    try {
      const prompt = attempt === 0 ? objective : attempt === 1
        ? objective + '\n\nIMPORTANT: Your previous response was invalid. Generate COMPLETE source code for all files. Each file must have full, working code. Output ONLY the JSON object.'
        : objective + '\n\nFINAL ATTEMPT: Generate COMPLETE working code. Include ALL files with FULL content. No placeholders. JSON object only.';
      parsed = parseModel(await code(runtimeEnv, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], { maxTokens: 8000 }));
      if (!parsed || invalid(filesOf(parsed.files), task)) { parsed = null; }
    } catch (e) { lastError = text(e); parsed = null; }
  }

  // If AI succeeded, use its output
  const files = filesOf(parsed?.files);
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
