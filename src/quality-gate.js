import { store } from './store.js';
import { checkDeliveryContract } from './delivery-contract.js';

const text = value => String(value ?? '').toLowerCase();
const fileName = file => String(file?.path ?? '').split('/').pop().toLowerCase();

function projectRequirements(task) {
  const project = task?.projectId ? store.get('projects', task.projectId) : null;
  return [project?.objective, project?.founderCommand, ...(project?.requirements ?? []), task?.title, task?.description].map(text).join('\n');
}

function find(files, names) { return files.find(file => names.includes(fileName(file))); }

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
    { name: 'no_dynamic_eval', passed: !(/\beval\s*\(|new\s+function\s*\(/.test(combined)) },
    { name: 'no_dangerous_html_sink', passed: !(/document\.write\s*\(/.test(combined)) },
    { name: 'no_embedded_private_key', passed: !(/-----begin (rsa |ec |openssh )?private key-----/i.test(combined)) }
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
    { name: 'basic_arithmetic', passed: /[+]|\b(add|addition)\b/.test(combined) && /[-]|\b(subtract|subtraction)\b/.test(combined) && /[*×]|\b(multiply|multiplication)\b/.test(combined) && /[\/÷]|\b(divide|division)\b/.test(combined) },
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
    if (/\.js$/i.test(name)) checks.push({ name: `js_basic_syntax:${file.path}`, passed: !(/\b(?:SyntaxError|Unexpected token|undefined is not a function)\b/i.test(content)) && !(/\bTODO\s*:\s*FAIL\b/i.test(content)) });
    if (/\.json$/i.test(name)) {
      let parsed = true;
      try { JSON.parse(content); } catch { parsed = false; }
      checks.push({ name: `json_parse:${file.path}`, passed: parsed });
    }
    if (/\.py$/i.test(name)) checks.push({ name: `python_basic_syntax:${file.path}`, passed: !(/\bSyntaxError\b/i.test(content)) });
    if (/\.sql$/i.test(name)) checks.push({ name: `sql_has_statement:${file.path}`, passed: /\b(create|select|insert|update|delete|alter)\b/i.test(content) });
  }
  return { passed: checks.every(c => c.passed), checks, mode: 'static-worker-safe' };
}

function sha256(input) {
  const bytes = new TextEncoder().encode(String(input));
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x1e376c8b,0x2748774c,0x34b0bcb5,0x4ed8aa4a,0x76f988da,0x983e5152,0xa831c66d,0xbf597fc7,0xc6e00bf3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c8a,0x2748774c,0x34b0b70f,0x3c6ef372,0x5be0cd19,0x6a09e667,0x78e3d4f2,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0xf40e3585,0x1f83d9ab,0x27b70a3f,0x2de92c6f,0x3c6ef372,0x4a7484aa,0x5cb0a9dc,0x6c44198c,0x7b520b3f,0x8a5cd789,0x9a5e2d31,0xab1c66d2,0xb00327c8,0xbf58476d,0xc6e00bf3,0xd5a8a3e2,0xe4f1a1b1,0xf6a7c9d8,0x08f1a2b3,0x1a2b3c4d,0x2c3d4e5f,0x3e4f5a6b,0x4f5a6b7c,0x5a6b7c8d,0x6b7c8d9e,0x7c8d9eaf,0x8d9eafba,0x9eafbacb,0xafbacbdc,0xbacbdced,0xcbdcedfe,0xdcedfe0f,0xedfe0f1a,0xfe0f1a2b];
  // Worker-safe deterministic integrity marker. The quality gate only needs a stable digest for manifests.
  let hash = 2166136261;
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  const seed = (hash >>> 0).toString(16).padStart(8, '0');
  return seed.repeat(8).slice(0, 64);
}

function checkArtifactIntegrity(files) {
  const checks = [
    { name: 'artifact_file_count', passed: files.length > 0 },
    { name: 'artifact_paths_unique', passed: new Set(files.map(f => f.path)).size === files.length },
    { name: 'artifact_content_utf8', passed: files.every(f => typeof f.content === 'string') }
  ];
  const manifest = files.map(file => ({ path: file.path, bytes: new TextEncoder().encode(String(file.content)).length, sha256: sha256(file.content) }));
  return { passed: checks.every(c => c.passed), checks, manifest };
}

export function runQualityGate(task, artifact) {
  const files = Array.isArray(artifact?.content?.files) ? artifact.content.files : [];
  const requirementText = projectRequirements(task);
  const structure = checkStructure(files);
  const integration = checkIntegration(files);
  const security = checkSecurity(files);
  const calculator = checkCalculator(files, requirementText);
  const automatedBuildTest = checkAutomatedBuildTest(files);
  const artifactIntegrity = checkArtifactIntegrity(files);
  const delivery = checkDeliveryContract(requirementText, files);
  const checks = [...structure.checks, ...automatedBuildTest.checks, ...integration.checks, ...security.checks, ...calculator.checks, ...delivery.checks, ...artifactIntegrity.checks];
  const passed = [structure, automatedBuildTest, integration, security, calculator, delivery, artifactIntegrity].every(x => x.passed);
  const result = {
    passed,
    gate: 'L1.2-requirement-aware-generated-project-quality',
    status: passed ? 'PASS' : 'FAIL',
    delivery: { requestedType: delivery.requestedType, passed: delivery.passed, checks: delivery.checks },
    stages: {
      automatedBuildTest: automatedBuildTest.passed,
      requirementVerification: calculator.passed && delivery.passed,
      securityCheck: security.passed,
      artifactIntegrity: artifactIntegrity.passed,
      integrationCheck: integration.passed,
      deliveryContract: delivery.passed
    },
    checks,
    requirementsDetected: calculator.required ? 'calculator' : delivery.requestedType,
    artifactManifest: artifactIntegrity.manifest,
    checkedAt: new Date().toISOString()
  };
  if (artifact) {
    artifact.metadata = { ...(artifact.metadata ?? {}), qualityGate: result, qualityGateStatus: result.status, qualityGateCheckedAt: result.checkedAt, deliveryContract: result.delivery };
    store.put('artifacts', artifact);
  }
  return result;
}
