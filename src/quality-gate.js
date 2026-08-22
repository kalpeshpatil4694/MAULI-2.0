import { store } from './store.js';

const text = value => String(value ?? '').toLowerCase();

function projectRequirements(task) {
  const project = task?.projectId ? store.get('projects', task.projectId) : null;
  return [project?.objective, ...(project?.requirements ?? []), task?.title, task?.description].map(text).join('\n');
}

function find(files, names) {
  return files.find(file => names.includes(String(file?.path ?? '').toLowerCase()));
}

function checkCalculator(files, requirementText) {
  const needsCalculator = /calculator|basic arithmetic|calculation history|clear history|addition|subtraction|multiplication|division/.test(requirementText);
  if (!needsCalculator) return { required: false, passed: true, checks: [] };
  const html = find(files, ['index.html']);
  const js = find(files, ['script.js', 'app.js', 'main.js']);
  const css = find(files, ['style.css', 'styles.css']);
  const combined = files.map(f => text(f.content)).join('\n');
  const checks = [
    { name: 'calculator_html_present', passed: Boolean(html) },
    { name: 'calculator_javascript_present', passed: Boolean(js) },
    { name: 'basic_arithmetic', passed: /[+]|\b(add|addition)\b/.test(combined) && /[-]|\b(subtract|subtraction)\b/.test(combined) && /[*×]|\b(multiply|multiplication)\b/.test(combined) && /[/÷]|\b(divide|division)\b/.test(combined) },
    { name: 'calculation_history', passed: /history|calculation(s)?/.test(combined) },
    { name: 'clear_history', passed: /clear\s*(history|all)|history.*clear|clear.*history/.test(combined) },
    { name: 'html_js_integration', passed: Boolean(html && js && /<script[^>]+src=["'][^"']*(script|app|main)\.js/i.test(html.content)) },
    { name: 'html_css_integration', passed: !css || Boolean(html && /<link[^>]+href=["'][^"']*(style|styles)\.css/i.test(html.content)) }
  ];
  return { required: true, passed: checks.every(c => c.passed), checks };
}

function checkStructure(files) {
  const checks = [
    { name: 'files_present', passed: files.length > 0 },
    { name: 'unique_paths', passed: new Set(files.map(f => f.path)).size === files.length },
    { name: 'safe_paths', passed: files.every(f => typeof f.path === 'string' && f.path && !f.path.startsWith('/') && !f.path.includes('..') && !/[\\\0]/.test(f.path)) },
    { name: 'non_empty_files', passed: files.every(f => typeof f.content === 'string' && f.content.trim().length > 0) }
  ];
  return { passed: checks.every(c => c.passed), checks };
}

function checkSecurity(files) {
  const combined = files.map(f => text(f.content)).join('\n');
  const checks = [
    { name: 'no_obvious_hardcoded_secrets', passed: !/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(combined) },
    { name: 'no_dynamic_eval', passed: !/\beval\s*\(|new\s+function\s*\(/.test(combined) },
    { name: 'no_dangerous_html_sink', passed: !/document\.write\s*\(/.test(combined) }
  ];
  return { passed: checks.every(c => c.passed), checks };
}

function checkIntegration(files) {
  const html = find(files, ['index.html']);
  if (!html) return { passed: true, checks: [] };
  const checks = [];
  const scriptRefs = [...String(html.content).matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
  const cssRefs = [...String(html.content).matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);
  for (const ref of scriptRefs) checks.push({ name: `script_reference:${ref}`, passed: files.some(f => f.path === ref || f.path.endsWith(`/${ref}`)) });
  for (const ref of cssRefs) checks.push({ name: `style_reference:${ref}`, passed: files.some(f => f.path === ref || f.path.endsWith(`/${ref}`)) });
  return { passed: checks.every(c => c.passed), checks };
}

export async function runQualityGate(task, artifact) {
  const files = Array.isArray(artifact?.content?.files) ? artifact.content.files : [];
  const requirementText = projectRequirements(task);
  const structure = checkStructure(files);
  const security = checkSecurity(files);
  const integration = checkIntegration(files);
  const calculator = checkCalculator(files, requirementText);
  const checks = [...structure.checks, ...integration.checks, ...security.checks, ...calculator.checks];
  const passed = [structure, integration, security, calculator].every(x => x.passed);
  const result = {
    passed,
    gate: 'L1.1-generated-project-quality',
    status: passed ? 'PASS' : 'FAIL',
    checks,
    requirementsDetected: calculator.required ? 'calculator' : 'general',
    checkedAt: new Date().toISOString()
  };
  return result;
}
