// The target platform is part of the command, not a build-time afterthought.
//
// "Build a habit tracker" and "Build a habit tracker for Android" are different products,
// but MAULI used to build the same web page for both and only discovered the platform later,
// when the founder clicked a build button. The platform is now chosen with the command,
// planned for, recorded on the project, and stated on the delivery.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLATFORMS,
  DEFAULT_PLATFORM,
  normalizePlatform,
  detectPlatformFromText,
  resolvePlatform,
  platformRequirements,
  withPlatformRequirements,
  describePlatform,
} from '../src/platforms.js';
import { createProject } from '../src/projects.js';
import { queueCommand } from '../src/orchestrator.js';
import { buildFinalDelivery } from '../src/delivery.js';
import { generateFromTemplate } from '../src/app-templates.js';
import { store } from '../src/store.js';

test('every platform a founder can pick is buildable and has a label', () => {
  const ids = PLATFORMS.map((p) => p.id);
  for (const wanted of ['web', 'android', 'ios', 'desktop']) {
    assert.ok(ids.includes(wanted), `${wanted} is offered`);
  }
  assert.equal(new Set(ids).size, ids.length, 'no duplicate platforms');
  for (const p of PLATFORMS) {
    assert.equal(normalizePlatform(p.id), p.id, `${p.id} round-trips`);
    assert.ok(p.label && p.icon, `${p.id} is presentable in the dashboard`);
    assert.match(describePlatform(p.id), /./, `${p.id} has a description`);
  }
});

test('what founders actually type is understood', () => {
  assert.equal(normalizePlatform('exe'), 'desktop', 'exe is a desktop app');
  assert.equal(normalizePlatform('APK'), 'android');
  assert.equal(normalizePlatform('  Android  '), 'android', 'case and padding are forgiven');
  assert.equal(normalizePlatform('iPhone'), 'ios');
  assert.equal(normalizePlatform('symbian'), null, 'an unknown platform is not guessed at');
  assert.equal(normalizePlatform(''), null);
  assert.equal(normalizePlatform(undefined), null);
});

test('the platform is read from the command when the founder did not choose one', () => {
  assert.equal(detectPlatformFromText('Build a weather app for Android'), 'android');
  assert.equal(detectPlatformFromText('Create a portfolio website'), 'web');
  assert.equal(detectPlatformFromText('make an exe for windows'), 'desktop');
  assert.equal(detectPlatformFromText('Build an iPhone app'), 'ios');
  assert.equal(detectPlatformFromText('Build a habit tracker'), null, 'no platform named');
});

test('a short word inside a longer word is not a platform', () => {
  // "mac" and "ios" are the two that fire on ordinary English if the match is not bounded.
  assert.equal(detectPlatformFromText('Build a curious machine dashboard'), null);
  assert.equal(detectPlatformFromText('A curious operating manual'), null);
});

test('a named platform outranks the browser shape it is described in', () => {
  // "website" is a longer word than "android", and ranking by length let the web default
  // hijack a command that named a real target.
  assert.equal(detectPlatformFromText('Build a portfolio website for Android'), 'android');
  assert.equal(detectPlatformFromText('Create a web dashboard for iPhone'), 'ios');
  assert.equal(detectPlatformFromText('Make a website that runs as a Windows exe'), 'desktop');
  // With no named target, the browser hint is all there is.
  assert.equal(detectPlatformFromText('Create a portfolio website'), 'web');
});

test('an explicit choice always beats the words in the command', () => {
  const chosen = resolvePlatform('desktop', 'Build a weather app for Android');
  assert.deepEqual(chosen, { platform: 'desktop', source: 'explicit' });

  const inferred = resolvePlatform(null, 'Build a weather app for Android');
  assert.deepEqual(inferred, { platform: 'android', source: 'inferred' });

  // An unusable value falls back to reading the command rather than failing the command.
  const fallback = resolvePlatform('symbian', 'Build an Android tracker');
  assert.deepEqual(fallback, { platform: 'android', source: 'inferred' });

  assert.deepEqual(resolvePlatform(null, 'Build a habit tracker'), {
    platform: DEFAULT_PLATFORM,
    source: 'default',
  });
});

test('a non-web target adds a packaging requirement to the plan', () => {
  assert.deepEqual(platformRequirements('web'), [], 'the web needs no packaging step');
  assert.deepEqual(platformRequirements('android'), ['Android packaging and device permissions']);
  assert.deepEqual(platformRequirements('desktop'), [
    'Desktop executable packaging and platform metadata',
  ]);

  const existing = ['User interface', 'Data persistence'];
  const merged = withPlatformRequirements(existing, 'android');
  assert.ok(merged.includes('Android packaging and device permissions'), 'the target is planned for');
  assert.ok(merged.includes('User interface'), 'planner requirements survive');

  // Merging twice must not duplicate: the plan is built on more than one code path.
  assert.deepEqual(withPlatformRequirements(merged, 'android'), merged);
});

test('a project records the platform it was commissioned for', () => {
  const project = createProject({
    name: 'Project: Android tracker',
    objective: 'Android tracker',
    platform: 'android',
  });
  assert.equal(project.platform, 'android', 'the platform is persisted, not inferred later');
  assert.equal(store.get('projects', project.id).platform, 'android', 'and it survives a read');
  store.data.get('projects')?.delete(project.id);

  // A project created without one stays null rather than being silently rewritten.
  const plain = createProject({ name: 'P', objective: 'O' });
  assert.equal(plain.platform, null);
  store.data.get('projects')?.delete(plain.id);
});

test('queueing a command carries the chosen platform onto the project', async () => {
  // Regression: the platform was threaded through planCommand but the route a founder
  // actually hits lives in worker.js, and it called queueCommand without the option — so
  // every commissioned target was silently downgraded to the web default.
  store.configure(null);
  store.data = new Map();
  store.events = [];

  const chosen = await queueCommand('Build a weather app with live forecasts', {}, { platform: 'android' });
  assert.equal(chosen.platform.platform, 'android', 'the resolved target is reported back');
  assert.equal(chosen.project.platform, 'android', 'and persisted on the project');
  assert.ok(
    chosen.project.requirements.includes('Android packaging and device permissions'),
    `the plan covers the target: ${JSON.stringify(chosen.project.requirements)}`
  );

  // No explicit choice: the command's own words decide, then the web default. The reported
  // source has to tell the truth about which of the two happened, so it is asserted here —
  // a route that resolved first and passed the resolved id back reported 'explicit' for a
  // command that named no platform at all.
  const inferred = await queueCommand('Build a portfolio website for Android', {}, {});
  assert.equal(inferred.platform.source, 'inferred', 'the provenance is reported honestly');
  assert.equal(inferred.project.platform, 'android', 'the command is read when nothing is chosen');

  const plain = await queueCommand('Build a habit tracker', {}, {});
  assert.deepEqual(plain.platform, { platform: 'web', source: 'default' });
  assert.equal(plain.project.platform, 'web', 'an unmentioned platform still builds for the web');

  store.data = new Map();
  store.events = [];
});

test('the delivery says which platform it was built for', () => {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  const objective = 'Build a personal habit tracker web app with daily check-ins and streaks';
  const project = store.put('projects', {
    id: 'platform-delivery-project', name: 'P', objective, founderCommand: objective,
    requirements: [objective], platform: 'android', state: 'completed',
  });
  store.put('tasks', { id: 'pd-task', projectId: project.id, title: 'Build', state: 'completed' });
  for (const gate of ['build', 'test', 'requirements', 'security', 'integrity']) {
    store.put('tasks', { id: `pd-${gate}`, projectId: project.id, title: `Gate ${gate}`, state: 'completed', pipelineGate: true, gateType: gate, verificationId: `v-${gate}` });
  }
  store.put('tasks', { id: 'pd-qa', projectId: project.id, title: 'Final QA', state: 'completed', finalProjectVerification: true, verificationId: 'v', pipelineGate: true, gateType: 'qa' });
  const app = generateFromTemplate({ objective, requirements: [objective] });
  store.put('artifacts', {
    id: 'pd-artifact', projectId: project.id, type: 'code-workspace', content: { files: app.files },
    metadata: { generatedBy: 'app-templates', template: app.projectType, templateMatched: app.templateMatched },
  });

  const delivery = buildFinalDelivery(project, { enforceGates: true });
  assert.ok(delivery?.id, 'a deliverable project still delivers');
  // A founder who asked for Android must be able to see that this download is the Android
  // build — the manifest is where a download's target is stated.
  assert.equal(delivery.content.platform, 'android', 'the manifest names the target');
  assert.match(String(delivery.content.platformLabel), /Android/);
  assert.equal(delivery.metadata.platform, 'android');
  assert.equal(delivery.metadata.platformLabel, delivery.content.platformLabel);
});
