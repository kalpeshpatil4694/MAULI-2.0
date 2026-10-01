// MAULI 2.0 — EXACT REQUIREMENT EXTRACTION.
//
// The failure this exists to prevent: MAULI read "build a X" as prose, planned generic
// work, and shipped whichever template it liked best. The founder asked for one product
// and received another that merely passed a static gate.
//
// A founder command is turned into a STRUCTURED SPECIFICATION first — product type,
// platform, roles, features, inputs, outputs, business rules, data requirements,
// authentication, APIs, external services, real-time, security and acceptance criteria —
// and every line of it gets a stable id (REQ-001, REQ-002 …). Nothing downstream may
// claim a requirement is met without naming that id, and a command whose product cannot
// be identified is reported BLOCKED/PARTIAL instead of being guessed at.
//
// Extraction is deterministic and runs inside the Worker: no model call, no network. The
// model may enrich it later; it may never invent what the command did not ask for.

export const SPEC_VERSION = 2;

// ---------------------------------------------------------------------------
// Lexicons. Each entry is a detector, not a story: the first match wins and the
// label becomes a requirement title the founder can read back and contest.
// ---------------------------------------------------------------------------

const PRODUCT_TYPES = [
  { type: 'ecommerce', label: 'Online store / commerce', patterns: [/\b(?:e[- ]?commerce|online store|web ?site? to sell|shopping cart|store front|shopify|checkout)\b/i, /\b(?:cart|checkout|product catalog|catalog)\b/i, /\b(?:order(?:ing|s)? app|take orders|order management|point of sale|billing counter)\b/i] },
  { type: 'dashboard', label: 'Dashboard / reporting', patterns: [/\b(?:dashboard|admin panel|cockpit|analytics|report(ing)? screen|bi ?dashboard)\b/i] },
  { type: 'crm', label: 'CRM / customer records', patterns: [/\b(?:crm|customer relationship|lead management|sales pipeline)\b/i] },
  { type: 'chat', label: 'Chat / messaging', patterns: [/\b(?:chat|messenger|messaging|whatsapp app|talk to|conversation app)\b/i] },
  { type: 'social', label: 'Social / community', patterns: [/\b(?:social (?:network|feed)|community app|forum|feed of)\b/i] },
  { type: 'booking', label: 'Booking / scheduling', patterns: [/\b(?:booking|appointment|reservation|scheduler|calendar app|slot booking)\b/i] },
  { type: 'inventory', label: 'Inventory / stock', patterns: [/\b(?:inventory|stock|warehouse|sku)\b/i] },
  { type: 'finance', label: 'Finance / expense tracking', patterns: [/\b(?:expense|budget|invoice|accounting|finance|ledger|billing|payment)\b/i] },
  { type: 'health', label: 'Health / fitness tracking', patterns: [/\b(?:medicine|medication|dose|pharmacy|prescription|habit|fitness|workout|health|patient|symptom)\b/i] },
  { type: 'education', label: 'Education / quiz', patterns: [/\b(?:quiz|exam|student|teacher|course|lesson|questionnaire|survey)\b/i] },
  { type: 'productivity', label: 'Task / note tracker', patterns: [/\b(?:todo|to[- ]?do|task (?:list|manager|tracker)|checklist|note ?(?:app|taking)|backlog|kanban)\b/i] },
  { type: 'media', label: 'Media / recording', patterns: [/\b(?:record(ing)?|audio|video|photo|camera|podcast|screen ?record)\b/i] },
  { type: 'game', label: 'Game', patterns: [/\b(?:video game|arcade game|chess|puzzle|high score|tic ?tac ?toe|board game|card game)\b/i] },
  { type: 'calculator', label: 'Calculator / converter', patterns: [/\b(?:calculator|converter|unit conversion)\b/i] },
  { type: 'security-audit', label: 'Security / network auditor', patterns: [/\b(?:security audit|auditor|vulnerab\w+|penetration test|wi[- ]?fi audit|network audit|firewall review)\b/i] },
  { type: 'automation', label: 'Automation / workflow', patterns: [/\b(?:automat\w+|workflow|pipeline|scrape\w*|integration with)\b/i] },
  { type: 'api', label: 'Backend API service', patterns: [/\b(?:rest ?api|json ?api|api (?:service|endpoint|for)|backend service|microservice)\b/i] },
  { type: 'document', label: 'Document / report generator', patterns: [/\b(?:pdf|invoice generator|report generator|document)\b/i] },
];

const ROLES = [
  { key: 'admin', label: 'Administrator', patterns: [/\badmin(?:istrator)?\b/i] },
  { key: 'owner', label: 'Owner / manager', patterns: [/\b(?:shopkeeper|store owner|business owner|site owner)\b/i] },
  { key: 'staff', label: 'Staff member', patterns: [/\b(?:staff|employee|team member|agent)\b/i] },
  { key: 'teacher', label: 'Teacher', patterns: [/\bteacher\b/i] },
  { key: 'student', label: 'Student', patterns: [/\bstudent\b/i] },
  { key: 'patient', label: 'Patient', patterns: [/\bpatient\b/i] },
  { key: 'customer', label: 'Customer / buyer', patterns: [/\b(?:customer|buyer|shopper|client)\b/i] },
  { key: 'vendor', label: 'Vendor / supplier', patterns: [/\b(?:vendor|supplier)\b/i] },
  { key: 'editor', label: 'Editor / moderator', patterns: [/\b(?:moderator|editor|reviewer)\b/i] },
  { key: 'member', label: 'Member / user', patterns: [/\bmember\b/i] },
];

// Each feature becomes one requirement with its own evidence vocabulary. The evidence
// words are what the runtime looks for in the app's EXECUTED source, so they are written
// as the words a working implementation actually uses — not as the founder's phrasing.
const FEATURES = [
  { key: 'create', label: 'Create records', evidence: ['add', 'create', 'new', 'submit', 'save', 'form', 'register', 'order', 'log', 'record'], patterns: [/\b(?:add|create|new entry|make a new|submit|place an order|take an order|book|register each|log each|record each|check in|capture|enter)\b/i], inputs: ['title / name field', 'detail fields'], rule: 'A submitted record is validated and then stored' },
  { key: 'read', label: 'View / list records', evidence: ['list', 'view', 'show', 'display', 'render', 'table', 'items'], patterns: [/\b(?:list|view|show|browse|display|see|track)\b/i], outputs: ['record list', 'record detail'], rule: 'Stored records are listed from the store, not from a hardcoded array' },
  { key: 'update', label: 'Update / edit records', evidence: ['edit', 'update', 'modify', 'change', 'save'], patterns: [/\b(?:update|edit|modify|change|revise)\b/i], inputs: ['edited values'], rule: 'An update changes the stored record and the UI reflects the new value' },
  { key: 'delete', label: 'Delete records', evidence: ['delete', 'remove', 'clear', 'discard'], patterns: [/\b(?:delete|remove|discard|clear)\b/i], rule: 'A deleted record disappears from the store and the UI' },
  { key: 'search', label: 'Search / filter', evidence: ['search', 'filter', 'query', 'find', 'match'], patterns: [/\b(?:search|filter|lookup|find)\b/i], inputs: ['search text'], rule: 'Search narrows the visible records by the entered text' },
  { key: 'sort', label: 'Sort / order', evidence: ['sort', 'order', 'rank', 'priority'], patterns: [/\b(?:sort|order by|priority|ranking)\b/i], rule: 'Records are ordered by the selected field' },
  { key: 'report', label: 'Report / summary', evidence: ['report', 'summary', 'total', 'count', 'chart', 'stats'], patterns: [/\b(?:report|summary|statistics|analytics|chart|graph|total)\b/i], outputs: ['aggregated totals'], rule: 'Totals are computed from the stored records' },
  { key: 'export', label: 'Export / download', evidence: ['export', 'download', 'csv', 'json', 'downloads'], patterns: [/\b(?:export|download|csv|print)\b/i], outputs: ['exported file'], rule: 'Export produces a file from the real stored data' },
  { key: 'import', label: 'Import / bulk load', evidence: ['import', 'upload', 'csv', 'bulk'], patterns: [/\b(?:import|upload|bulk)\b/i], inputs: ['uploaded file'], rule: 'Imported rows are validated and stored' },
  { key: 'reminder', label: 'Reminders / scheduling', evidence: ['reminder', 'schedule', 'timer', 'due', 'alarm', 'notify'], patterns: [/\b(?:remind\w*|schedule[ds]?|due date|alarm|notification|alert)\b/i], inputs: ['date / time'], rule: 'A scheduled item fires against stored data, not a cosmetic countdown' },
  { key: 'notification', label: 'Notifications / alerts', evidence: ['notification', 'alert', 'toast', 'badge'], patterns: [/\b(?:notification|alert|push|badge)\b/i], rule: 'A notification is produced by real state change' },
  { key: 'attachment', label: 'File / attachment handling', evidence: ['file', 'upload', 'attachment', 'pdf', 'image'], patterns: [/\b(?:attachment|file upload|photo upload|document upload)\b/i], rule: 'An attachment is stored and can be read back' },
  { key: 'payment', label: 'Payments', evidence: ['payment', 'checkout', 'stripe', 'pay', 'price', 'total'], patterns: [/\b(?:payment|checkout|pay\b|checkout flow|invoice amount)\b/i], inputs: ['payment details'], rule: 'Payment state is stored and reflected in the order record' },
  { key: 'audit', label: 'Scoring / analysis', evidence: ['score', 'grade', 'rate', 'analyse', 'analyze', 'evaluate', 'audit', 'auditor', 'findings'], patterns: [/\b(?:score|grade|analy[sz]e|evaluat\w+|audit|auditor|assess|check|inspect|review)\b/i], outputs: ['score', 'findings list'], rule: 'The score is computed from the submitted data' },
  { key: 'media', label: 'Media capture / playback', evidence: ['record', 'camera', 'media', 'audio', 'video', 'playback'], patterns: [/\b(?:record(ing)?|capture|camera|mic(rophone)?)\b/i], rule: 'Capture starts and stops and produces retrievable state' },
];

const EXTERNAL_SERVICES = [
  { key: 'weather', label: 'Weather API', patterns: [/\b(?:weather|forecast|temperature|rain)\b/i], env: 'WEATHER_API_KEY', capability: 'fetches a live forecast' },
  { key: 'maps', label: 'Maps / geocoding', patterns: [/\b(?:map|geocod|directions|latitude|longitude|places)\b/i], env: 'MAPS_API_KEY', capability: 'resolves coordinates to an address' },
  { key: 'email', label: 'Email delivery', patterns: [/\b(?:email|e[- ]?mail|mail send|smtp|newsletter)\b/i], env: 'EMAIL_API_KEY', capability: 'sends a real message' },
  { key: 'sms', label: 'SMS', patterns: [/\b(?:sms|text message|otp|whatsapp message)\b/i], env: 'SMS_API_KEY', capability: 'delivers an SMS' },
  { key: 'payments', label: 'Payment provider', patterns: [/\b(?:payment gateway|stripe|razorpay|paypal|checkout with card)\b/i], env: 'PAYMENTS_API_KEY', capability: 'charges a payment method' },
  { key: 'translation', label: 'Translation service', patterns: [/\b(?:translate|translation|language conversion)\b/i], env: 'TRANSLATE_API_KEY', capability: 'translates text' },
  { key: 'ai', label: 'AI model', patterns: [/\b(?:ai[- ]?(?:generated|powered)|llm|chatbot|classify with ai|summari[sz]e with ai)\b/i], env: 'AI_API_KEY', capability: 'returns a model completion' },
  { key: 'search', label: 'Search provider', patterns: [/\b(?:search engine|elastic search|algolia|serp)\b/i], env: 'SEARCH_API_KEY', capability: 'runs a web search' },
  { key: 'storage', label: 'File storage', patterns: [/\b(?:upload( to)? (?:a )?(?:server|cloud)|file storage|image hosting|s3)\b/i], env: 'STORAGE_API_KEY', capability: 'stores and returns a file' },
];

// A product type that inherently stores records implies the four record operations even
// when the founder never says them: "a medicine timetable tracker for my mother" asks to
// add, see, change and remove medicines without naming any of those verbs. A security
// auditor, a calculator and a game deliberately do NOT appear here — scoring, printing a
// number and moving a piece are not create/read/update/delete.
const CRUD_TYPES = new Set(['ecommerce', 'dashboard', 'crm', 'booking', 'inventory', 'finance', 'health', 'education', 'productivity', 'automation']);
const CRUD_FEATURES = ['create', 'read', 'update', 'delete'];

const MULTI_USER_RE = /\b(?:multi[- ]?user|multiple users|several users|team|different users|each user|everyone|all users|shared|collab\w*|my team|my staff|my employees|my customers)\b/i;
const OFFLINE_RE = /\b(?:offline|no (?:internet|server|backend|cloud)|without (?:internet|network|server)|single user|just for me|personal)\b/i;

function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function detect(list, text) {
  const found = [];
  for (const entry of list) {
    if (entry.patterns.some((p) => p.test(text))) found.push(entry);
  }
  return found;
}

// Words the founder used that describe *how* rather than *what* (build, create, make,
// an app, for me …). They are never evidence that a product was identified.
const STOP_WORDS = new Set(['build', 'create', 'make', 'develop', 'design', 'implement', 'generate', 'give', 'want', 'need', 'please', 'help', 'app', 'application', 'website', 'site', 'web', 'webapp', 'simple', 'small', 'basic', 'quick', 'new', 'and', 'the', 'a', 'an', 'for', 'with', 'that', 'this', 'me', 'my', 'our', 'its', 'from', 'into', 'using', 'use', 'can', 'should', 'must', 'will', 'let', 'us', 'tool', 'software', 'system', 'project', 'platform', 'based', 'able']);

function domainWords(text) {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

let seq = 0;
/** Stable, human-checkable requirement id. Format is fixed: REQ-001. */
export function requirementId() {
  seq = (seq + 1) % 1000;
  return `REQ-${String(seq).padStart(3, '0')}`;
}

export function resetRequirementIds() { seq = 0; }

function req(category, title, { statement, critical = false, evidence = [], verification = 'runtime', verifiableStatically = true, appliesTo = null }) {
  return { id: requirementId(), category, title, statement: statement ?? title, critical, evidence, verification, verifiableStatically, appliesTo };
}

/**
 * Turn a founder command into a structured specification with stable requirement ids.
 * Pure and synchronous — the Worker can run it on every command with no I/O.
 */
export function extractRequirementSpec(input = {}) {
  const command = String(input.command ?? input.founderCommand ?? '').trim();
  const objective = String(input.objective ?? command).trim();
  const platform = input.platform ?? null;
  const text = `${command} ${objective}`;
  resetRequirementIds();

  const productTypes = detect(PRODUCT_TYPES, text);
  const roles = detect(ROLES, text);
  // The founder's own domain nouns. A product type the app must evidence is best evidenced
  // by the words the founder used: a medicine tracker names medicines, a Wi-Fi auditor names
  // Wi-Fi. Matching only the catalogue label ("Health / fitness tracking") failed correct
  // apps that never needed to say the word "fitness".
  const nouns = domainWords(text);
  let features = detect(FEATURES, text);
  const services = detect(EXTERNAL_SERVICES, text);
  if (!features.length && productTypes[0] && CRUD_TYPES.has(productTypes[0].type)) {
    features = CRUD_FEATURES.map((k) => FEATURES.find((f) => f.key === k));
  }
  // A founder naming actions ("register each garment", "mark it ready") has described a
  // record product even when the catalogue has no word for the domain. Those verbs imply the
  // four record operations that a real product then owes.
  if (features.some((f) => ['create', 'read', 'audit'].includes(f.key)) && !features.some((f) => f.key === 'delete')) {
    features = [...features, FEATURES.find((f) => f.key === 'delete'), FEATURES.find((f) => f.key === 'read')].filter(Boolean);
  }

  const wantsAuth = /\b(?:log ?in|login|sign ?in|signin|register|registration|sign ?up|signup|create account|user account|authentication|auth)\b/i.test(text) || roles.length > 0;
  // "live order updates", "instant sync", "real time" — the founder names the channel
  // loosely. Only a genuine live-collaboration word counts; "live" alone inside "live\n  // stream of data" is a media request, not a second client.
  const wantsRealtime = /\b(?:real[- ]?time|realtime|in ?real ?time|instant(?:ly)?|push update|push notification|collaborative|multiplayer|websocket|event ?stream|\bsse\b)\b/i.test(text)
    // "live order updates", "live sync between devices": a live word and an update word,
    // not necessarily adjacent.
    || /\blive\b[^.]{0,24}?\b(?:update\w*|sync\w*|feed|refresh\w*|notif\w*|seen|connected)\b/i.test(text)
    // "the counter screen updates live", "appears instantly", "shows up right away": the
    // live word comes AFTER the verb, which is how a founder actually writes it. The live
    // acceptance command for the bakery app said "updates live when a new order comes in"
    // and the requirement was missed entirely.
    || /\b(?:update\w*|show\w*|refresh\w*|appear\w*|display\w*|change\w*|come[s]? in|arrive\w*|reach\w*)\b[^.]{0,16}?\b(?:up\s+)?(?:live|instantly|automatically|right away|in real time|as soon as)\b/i.test(text)
    || /\bwithout\s+(?:a\s+|any\s+)?(?:manual\s+|page\s+)?refresh\w*\b/i.test(text)
    || /\b(?:push|pops? up|appears?)\b[^.]{0,20}?\b(?:to|on|for)\b[^.]{0,20}?\b(?:phone|device|screen|staff|team)\b/i.test(text);
    // A chat product is not automatically a live one: the founder has to ask for other
    // clients to see changes. Treating "chat" as real-time invented a requirement nobody
    // stated and refused a working messaging app for it.
  const wantsData = /\b(?:track|save|store|keep|persist|record|log|history|database|list of|manage\w*|order|orders|booking|entries)\b/i.test(text) || features.some((f) => ['create', 'read', 'update', 'delete'].includes(f.key));
  const wantsSecurity = /\b(?:secure|security|encrypt|password protect|role[- ]based|rbac|private)\b/i.test(text) || roles.length > 1 || wantsAuth;

  // -- 1. product type --------------------------------------------------------
  const requirements = [];
  // A domain MAULI has no catalogue entry for is still a specific product when the founder
  // named the thing ("a laundry pickup and drop-off app ... register each garment"). It is
  // reported as the founder's own domain, at PARTIAL confidence — never silently upgraded to
  // a catalogue product, and never dropped to BLOCKED when the behaviour asked for is clear.
  const domainNoun = nouns.find((w) => !['owner','shop','counter','screen','staff','team','customer','user','app','order','orders','item','items','thing','things','thing\'s','people','time','day','week','month','year','update','updates','live'].includes(w)) ?? null;
  const inferredProduct = !productTypes.length && features.length && domainNoun
    ? { type: 'domain', label: `${domainNoun} app` }
    : null;
  const product = productTypes[0] ?? inferredProduct;
  if (product) {
    requirements.push(req('product', `Product type: ${product.label}`, {
      statement: `The product is a ${product.label}.`,
      critical: true,
      evidence: [...new Set([
        ...product.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3),
        ...nouns.slice(0, 4)
      ])]
    }));
  }
  if (platform) {
    const nativeTarget = ['android', 'ios', 'desktop'].includes(String(platform).toLowerCase());
    // "Runs on the web" is not a behavioural requirement — a correct web app never says the
    // word "web" in its source, and gating delivery on that would refuse working products.
    // A native target IS an obligation: it must carry packaging and permission metadata.
    requirements.push(req('platform', `Platform: ${platform}`, {
      statement: `The product runs on ${platform}.`,
      critical: nativeTarget,
      verifiableStatically: nativeTarget,
      evidence: nativeTarget ? [String(platform).toLowerCase(), 'manifest', 'permission', 'capacitor', 'build'] : []
    }));
  }
  for (const role of roles) {
    requirements.push(req('product', `User role: ${role.label}`, {
      statement: `The product supports a ${role.label} role.`,
      evidence: [role.key]
    }));
  }

  // -- 2. core features -------------------------------------------------------
  for (const feature of features) {
    requirements.push(req('product', `Core feature: ${feature.label}`, {
      statement: `${feature.label} must work end to end. ${feature.rule ?? ''}`.trim(),
      critical: true,
      evidence: feature.evidence,
      inputs: feature.inputs ?? [],
      outputs: feature.outputs ?? []
    }));
  }

  // -- 3. inputs / outputs ----------------------------------------------------
  const inputs = [...new Set(features.flatMap((f) => f.inputs ?? []))];
  const outputs = [...new Set(features.flatMap((f) => f.outputs ?? []))];

  // -- 4. business rules ------------------------------------------------------
  const rules = features.map((f) => f.rule).filter(Boolean);
  for (const m of text.matchAll(/\b(?:must|should|only|never|always|auto(?:matic)?|when)\s+([^.!?]{6,90})/gi)) {
    rules.push(m[0].trim());
  }

  // -- 5. data requirements ---------------------------------------------------
  if (wantsData) {
    requirements.push(req('data', 'Persistence: records survive a refresh', {
      statement: 'Every created record is written to a store and read back after a refresh — never a hardcoded array.',
      critical: true,
      evidence: ['localstorage', 'setitem', 'getitem', 'api', 'insert', 'select', 'query', 'database', 'indexeddb']
    }));
    requirements.push(req('data', 'Create → read round trip', {
      statement: 'A record created in the UI is read back from the store through an API or storage read.',
      critical: true,
      evidence: ['fetch', 'api', 'setitem', 'getitem', 'insert', 'select']
    }));
  }

  // -- 6. authentication ------------------------------------------------------
  if (wantsAuth) {
    requirements.push(req('auth', 'User registration', {
      statement: 'A new user can register with validated credentials.',
      critical: true,
      evidence: ['register', 'signup', 'sign up', 'create account', 'password', 'hash']
    }));
    requirements.push(req('auth', 'Login and session', {
      statement: 'A registered user can log in and receives a session that protects the app.',
      critical: true,
      evidence: ['login', 'signin', 'sign in', 'session', 'token', 'auth', 'password']
    }));
    requirements.push(req('auth', 'Logout', {
      statement: 'The user can log out and protected data is no longer reachable.',
      evidence: ['logout', 'sign out', 'signout']
    }));
    requirements.push(req('auth', 'Unauthorized access is rejected', {
      statement: 'A request without a valid session is refused (401), not served.',
      critical: true,
      appliesTo: 'backend',
      evidence: ['401', 'unauthorized', 'forbidden', 'session', 'token', 'auth']
    }));
  }

  // -- 7. APIs ----------------------------------------------------------------
  if (wantsData || wantsAuth || input.architectureHint === 'worker-api') {
    requirements.push(req('api', 'Backend API contract', {
      statement: 'The frontend calls a real backend API that validates the request and returns a response the UI uses.',
      critical: true,
      appliesTo: 'backend',
      evidence: ['fetch', 'api', 'route', 'request', 'response', 'json', 'endpoint']
    }));
  }

  // -- 8. external services ---------------------------------------------------
  for (const service of services) {
    requirements.push(req('external', `External service: ${service.label}`, {
      statement: `The app calls ${service.label} for real, with credential validation, a timeout, a bounded retry and a visible failure path.`,
      critical: true,
      evidence: ['fetch', 'api', 'timeout', 'retry', service.key],
      externalService: service.key,
      requiredEnvVar: service.env
    }));
  }

  // -- 9. real-time -----------------------------------------------------------
  if (wantsRealtime) {
    requirements.push(req('realtime', 'Real-time propagation', {
      statement: 'A change on one client reaches other connected clients through a server-pushed channel (WebSocket / SSE), not a UI animation.',
      critical: true,
      verifiableStatically: false,
      appliesTo: 'backend',
      evidence: ['websocket', 'eventsource', 'sse', 'broadcast', 'subscribe', 'onmessage']
    }));
  }

  // -- 10. security -----------------------------------------------------------
  if (wantsSecurity) {
    requirements.push(req('security', 'Input validation and safe handling', {
      statement: 'Input is validated, output is escaped, and no unsafe dynamic execution is used.',
      critical: true,
      evidence: ['validate', 'sanitize', 'escape', 'trim', 'length', 'required', 'textcontent']
    }));
  }
  requirements.push(req('security', 'No stub, mock or fake-success implementation', {
    statement: 'No placeholder, mocked response, disabled control, "coming soon" or console-only handler ships in the product.',
    critical: true,
    evidence: []
  }));

  // -- 11. acceptance criteria ------------------------------------------------
  const acceptance = [];
  acceptance.push('Every core feature performs a real state change, not a visual one');
  if (wantsData) {
    acceptance.push('A record created in the UI is still present after a refresh');
    requirements.push(req('acceptance', 'Refresh persistence', {
      statement: 'After reloading the app, previously created data is still present.',
      critical: true,
      evidence: ['getitem', 'select', 'fetch', 'api', 'load', 'restore']
    }));
  }
  if (wantsAuth) acceptance.push('A protected read is refused without a session and allowed with one');
  if (wantsRealtime) acceptance.push('A change made by one connected client arrives at another without a manual refresh');
  acceptance.push('No disabled button, placeholder text or hardcoded result in the delivered product');

  // -- understanding ----------------------------------------------------------
  // BLOCKED when the command asks for software but nothing in it identifies a product
  // or a single feature: guessing here is exactly the generic-substitution failure.
  const asksForSoftware = /\b(?:build|create|make|develop|implement|design|generate|need|want)\b/i.test(text);
  const understood = productTypes.length > 0 && features.length > 0;
  // COMPLETE needs a catalogue product AND behaviour. A product MAULI recognised from the
  // founder's own domain noun is PARTIAL: the behaviour is clear, the domain is unverified.
  const understanding = understood ? 'COMPLETE'
    : (product || features.length) ? 'PARTIAL'
      : (asksForSoftware ? 'BLOCKED' : 'COMPLETE');

  return {
    specVersion: SPEC_VERSION,
    command,
    objective,
    platform: platform ?? null,
    productType: product?.type ?? null,
    productTypeLabel: product?.label ?? null,
    inferredFromDomain: inferredProduct ? (domainNoun ?? null) : null,
    alternativeProductTypes: productTypes.slice(1).map((p) => p.type),
    roles: roles.map((r) => ({ key: r.key, label: r.label })),
    features: features.map((f) => ({ key: f.key, label: f.label })),
    inputs,
    outputs,
    businessRules: [...new Set(rules)],
    dataRequirements: wantsData ? ['durable records', 'create → read → update → delete round trip'] : [],
    authentication: { required: wantsAuth, roles: roles.map((r) => r.key) },
    apis: wantsData || wantsAuth
      ? [{ method: 'POST', path: '/api/register' }, { method: 'POST', path: '/api/login' }, { method: 'GET', path: '/api/records' }, { method: 'POST', path: '/api/records' }, { method: 'PUT', path: '/api/records/:id' }, { method: 'DELETE', path: '/api/records/:id' }]
      : [],
    externalServices: services.map((s) => ({ key: s.key, label: s.label, envVar: s.env, capability: s.capability })),
    realtime: { required: wantsRealtime },
    security: {
      validation: wantsSecurity || wantsData,
      roles: roles.map((r) => r.key),
      sessionProtection: wantsAuth
    },
    multiUser: MULTI_USER_RE.test(text) || roles.length > 0,
    offlineRequested: OFFLINE_RE.test(text),
    acceptanceCriteria: acceptance,
    requirements,
    domainWords: [...new Set(nouns)].slice(0, 12),
    understanding
  };
}

export default extractRequirementSpec;
