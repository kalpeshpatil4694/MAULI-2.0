// Visual/product quality of a GENERATED app.
//
// The founder-reported failure this pins: the generated project worked, every control was
// wired, and it still looked like a demo — plain stacked cards, no iconography, no artwork,
// no chart, an unstyled list. Functionality was never the complaint; presentation was, and
// nothing in the pipeline judged it, so a bare page could pass every gate at score 100.
//
// These tests hold the generated frontend to a designed-product bar: real inline SVG
// artwork, a data-driven chart, an empty state, a sidebar shell, a per-product accent hue
// and responsive rules. All artwork is inline SVG on purpose — an <img> pointing at a
// file the generator did not emit is exactly the "graphics do not show up" defect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirementSpec } from '../src/requirement-spec.js';
import { selectArchitecture } from '../src/architecture.js';
import { generateFullStackApp } from '../src/fullstack-codegen.js';
import { analyzeGeneratedApp, brokenNavigation } from '../src/generated-app-quality.js';
import { verifyGeneratedApp } from '../scripts/verify-generated-app.mjs';

const COMMAND = 'Design a customer support ticket management system with agent login, ticket queue, assign tickets and reports';

function build(command = COMMAND) {
  const spec = extractRequirementSpec({ command, platform: 'web' });
  const architecture = selectArchitecture(spec);
  const built = generateFullStackApp(spec, architecture, { objective: command });
  const file = (path) => built.files.find((f) => f.path === path)?.content ?? '';
  return { spec, architecture, built, file };
}

test('every page draws its own iconography as inline SVG', () => {
  const { file } = build();
  for (const page of ['www/index.html', 'www/reports.html', 'www/settings.html']) {
    const html = file(page);
    const svgs = [...html.matchAll(/<svg\b/gi)].length;
    assert.ok(svgs >= 4, `${page} has almost no artwork (${svgs} inline svg) — it renders as a demo`);
    // An <img> is only honest if the file ships. The generator ships no image files, so an
    // <img> here is a graphic that will 404 in the founder's browser.
    assert.ok(!/<img\b/i.test(html), `${page} references an image file the product does not ship`);
  }
});

test('the dashboard ships a chart that is drawn from the stored rows', () => {
  const { file } = build();
  assert.match(file('www/index.html'), /id="mauli-chart"/, 'the dashboard must own the chart element');
  const js = file('www/app.js');
  assert.match(js, /function renderChart\(/, 'the chart must be rendered by the app');
  // Every bar's height comes from a bucket built out of the loaded records.
  assert.match(js, /created_at/, 'the chart must read real row timestamps');
  assert.match(js, /height:' \+ height \+ '%"/, 'bar height must be computed, not hard-coded');
  assert.match(js, /renderChart\(\);/, 'render() must draw the chart on every update');
});

test('the empty state and the stat cards are real product furniture', () => {
  const { file } = build();
  const html = file('www/index.html');
  assert.match(html, /id="mauli-empty"[^>]*class="empty"/, 'an empty product must show an empty state, not a blank gap');
  assert.match(html, /empty-icon/, 'the empty state must carry artwork');
  assert.match(file('www/app.js'), /badge\.className = 'avatar'/, 'list rows must render an avatar');
  assert.match(html, /class="hero"/, 'every page needs a hero, not a bare h1');
});

test('the shell is a sidebar product, not a stacked column of cards', () => {
  const { file } = build();
  const html = file('www/index.html');
  assert.match(html, /class="sidebar"/);
  assert.match(html, /class="brand"/);
  const css = file('www/styles.css');
  assert.match(css, /grid-template-columns:\s*264px/, 'the shell must be a two-column app shell');
  assert.ok(css.length > 8000, `the stylesheet is still a wireframe (${css.length} bytes)`);
});

test('each product gets its own accent hue instead of one template purple', () => {
  const a = build('Build a personal budget tracker web app');
  const b = build('Build a birdwatching sightings log web app');
  const hueOf = (content) => content.match(/--accent:\s*hsl\((\d+)/)?.[1];
  assert.ok(hueOf(a.file('www/styles.css')), 'the accent hue must be derived, not hard-coded');
  assert.notEqual(
    hueOf(a.file('www/styles.css')),
    hueOf(b.file('www/styles.css')),
    'two different products shipped the identical accent — the theme is a constant'
  );
});

test('the generated UI is responsive and respects reduced motion', () => {
  const { file } = build();
  const css = file('www/styles.css');
  assert.match(css, /@media \(max-width: 980px\)/, 'the app shell must collapse on a phone');
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('the redesigned UI still passes navigation, fidelity and runtime execution', () => {
  const { spec, built, file } = build();
  assert.deepEqual(brokenNavigation(built.files), [], 'the artwork must not introduce dead references');
  const quality = analyzeGeneratedApp(built.files, {
    objective: COMMAND,
    requirements: spec.requirements.map((r) => r.title)
  });
  assert.equal(quality.passed, true, JSON.stringify(quality.violations));
  assert.equal(quality.score, 100, JSON.stringify(quality.violations));

  const app = verifyGeneratedApp(built.files, {
    objective: COMMAND,
    requirements: spec.requirements.map((r) => r.title)
  });
  assert.deepEqual(app.errors, [], 'the generated scripts must execute cleanly');
  assert.deepEqual(app.missingHandlers, [], 'no button may reference a function the app does not define');
  assert.ok(file('www/app.js').includes("addEventListener('submit'"), 'the create form must stay wired');
});