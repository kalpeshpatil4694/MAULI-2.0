// Navigation integrity: a delivered app must open every page it links to.
//
// The founder-reported failure this pins: a generated web app whose nav pointed at pages
// that were never emitted, so the "second page" opened nothing and the product looked
// unfinished no matter how many screens it claimed to have. The generator now ships real
// files for every page, and the fidelity gate refuses any shipped link that does not
// resolve to a file in the same product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { analyzeGeneratedApp, brokenNavigation } from '../src/generated-app-quality.js';

const COMMAND = 'Design a customer support ticket management system with agent login, ticket queue, assign tickets and reports';

function build(command = COMMAND) {
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  return { spec, architecture, built };
}

function hrefsOf(content) {
  return [...String(content).matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}

test('the generator ships every page its navigation links to', () => {
  const { built } = build();
  const pages = built.files.filter((f) => /\.html?$/i.test(f.path));
  assert.ok(pages.length >= 3, `expected a multi-page app, got ${pages.map((p) => p.path).join(', ')}`);

  const paths = new Set(built.files.map((f) => f.path));
  for (const page of pages) {
    const links = hrefsOf(page.content).filter((href) => /\.html?($|[?#])/.test(href));
    assert.ok(links.length >= 2, `${page.path} has no navigation links`);
    for (const link of links) {
      const target = link.split('#')[0].split('?')[0];
      const resolved = target.startsWith('/')
        ? `www/${target.replace(/^\//, '')}`
        : `www/${target}`;
      assert.ok(paths.has(resolved), `${page.path} links to ${target}, which was never generated`);
    }
  }

  const broken = brokenNavigation(built.files);
  assert.deepEqual(broken, [], `dead references shipped: ${JSON.stringify(broken)}`);
});

test('every page carries the same working navigation', () => {
  const { built } = build();
  const pages = built.files.filter((f) => /\.html?$/i.test(f.path));
  for (const page of pages) {
    for (const target of ['index.html', 'reports.html', 'settings.html']) {
      assert.ok(
        page.content.includes(`href="${target}"`),
        `${page.path} is missing its navigation link to ${target}`
      );
    }
  }
});

test('the dashboard keeps the sections the runtime journey drives', () => {
  const { built } = build();
  const index = built.files.find((f) => f.path === 'www/index.html');
  assert.ok(index, 'www/index.html must exist');
  assert.ok(index.content.includes('id="mauli-create-form"'), 'the create form must stay on the dashboard');
  assert.ok(index.content.includes('id="mauli-list"'), 'the record list must stay on the dashboard');
  assert.ok(index.content.includes('id="mauli-stats"'), 'the overview cards belong on the dashboard');
});

test('the generated multi-page app still passes its own fidelity gate', () => {
  const { spec, built } = build();
  const quality = analyzeGeneratedApp(built.files, {
    objective: COMMAND,
    requirements: spec.requirements.map((r) => r.title)
  });
  assert.equal(
    quality.violations.find((v) => v.code === 'broken-navigation'),
    undefined,
    `the generator violated its own navigation rule: ${JSON.stringify(quality.stats)}`
  );
  assert.equal(quality.stats.brokenLinks, 0);
  assert.ok(quality.stats.pages >= 3);
  assert.ok(quality.passed, `fidelity must pass: ${JSON.stringify(quality.violations)}`);
});

test('a nav link to a page that does not exist fails the gate', () => {
  const files = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body>' +
        '<nav><a href="index.html">Home</a><a href="reports.html">Reports</a></nav>' +
        '<div id="out"></div><button onclick="save()">Save</button>' +
        '<script src="app.js"></script></body></html>'
    },
    {
      path: 'www/app.js',
      'content': 'function save(){localStorage.setItem("k",String(Date.now()));document.getElementById("out").textContent="saved";}'
    },
    { path: 'www/styles.css', content: 'body{font-family:system-ui}' }
  ];
  const quality = analyzeGeneratedApp(files, { objective: 'Save settings' });
  const violation = quality.violations.find((v) => v.code === 'broken-navigation');
  assert.ok(violation, 'a link to a missing page must be reported');
  assert.equal(violation.severity, 'critical');
  assert.equal(quality.passed, false, 'a dead page link must block delivery');
  assert.match(violation.detail, /reports\.html/);
});

test('a missing stylesheet or script is a broken page too', () => {
  const files = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head>' +
        '<body><button onclick="go()">Go</button><script src="app.js"></script></body></html>'
    },
    { path: 'www/app.js', content: 'function go(){localStorage.setItem("x","1");}' }
    // styles.css deliberately absent
  ];
  const quality = analyzeGeneratedApp(files, { objective: 'Run a task' });
  const violation = quality.violations.find((v) => v.code === 'broken-navigation');
  assert.ok(violation, 'a missing stylesheet must be reported');
  assert.match(violation.detail, /styles\.css/);
});

test('JS navigation to a page that does not exist is caught', () => {
  const files = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><body><button onclick="go()">Go</button><script src="app.js"></script></body></html>'
    },
    { path: 'www/app.js', content: 'function go(){localStorage.setItem("n","1");location.href="settings.html";}' }
    // settings.html deliberately absent
  ];
  const quality = analyzeGeneratedApp(files, { objective: 'Open settings' });
  const violation = quality.violations.find((v) => v.code === 'broken-navigation');
  assert.ok(violation, 'location.href to a missing page must be reported');
  assert.match(violation.detail, /settings\.html/);
});

test('a missing image is reported but does not veto a working app', () => {
  const files = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body>' +
        '<img src="logo.png" alt="Logo">' +
        '<div id="out"></div><button onclick="go()">Go</button>' +
        '<script src="app.js"></script></body></html>'
    },
    { path: 'www/app.js', content: 'function go(){localStorage.setItem("v","1");document.getElementById("out").textContent="ok";}' },
    { path: 'www/styles.css', content: 'body{font-family:system-ui}' }
    // logo.png deliberately absent
  ];
  const quality = analyzeGeneratedApp(files, { objective: 'Run a task' });
  assert.equal(
    quality.violations.find((v) => v.code === 'broken-navigation'),
    undefined,
    'a cosmetic asset must not be treated as a dead page'
  );
  const warning = quality.violations.find((v) => v.code === 'missing-asset');
  assert.ok(warning, 'the missing image must still be reported');
  assert.equal(warning.severity, 'warning');
  assert.equal(quality.passed, true, JSON.stringify(quality.violations));
});

test('external links, anchors and extensionless routes are not false positives', () => {
  const files = [
    {
      path: 'www/index.html',
      content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body>' +
        '<nav><a href="index.html">Home</a><a href="#about">About</a>' +
        '<a href="https://example.com/docs">Docs</a><a href="mailto:hi@example.com">Mail</a>' +
        '<a href="/account">Account</a></nav>' +
        '<div id="out"></div><button onclick="go()">Go</button>' +
        '<script src="app.js"></script></body></html>'
    },
    { path: 'www/app.js', content: 'function go(){localStorage.setItem("v","1");document.getElementById("out").textContent="ok";}' },
    { path: 'www/styles.css', content: 'body{font-family:system-ui}' }
  ];
  const quality = analyzeGeneratedApp(files, { objective: 'Navigate the app' });
  assert.equal(
    quality.violations.find((v) => v.code === 'broken-navigation'),
    undefined,
    'legitimate links were wrongly flagged'
  );
  assert.ok(quality.passed, JSON.stringify(quality.violations));
});
