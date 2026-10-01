// MAULI 2.0 — Generated-application functional fidelity.
//
// The failure this exists to prevent: a generated project LOOKS like an app (files,
// styled UI, buttons) but nothing actually works — empty handlers, buttons wired to
// nothing, placeholder text, a hardcoded array pretending to be a database, a fake
// `fetch` that resolves a literal, `setTimeout`-based "processing", or a real-time
// feature that is only a UI animation.
//
// File count, ZIP size and "HTTP 200" are not evidence of functionality. This module
// reads the generated source and answers one question: does the code contain a real,
// wired-up, stateful feature — or a demo? It is deliberately static because the Worker
// cannot execute untrusted code (the free tier's CPU budget and the sandbox boundary),
// so it catches the unambiguous "this is a demo" signals and lets the Node runtime
// verifier (scripts/verify-generated-app.mjs) prove the rest by actually running the app.
//
// Requirement coverage is evaluated against EXECUTED source only (HTML + JS + CSS).
// A README that repeats the founder's own words would otherwise make every requirement
// look "implemented" — documentation is evidence of intent, not of a working feature.

const SEVERITY = { CRITICAL: 'critical', WARNING: 'warning' };

// Wording that is never acceptable in a delivered production app. Kept as separate
// patterns so a violation can name what matched.
const PLACEHOLDER_PATTERNS = [
  // Case matters, and getting it wrong made an entire app category undeliverable. "todo" is
  // a product noun, not only a placeholder: a todo app's domain text, its README title, its
  // API error strings and its own variable names are full of it. Matching case-insensitively
  // meant a perfectly working task tracker was rejected for using its own name — the runtime
  // verifier passed it and the static gate threw it away. The unfinished-work convention is
  // upper case, so only upper case is treated as a marker.
  { re: /\bTODO\b|\bFIXME\b/, code: 'todo-marker' },
  // A lower-case marker is still caught when it is written the way markers are actually
  // written — `// todo: finish the parser`. A domain noun is never followed by a colon, so
  // this does not re-admit the app that the case-insensitive rule used to reject.
  { re: /\b(?:todo|fixme)\s*:/i, code: 'todo-marker' },
  { re: /coming soon/i, code: 'coming-soon' },
  { re: /\bplaceholder\b/i, code: 'placeholder' },
  { re: /ai generation unavailable/i, code: 'ai-unavailable-stub' },
  { re: /\bdemo\b/i, code: 'demo-marker' },
  { re: /lorem ipsum/i, code: 'lorem-ipsum' },
  { re: /not implemented|unimplemented/i, code: 'not-implemented' },
  { re: /this is a (mock|simulation)/i, code: 'mock-disclaimer' }
];

// Persistence must be EVIDENCE OF A CALL, not the word. The bare \bdatabase\b token let a
// marketing one-pager pass the gate with a perfect score: its About section says
// "database", so a page that stores nothing at all was delivered as a working app. Every
// alternative below requires an actual call.
const PERSISTENCE_RE = /\blocalStorage\s*\.\s*(?:get|set|remove)Item\s*\(|\bsessionStorage\s*\.\s*(?:get|set|remove)Item\s*\(|\bindexedDB\b|\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket|\.\s*prepare\s*\(|new\s+(?:SQLite|sqlite3|pg|Client|Redis)\b|\bdb\s*\.\s*(?:run|exec|query|get|all)\s*\(|\.(?:run|exec|query)\s*\(\s*['"`]?\s*(?:insert|select|update|delete)\b/i;
const API_RE = /\bfetch\s*\(|\bXMLHttpRequest\b|WebSocket|EventSource/i;
const REALTIME_RE = /WebSocket|EventSource|Server-Sent|\bnew\s+WebSocket|\.onmessage|socket\.(on|emit)/i;
// A requirement whose wording implies stored/stateful data needs a persistence call.
const DATA_INTENT_RE = /track|save|store|persist|record|log|todo|note|expense|budget|task|list|database|history|account|user|login|register|inventory|cart|order|bookmark/i;

function isWeb(files) {
  return files.some((f) => /(^|\/)index\.html$/i.test(f.path));
}

function htmlOf(files) {
  return files.filter((f) => /\.html?$/i.test(f.path)).map((f) => String(f.content ?? '')).join('\n');
}

// Every piece of executed JavaScript: standalone .js files plus inline <script> bodies.
function scriptOf(files) {
  let out = '';
  for (const f of files) {
    if (/\.(m?js)$/i.test(f.path)) out += '\n' + String(f.content ?? '');
    for (const m of String(f.content ?? '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) out += '\n' + m[1];
  }
  return out;
}

function stripComments(code) {
  return String(code).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// Bodies of `function name(...){...}` and `name = (...) => {...}` / `= () => expr`.
function handlerBodies(js) {
  const bodies = [];
  const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = fnRe.exec(js))) bodies.push({ name: m[1], body: m[2] });
  const arrowRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{([\s\S]*?)\}/g;
  while ((m = arrowRe.exec(js))) bodies.push({ name: m[1], body: m[2] });
  return bodies;
}

function definedNames(js) {
  const names = new Set();
  for (const m of js.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g)) names.add(m[1]);
  return names;
}

// Control-flow keywords appear inside inline handlers (`onkeydown="if(x)go()"`), so a
// naive call scan reports `if` as an unbound handler. Only real identifiers count.
export const JS_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'function', 'new', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'try', 'catch', 'throw', 'await', 'async', 'yield', 'this', 'super', 'class', 'const', 'let', 'var']);

// `onclick="doThing()"` / `onclick='doThing(...)'` — the classic dead button.
function inlineHandlerRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*["']([^"']*)["']/gi)) {
    for (const call of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!JS_KEYWORDS.has(call[1])) refs.add(call[1]);
    }
  }
  return refs;
}

// A handler is a no-op when, after removing comments and string-only side effects, it
// does nothing observable. `console.log`/`alert` are treated as non-implementations: a
// log line is not a feature.
function isNoopBody(body) {
  const clean = stripComments(body)
    .replace(/\bconsole\.(log|info|warn|debug)\s*\([^)]*\)\s*;?/gi, '')
    .replace(/\balert\s*\([^)]*\)\s*;?/gi, '')
    .trim();
  return clean.length === 0;
}

// Requirements are matched against the code by significant keyword. Missing every
// keyword for a requirement means nothing in the generated source even mentions it.
function significantWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !['with', 'that', 'from', 'this', 'will', 'must', 'should', 'make', 'build', 'create', 'using', 'able', 'user'].includes(w));
}

// A requirement and a working app often use different words for the same thing
// ("to-do list" vs a page titled "Task Manager"). Expanding the requirement keeps the
// evidence honest without pretending the literal string is present.
const REQUIREMENT_SYNONYMS = {
  catalog: ['product', 'products', 'store', 'shop', 'inventory', 'listing'],
  todo: ['task', 'tasks', 'checklist', 'backlog'],
  list: ['task', 'todo', 'item', 'items', 'entry'],
  tasks: ['task', 'todo', 'checklist'],
  checklist: ['task', 'todo'],
  calculator: ['calc', 'calculation', 'sum', 'arithmetic', 'display'],
  calculate: ['calc', 'calculator'],
  weather: ['forecast', 'temperature', 'city'],
  expense: ['expenses', 'spending', 'budget', 'cost'],
  expenses: ['expense', 'spending', 'budget'],
  budget: ['expense', 'spending'],
  invoice: ['receipt', 'billing', 'total', 'line'],
  recipe: ['recipes', 'ingredients', 'cooking'],
  workout: ['workouts', 'exercise', 'fitness', 'training'],
  workoutlog: ['workout', 'exercise'],
  book: ['books', 'reading', 'title', 'author'],
  reading: ['book', 'notes', 'progress'],
  habit: ['habits', 'streak', 'checkin', 'daily'],
  habits: ['habit', 'streak', 'daily'],
  streak: ['habit', 'streaks', 'consecutive'],
  bookmark: ['bookmarks', 'link', 'url'],
  password: ['passwords', 'vault', 'credential', 'credentials'],
  survey: ['surveys', 'question', 'response', 'quiz'],
  timer: ['stopwatch', 'pomodoro', 'interval', 'countdown'],
  calendar: ['event', 'events', 'schedule', 'booking'],
  kanban: ['board', 'column', 'card'],
  portfolio: ['resume', 'cv', 'about', 'work'],
  resume: ['portfolio', 'cv'],
  music: ['song', 'playlist', 'player', 'audio'],
  chat: ['message', 'messages', 'conversation', 'room'],
  message: ['chat', 'messages', 'send'],
  recording: ['recordings', 'recorder', 'clip'],
  game: ['score', 'play', 'player', 'board'],
  chess: ['game', 'board', 'move', 'piece'],
  app: ['application'],
  application: ['app'],
  // Product-type vocabulary. A founder says "e-commerce platform"; the working product it
  // describes calls its own data "orders" and "cart". Without these the wrong-app guard
  // refused a correct store for using the nouns of the domain it actually implements.
  ecommerce: ['order', 'cart', 'checkout', 'store', 'shop', 'product', 'catalog', 'sale'],
  platform: ['application', 'app', 'service'],
  commerce: ['order', 'cart', 'checkout', 'store', 'shop'],
  portal: ['dashboard', 'panel', 'hub'],
  system: ['app', 'service', 'tool'],
  solution: ['app', 'tool'],
  business: ['order', 'customer', 'invoice', 'sale'],
  cafe: ['order', 'coffee', 'menu'],
  restaurant: ['order', 'menu', 'table'],
  gym: ['workout', 'exercise', 'member'],
  clinic: ['patient', 'appointment', 'medicine'],
  school: ['student', 'course', 'class'],
  library: ['book', 'borrow', 'isbn'],
  garden: ['plant', 'water', 'seed'],
  recipe: ['cook', 'bake', 'ingredients'],
  travel: ['trip', 'booking', 'destination'],
  crypto: ['wallet', 'coin', 'block'],
  fitness: ['workout', 'exercise', 'training'],
  budget: ['expense', 'spending', 'cost'],
  invoice: ['receipt', 'billing', 'total'],
  quote: ['estimate', 'price', 'total'],
  fleet: ['vehicle', 'driver', 'route'],
  inventory: ['stock', 'item', 'sku'],
  booking: ['appointment', 'slot', 'reservation'],
  payroll: ['salary', 'employee', 'pay'],
  warehouse: ['stock', 'shelf', 'item'],
  project: ['task', 'milestone', 'board'],
  meeting: ['agenda', 'minutes', 'attendee']
};

function expandWords(words) {
  const out = new Set(words);
  for (const w of words) for (const alt of (REQUIREMENT_SYNONYMS[w] ?? [])) out.add(alt);
  return [...out];
}

function requirementCoverage(requirements, haystack) {
  const code = haystack.toLowerCase();
  return (Array.isArray(requirements) ? requirements : []).map((raw) => {
    const requirement = String(raw ?? '').slice(0, 200);
    const words = significantWords(requirement);
    const hits = words.filter((w) => code.includes(w));
    const status = words.length === 0 ? 'UNKNOWN' : (hits.length > 0 ? 'IMPLEMENTED' : 'MISSING');
    return { requirement, status, matched: hits.slice(0, 6), keywords: words.length };
  });
}

/**
 * Per-requirement coverage against the app's EXECUTED source (HTML + JS + CSS).
 * Exported so the delivery manifest can report the same statuses the QA gate judged.
 * Statuses: IMPLEMENTED (keyword evidence in executed source) | MISSING | UNKNOWN (no
 * significant keywords to match). A status here is keyword evidence, not a runtime
 * proof — runtime proof comes from the Node verifier and the founder's own use.
 */
export function evaluateRequirementCoverage(requirements, sourceFiles) {
  const executed = (Array.isArray(sourceFiles) ? sourceFiles : [])
    .filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string')
    .filter((f) => !/^package\.json$/i.test(f.path) && !/(^|\/)README(\.md|\.txt)?$/i.test(f.path) && !/\.(json|lock|ya?ml|toml)$/i.test(f.path));
  const markup = executed.filter((f) => /\.html?$/i.test(f.path)).map((f) => String(f.content ?? '')).join('\n');
  // Inline scripts count as behaviour: most templates ship one html file with the app
  // inline, so a corpus built only from external .js files was empty for them.
  const inline = [...markup.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const js = executed.filter((f) => /\.(m?js)$/i.test(f.path)).map((f) => String(f.content ?? '')).join('\n') + '\n' + inline;

  // Evidence must be BEHAVIOURAL, not prose. Production delivered a contact/message form for
  // "build a personal habit tracker with streaks": its <title> and hero simply repeated the
  // founder's command, so every keyword matched, the fidelity score was 100 and the
  // requirement was reported IMPLEMENTED — for an app that sends messages. A requirement is
  // evidenced only by the domain words the app actually uses: its JavaScript and the DOM
  // identifiers it binds (id/class/data-*/name/aria-label) and its field labels. Visible copy,
  // titles and meta text are excluded on purpose.
  const structural = [
    js,
    ...markup.matchAll(/\b(?:id|class|data-[\w-]+|name|aria-label|role)\s*=\s*["']([^"']*)["']/gi),
    ...markup.matchAll(/<label[^>]*>([\s\S]{0,120}?)<\/label>/gi)
  ].map((part) => (typeof part === 'string' ? part : (part[1] ?? ''))).join(' ');

  return (Array.isArray(requirements) ? requirements : []).map((raw) => {
    const requirement = String(raw ?? '').slice(0, 200);
    const words = significantWords(requirement);
    const behavioural = structural.toLowerCase();
    const prose = visibleText(markup).toLowerCase();
    const all = expandWords(words);
    const hits = all.filter((w) => behavioural.includes(w));
    const proseHits = all.filter((w) => prose.includes(w));
    const evidence = hits.length > 0 ? 'behavioural' : (proseHits.length > 0 ? 'prose' : 'none');
    return {
      requirement,
      status: words.length === 0 ? 'UNKNOWN' : (evidence === 'none' ? 'MISSING' : 'IMPLEMENTED'),
      evidence,
      matched: (hits.length ? hits : proseHits).slice(0, 6),
      proseOnly: hits.length === 0 && proseHits.length > 0,
      keywords: words.length
    };
  });
}

// The app's own visible text: headings, buttons, labels and list items. Scripts, styles,
// the document head and the <title> are removed — a title that merely repeats the founder's
// command is not evidence that the app does what was asked.
function visibleText(markup) {
  return String(markup ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;|&amp;|&lt;|&gt;|&nbsp;/g, ' ');
}

/**
 * Analyze a generated code-workspace for functional fidelity.
 * @returns {{passed:boolean, score:number, violations:Array, coverage:Array, stats:object}}
 */
export function analyzeGeneratedApp(files, { objective = '', requirements = [] } = {}) {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  const web = isWeb(list);
  const html = htmlOf(list);
  const js = scriptOf(list);
  const clean = stripComments(js);
  const violations = [];
  const push = (code, severity, detail) => violations.push({ code, severity, detail });

  // 1. Placeholder / demo wording anywhere in shipped source. The HTML `placeholder="…"`
  // attribute is a legitimate input hint, not a placeholder implementation, so strip it
  // before scanning.
  const allText = list.map((f) => f.content).join('\n').replace(/\bplaceholder\s*=\s*(["'])[^"']*\1/gi, '');
  for (const { re, code } of PLACEHOLDER_PATTERNS) {
    if (re.test(allText)) push(code, SEVERITY.CRITICAL, `${code} found in generated source`);
  }

  // 2. Empty / no-op handlers.
  const bodies = handlerBodies(js);
  const noop = bodies.filter((b) => isNoopBody(b.body));
  if (noop.length) push('noop-handler', SEVERITY.CRITICAL, `no-op or log-only handlers: ${noop.map((b) => b.name).slice(0, 8).join(', ')}`);

  // 3. Buttons/functions referenced but never defined (dead UI).
  const refs = inlineHandlerRefs(html);
  const defined = definedNames(js);
  const unbound = [...refs].filter((r) => !defined.has(r));
  if (unbound.length) push('unbound-handler', SEVERITY.CRITICAL, `handlers referenced but not defined: ${unbound.slice(0, 8).join(', ')}`);

  // 4. No interaction at all — a static page, not an app.
  const hasHandlerAttr = /\son[a-z]+\s*=/i.test(html);
  const hasListener = /addEventListener\s*\(/i.test(clean);
  const interactionCount = Math.max(refs.size, hasListener ? 1 : 0, hasHandlerAttr ? 1 : 0);
  if (web && interactionCount === 0) push('no-interaction', SEVERITY.CRITICAL, 'no event handlers, listeners or bound actions found');

  // 5. Data-intent requirement with no persistence/API call anywhere.
  const wantsData = DATA_INTENT_RE.test(objective) || requirementCoverage(requirements, objective).some((c) => DATA_INTENT_RE.test(c.requirement));
  const hasPersistence = PERSISTENCE_RE.test(clean) || API_RE.test(clean);
  if (wantsData && !hasPersistence) {
    push('no-persistence', SEVERITY.CRITICAL, 'the request implies stored data but no localStorage/DB/API call exists');
  }

  // 6. Fake async: setTimeout/setInterval present but nothing else ever changes state.
  const fakeAsyncOnly = /set(Timeout|Interval)\s*\(/.test(clean) && !hasPersistence && !/localStorage|innerHTML|textContent|\.push\(|\.value\s*=/.test(clean);
  if (fakeAsyncOnly) push('fake-async', SEVERITY.WARNING, 'uses timers but never updates state or the DOM');

  // 7. Mocked API: a fetch replaced by a literal promise.
  if (/fetch\s*=\s*(async\s*)?\([^)]*\)\s*=>\s*\{?\s*return\s*(Promise\.resolve\s*\(\s*)?\{/i.test(clean) || /Promise\.resolve\s*\(\s*\{\s*(ok|success|status)/i.test(clean)) {
    push('mocked-api', SEVERITY.CRITICAL, 'an API is faked with a literal resolved response');
  }

  // 8. Real-time claimed but not implemented.
  const wantsRealtime = /real[- ]?time|live|socket|stream|notification/i.test(objective);
  if (wantsRealtime && !REALTIME_RE.test(clean)) {
    push('realtime-not-implemented', SEVERITY.WARNING, 'real-time was requested but no WebSocket/SSE/subscription exists');
  }

  // Coverage reads executed source only — see evaluateRequirementCoverage(). The
  // allText scan above stays for placeholder wording, which is a red flag wherever it
  // ships, including docs.
  const coverage = evaluateRequirementCoverage(requirements, list);
  const allMissing = coverage.length > 0 && coverage.every((c) => c.status === 'MISSING');
  // WARNING, not CRITICAL: a requirement is often a process/quality statement ("security
  // review", "testing and verification") that no product source would ever name, so the
  // absence of its keywords is not proof the app is a demo. The unambiguous demo signals —
  // placeholder wording, dead buttons, no-op handlers, no interaction, missing persistence —
  // still fail the app, and the per-requirement statuses are reported as gate/delivery
  // evidence so a MISSING requirement is always visible to the founder.
  if (allMissing) push('no-requirement-evidence', SEVERITY.WARNING, 'no requirement keyword appears in the executed source; per-requirement statuses are reported as evidence');

  const critical = violations.filter((v) => v.severity === SEVERITY.CRITICAL);
  const score = Math.max(0, 100 - critical.length * 25 - (violations.length - critical.length) * 8);
  const passed = critical.length === 0 && interactionCount > 0;

  return {
    passed,
    score,
    violations,
    coverage,
    stats: {
      files: list.length,
      codeBytes: js.length,
      handlers: defined.size,
      handlerRefs: refs.size,
      interactionCount,
      hasPersistence,
      web
    }
  };
}
