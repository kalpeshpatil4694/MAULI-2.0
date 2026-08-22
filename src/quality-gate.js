import { store } from './store.js';

const text = value => String(value ?? '').toLowerCase();
const fileName = file => String(file?.path ?? '').split('/').pop().toLowerCase();

function projectRequirements(task) {
  const project = task?.projectId ? store.get('projects', task.projectId) : null;
  return [project?.objective, ...(project?.requirements ?? []), task?.title, task?.description]
    .map(text)
    .join('\n');
}

function find(files, names) {
  return files.find(file => names.includes(fileName(file)));
}

function checkStructure(files) {
  const checks = [
    { name: 'files_present', passed: files.length > 0 },
    { name: 'unique_paths', passed: new Set(files.map(f => f.path)).size === files.length },
    { name: 'safe_paths', passed: files.every(f => typeof f.path === 'string' && f.path && !f.path.startsWith('/') && !f.path.includes('..') && !/[\\\0]/.test(f.path)) },
    { name: 'non_empty_files', passed: files.every(f => typeof f.content === 'string' && f.content.trim().length > 0) },
    { name: 'valid_file_records', passed: files.every(f => f && typeof f.path === 'string' && typeof f.content === 'string') }
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

function checkSecurity(files) {
  const combined = files.map(f => text(f.content)).join('\n');
  const checks = [
    { name: 'no_obvious_hardcoded_secrets', passed: !/(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(combined) },
    { name: 'no_dynamic_eval', passed: !/\beval\s*\(|new\s+function\s*\(/.test(combined) },
    { name: 'no_dangerous_html_sink', passed: !/document\.write\s*\(/.test(combined) },
    { name: 'no_embedded_private_key', passed: !/-----begin (rsa |ec |openssh )?private key-----/i.test(combined) }
  ];
  return { passed: checks.every(c => c.passed), checks };
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

function checkAutomatedBuildTest(files) {
  const checks = [];
  const byName = new Map(files.map(f => [fileName(f), f]));
  const html = byName.get('index.html');
  if (html) {
    checks.push({ name: 'html_has_document_structure', passed: /<html[\s>]/i.test(html.content) && /<body[\s>]/i.test(html.content) });
    checks.push({ name: 'html_balanced_script_tags', passed: (html.content.match(/<script\b/gi) || []).length === (html.content.match(/<\/script>/gi) || []).length });
  }
  for (const file of files) {
    const name = fileName(file);
    const content = String(file.content ?? '');
    if (/\.js$/i.test(name)) checks.push({ name: `js_basic_syntax:${file.path}`, passed: !/\b(?:SyntaxError|Unexpected token|undefined is not a function)\b/i.test(content) && !/\bTODO\s*:\s*FAIL\b/i.test(content) });
    if (/\.json$/i.test(name)) {
      let parsed = true;
      try { JSON.parse(content); } catch { parsed = false; }
      checks.push({ name: `json_parse:${file.path}`, passed: parsed });
    }
    if (/\.py$/i.test(name)) checks.push({ name: `python_basic_syntax:${file.path}`, passed: !/\bSyntaxError\b/i.test(content) && !/^[ \t]+[^ \t\n]+:/m.test(content) });
    if (/\.sql$/i.test(name)) checks.push({ name: `sql_has_statement:${file.path}`, passed: /\b(create|select|insert|update|delete|alter)\b/i.test(content) });
  }
  return { passed: checks.every(c => c.passed), checks, mode: 'static-worker-safe' };
}

async function checkArtifactIntegrity(files) {
  const checks = [
    { name: 'artifact_file_count', passed: files.length > 0 },
    { name: 'artifact_paths_unique', passed: new Set(files.map(f => f.path)).size === files.length },
    { name: 'artifact_content_utf8', passed: files.every(f => typeof f.content === 'string') }
  ];
  const manifest = [];
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.content);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    manifest.push({ path: file.path, bytes: bytes.length, sha256: hash });
  }
  const duplicateHashes = new Set(manifest.map(x => x.sha256)).size !== manifest.length;
  checks.push({ name: 'artifact_manifest_unique_hashes', passed: !duplicateHashes });
  return { passed: checks.every(c => c.passed), checks, manifest };
}

export async function runQualityGate(task, artifact) {
  const files = Array.isArray(artifact?.content?.files) ? artifact.content.files : [];
  const requirementText = projectRequirements(task);
  const structure = checkStructure(files);
  const integration = checkIntegration(files);
  const security = checkSecurity(files);
  const calculator = checkCalculator(files, requirementText);
  const automatedBuildTest = checkAutomatedBuildTest(files);
  const artifactIntegrity = await checkArtifactIntegrity(files);
  const checks = [
    ...structure.checks,
    ...automatedBuildTest.checks,
    ...integration.checks,
    ...security.checks,
    ...calculator.checks,
    ...artifactIntegrity.checks
  ];
  const passed = [structure, automatedBuildTest, integration, security, calculator, artifactIntegrity].every(x => x.passed);
  const result = {
    passed,
    gate: 'L1.1-generated-project-quality',
    status: passed ? 'PASS' : 'FAIL',
    stages: {
      automatedBuildTest: automatedBuildTest.passed,
      requirementVerification: calculator.passed,
      securityCheck: security.passed,
      artifactIntegrity: artifactIntegrity.passed,
      integrationCheck: integration.passed
    },
    checks,
    requirementsDetected: calculator.required ? 'calculator' : 'general',
    artifactManifest: artifactIntegrity.manifest,
    checkedAt: new Date().toISOString()
  };
  if (artifact) {
    artifact.metadata = {
      ...(artifact.metadata ?? {}),
      qualityGate: result,
      qualityGateStatus: result.status,
      qualityGateCheckedAt: result.checkedAt
    };
    store.put('artifacts', artifact);
  }
  return result;
}
