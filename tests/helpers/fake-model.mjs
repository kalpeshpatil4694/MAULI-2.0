// A deterministic language-model stand-in for tests that drive a founder command end to end.
//
// Generation no longer has a ready-made template net: a command either gets an app written by
// the model, or fails with the reason the model could not produce it. An end-to-end test that
// used `{}` as its environment was therefore only ever passing because a template shipped
// instead of the product. These helpers give the pipeline a model that answers the per-file
// requests with real source that passes the functional-fidelity gate AND carries the founder's
// own domain words in its identifiers, so the requirement matrix judges it as implemented.
const STOP = new Set([
  'build', 'create', 'make', 'simple', 'with', 'that', 'from', 'this', 'will', 'must',
  'should', 'using', 'able', 'user', 'product', 'platform', 'application', 'website', 'site',
  'please', 'need', 'want', 'help'
]);

function keywords(objective) {
  return [...new Set(String(objective ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP.has(word) && word !== 'app' && word !== 'web'))]
    .slice(0, 4);
}

const cap = word => word.charAt(0).toUpperCase() + word.slice(1);

function webSources(objective) {
  const words = keywords(objective);
  const topic = words[0] ?? 'item';
  const heading = words.map(cap).join(' ') || 'Items';
  const formId = `${topic}-form`;
  const inputId = `${topic}-input`;
  const listId = `${topic}-list`;
  const countId = `${topic}-count`;
  const storageKey = words.join('-') || 'items';
  return {
    'www/index.html': '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
      + `<title>${heading}</title><link rel="stylesheet" href="styles.css"></head><body><main class="card">`
      + `<h1>${heading}</h1>`
      + `<form id="${formId}"><label for="${inputId}">Add ${topic}</label>`
      + `<input id="${inputId}" name="${inputId}" placeholder="Describe it in your own words" required>`
      + '<button type="submit">Save</button></form>'
      + `<ul id="${listId}"></ul><p id="${countId}"></p></main>`
      + '<script src="app.js"></script></body></html>',
    'www/app.js': `const STORAGE_KEY = "${storageKey}";\n`
      + `const ${topic}Form = document.getElementById("${formId}");\n`
      + `const ${topic}Input = document.getElementById("${inputId}");\n`
      + `const ${topic}List = document.getElementById("${listId}");\n`
      + `const ${topic}Count = document.getElementById("${countId}");\n`
      + `let ${topic}Entries = [];\n`
      + `try { ${topic}Entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch (error) { ${topic}Entries = []; }\n`
      + `function render${cap(topic)}List() {\n`
      + `  ${topic}List.innerHTML = "";\n`
      + `  ${topic}Entries.forEach(function (entry) {\n`
      + '    const row = document.createElement("li");\n'
      + '    const text = document.createElement("span");\n'
      + '    text.textContent = entry.text;\n'
      + '    const remove = document.createElement("button");\n'
      + '    remove.type = "button";\n'
      + `    remove.textContent = "Delete";\n`
      + '    remove.dataset.id = entry.id;\n'
      + `    remove.addEventListener("click", function () { delete${cap(topic)}Entry(entry.id); });\n`
      + '    row.appendChild(text);\n'
      + '    row.appendChild(remove);\n'
      + `    ${topic}List.appendChild(row);\n`
      + '  });\n'
      + `  ${topic}Count.textContent = ${topic}Entries.length + " saved";\n`
      + '  localStorage.setItem(STORAGE_KEY, JSON.stringify(' + topic + 'Entries));\n'
      + '}\n'
      + `function delete${cap(topic)}Entry(id) {\n`
      + `  ${topic}Entries = ${topic}Entries.filter(function (entry) { return entry.id !== id; });\n`
      + `  render${cap(topic)}List();\n`
      + '}\n'
      + `${topic}Form.addEventListener("submit", function (event) {\n`
      + '  event.preventDefault();\n'
      + `  const text = ${topic}Input.value.trim();\n`
      + '  if (!text) return;\n'
      + `  ${topic}Entries.push({ id: String(Date.now()) + Math.random().toString(16).slice(2), text: text });\n`
      + `  ${topic}Input.value = "";\n`
      + `  render${cap(topic)}List();\n`
      + '});\n'
      + `render${cap(topic)}List();\n`,
    'www/styles.css': 'body{margin:0;font-family:system-ui,sans-serif;background:#0b1120;color:#e8ecf4;'
      + 'display:flex;justify-content:center;padding:32px 16px}.card{width:100%;max-width:520px;background:#131c31;'
      + 'border-radius:14px;padding:24px;box-shadow:0 12px 32px rgba(0,0,0,.35)}h1{margin:0 0 18px;font-size:1.4rem}'
      + 'form{display:flex;flex-wrap:wrap;gap:8px;align-items:center}label{width:100%;font-size:.85rem;opacity:.8}'
      + 'input{flex:1;padding:10px 12px;border-radius:8px;border:1px solid #2c3a58;background:#0b1120;color:inherit}'
      + 'button{padding:10px 14px;border-radius:8px;border:0;background:#38bdf8;color:#04121f;font-weight:600;cursor:pointer}'
      + 'ul{list-style:none;padding:0;margin:18px 0 0}'
      + 'li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;'
      + 'border-radius:8px;background:#1b2742;margin-bottom:8px}li button{background:#ef4444;color:#fff}'
      + `#${countId}{margin-top:12px;font-size:.85rem;opacity:.75}`
  };
}

// A backend task asks for one server file. It is a real HTTP server rather than a stub, and it
// serves the same domain words, so the same gates that judge a web app accept it.
function serverSource(objective) {
  const words = keywords(objective);
  const topic = words[0] ?? 'item';
  return 'const http = require("http");\n'
    + `const ${topic}Entries = [];\n`
    + 'function send(res, status, body) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }\n'
    + `const ${topic}Server = http.createServer(function (req, res) {\n`
    + `  if (req.method === "GET" && req.url === "/api/${topic}") return send(res, 200, { entries: ${topic}Entries });\n`
    + `  if (req.method === "POST" && req.url === "/api/${topic}") {\n`
    + '    let raw = "";\n'
    + '    req.on("data", function (chunk) { raw += chunk; });\n'
    + '    req.on("end", function () {\n'
    + '      let payload = {};\n'
    + '      try { payload = JSON.parse(raw || "{}"); } catch (error) { payload = {}; }\n'
    + '      const text = String(payload.text || "").trim();\n'
    + '      if (!text) return send(res, 400, { error: "text is required" });\n'
    + `      const entry = { id: String(Date.now()), text: text };\n`
    + `      ${topic}Entries.push(entry);\n`
    + '      return send(res, 201, { entry: entry });\n'
    + '    });\n'
    + '    return undefined;\n'
    + '  }\n'
    + '  return send(res, 404, { error: "not found" });\n'
    + '});\n'
    + 'const port = Number(process.env.PORT || 3000);\n'
    + `console.log("starting ${topic} service on " + port);\n`
    + `${topic}Server.listen(port);\n`;
}

const PER_FILE_MARKER = 'Output ONLY the raw contents of ';

export function sourceFor(path, objective = 'Build a simple item list web app') {
  if (path === 'server.js') return serverSource(objective);
  const sources = webSources(objective);
  return sources[path] ?? sources['www/app.js'];
}

/** The objective the request was made for, so the fixture answers with the founder's domain. */
export function objectiveOf(userMessage) {
  const match = String(userMessage ?? '').match(/Product:\s*([^\n]+)/);
  return match ? match[1].trim() : 'Build a simple item list web app';
}

/**
 * An environment whose model answers per-file requests with real source. `seen` records the
 * requests so a test can assert what the executor actually asked for.
 */
export function fakeModelEnv(extra = {}) {
  const seen = [];
  return {
    ...extra,
    seen,
    AI: {
      async run(_model, request) {
        const messages = Array.isArray(request) ? request : (request?.messages ?? []);
        const user = messages.map(message => String(message?.content ?? '')).join('\n');
        seen.push(user);
        // The request reads "Output ONLY the raw contents of www/index.html. No markdown …",
        // so the path must lose its trailing sentence punctuation before it is looked up.
        const rawPath = user.includes(PER_FILE_MARKER)
          ? (user.slice(user.indexOf(PER_FILE_MARKER) + PER_FILE_MARKER.length).match(/^(\S+)/) ?? [])[1]
          : null;
        if (rawPath) return { response: sourceFor(rawPath.replace(/[.,;:]+$/, ''), objectiveOf(user)) };
        // A whole-app request is answered with the envelope the executor refuses, so the
        // per-file path (the production path) is what writes the app.
        return { response: JSON.stringify({ summary: 'fixture app', files: [], tests: [], notes: [] }) };
      }
    }
  };
}
