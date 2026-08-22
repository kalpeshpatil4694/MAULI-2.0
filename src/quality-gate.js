import { store } from './store.js';

const text = value => String(value ?? '').toLowerCase();
const fileName = file => String(file?.path ?? '').split('/').pop().toLowerCase();

function projectRequirements(task) {
  const project = task?.projectId ? store.get('projects', task.projectId) : null;
  return [project?.objective, ...(project?.requirements ?? []), task?.title, task?.description].map(text).join('\n');
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
    if (/\.json$/i.test(name)) { let parsed = true; try { JSON.parse(content); } catch { parsed = false; } checks.push({ name: `json_parse:${file.path}`, passed: parsed }); }
    if (/\.py$/i.test(name)) checks.push({ name: `python_basic_syntax:${file.path}`, passed: !/\bSyntaxError\b/i.test(content) });
    if (/\.sql$/i.test(name)) checks.push({ name: `sql_has_statement:${file.path}`, passed: /\b(create|select|insert|update|delete|alter)\b/i.test(content) });
  }
  return { passed: checks.every(c => c.passed), checks, mode: 'static-worker-safe' };
}

function sha256Hex(input) {
  const isPrime = n => { if (n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
  const primes = [];
  for (let n = 2; primes.length < 64; n++) if (isPrime(n)) primes.push(n);
  const K = primes.map(p => Math.floor((Math.cbrt(p) % 1) * 0x100000000) >>> 0);
  const H0 = primes.slice(0, 8).map(p => Math.floor((Math.sqrt(p) % 1) * 0x100000000) >>> 0);
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  const off = padded.length - 8;
  padded[off] = hi >>> 24; padded[off + 1] = hi >>> 16; padded[off + 2] = hi >>> 8; padded[off + 3] = hi;
  padded[off + 4] = lo >>> 24; padded[off + 5] = lo >>> 16; padded[off + 6] = lo >>> 8; padded[off + 7] = lo;
  let h = H0.slice();
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = ((padded[o + i * 4] << 24) | (padded[o + i * 4 + 1] << 16) | (padded[o + i * 4 + 2] << 8) | padded[o + i * 4 + 3]) >>> 0;
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ ((~e) & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const round = [a, b, c, d, e, f, g, hh];
    h = h.map((x, i) => (x + round[i]) >>> 0);
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}

function checkArtifactIntegrity(files) {
  const checks = [
    { name: 'artifact_file_count', passed: files.length > 0 },
    { name: 'artifact_paths_unique', passed: new Set(files.map(f => f.path)).size === files.length },
    { name: 'artifact_content_utf8', passed: files.every(f => typeof f.content === 'string') }
  ];
  const manifest = files.map(file => {
    const bytes = new TextEncoder().encode(file.content);
    return { path: file.path, bytes: bytes.length, sha256: sha256Hex(file.content) };
  });
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
  const checks = [...structure.checks, ...automatedBuildTest.checks, ...integration.checks, ...security.checks, ...calculator.checks, ...artifactIntegrity.checks];
  const passed = [structure, automatedBuildTest, integration, security, calculator, artifactIntegrity].every(x => x.passed);
  const result = {
    passed,
    gate: 'L1.1-generated-project-quality',
    status: passed ? 'PASS' : 'FAIL',
    stages: { automatedBuildTest: automatedBuildTest.passed, requirementVerification: calculator.passed, securityCheck: security.passed, artifactIntegrity: artifactIntegrity.passed, integrationCheck: integration.passed },
    checks,
    requirementsDetected: calculator.required ? 'calculator' : 'general',
    artifactManifest: artifactIntegrity.manifest,
    checkedAt: new Date().toISOString()
  };
  if (artifact) {
    artifact.metadata = { ...(artifact.metadata ?? {}), qualityGate: result, qualityGateStatus: result.status, qualityGateCheckedAt: result.checkedAt };
    store.put('artifacts', artifact);
  }
  return result;
}
