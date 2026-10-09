import test from 'node:test';
import assert from 'node:assert/strict';
// Functional coverage for the PRODUCTION founder-command route.
//
// This file did not exist before; it was created as part of resolving finding F-1. It drives the
// endpoint worker.js actually calls (src/command-endpoint.js — see tests/l1-command-api.test.js
// for why that module rather than src/worker.js) and then reads the result back through the
// application's own read API, so the assertions describe what a founder can observe rather than
// the object the endpoint happened to return.
import app from '../src/index.js';
import { handleFounderCommand } from '../src/command-endpoint.js';
import { schedulerTick } from '../src/scheduler.js';
import { store } from '../src/store.js';

store.configure(null);
const ENV = { MAULI_TEST_MODE: 'true', SKIP_RESULT_PERSISTENCE: 'true' };

function commandRequest(body, ip = null) {
  const headers = { 'content-type': 'application/json' };
  if (ip) headers['cf-connecting-ip'] = ip;
  return new Request('https://mauli.test/api/command', { method: 'POST', headers, body: JSON.stringify(body) });
}

const submit = async (body, ip = null) => handleFounderCommand(commandRequest(body, ip), ENV, {});

test('a founder command becomes a durable project whose tasks carry the same run id', async () => {
  const response = await submit({ command: 'Build a simple calculator web app' }, '198.51.100.20');
  assert.equal(response.status, 202);
  const queued = (await response.json()).data.result;
  assert.equal(queued.status, 'queued');

  // Read it back through the application's own detail route.
  const detailResponse = await app.fetch(
    new Request(`https://mauli.test/api/projects/${queued.project.id}/detail`), ENV, {}
  );
  assert.equal(detailResponse.status, 200);
  const detail = (await detailResponse.json()).data.detail;

  assert.equal(detail.project.id, queued.project.id);
  // Two different things, both true: the DURABLE ROW is queued (it has not been claimed), while
  // the read API reports the DERIVED state, which is 'active' because runnable work exists. The
  // distinction is the point of the state model, so assert both rather than conflating them.
  assert.equal(store.get('projects', queued.project.id).state, 'queued', 'the stored row must be queued, not claimed');
  assert.equal(detail.project.state, 'active', 'the read API derives active while runnable work exists');
  assert.equal(detail.project.commandRunId, queued.runId, 'the project must be correlated to the run id');
  assert.ok(detail.tasks.length > 0, 'a command must create tasks');
  assert.ok(detail.tasks.every(t => t.commandRunId === queued.runId), 'every task must carry the run id');
});

test('an unsupported platform is refused instead of silently substituted', async () => {
  const response = await submit({ command: 'Build a mobile app', platform: 'nintendo-switch' }, '198.51.100.21');
  assert.equal(response.status, 400, 'a platform MAULI cannot build must not be swapped for a web app');
  const body = await response.json();
  assert.match(String(body?.error?.message), /Unsupported platform: nintendo-switch/);
});

test('the scheduler picks the queued command up instead of leaving it queued', async () => {
  const response = await submit({ command: 'Build a simple calculator web app' }, '198.51.100.22');
  const projectId = (await response.json()).data.result.project.id;

  let progressed = false;
  for (let tick = 0; tick < 25 && !progressed; tick++) {
    await schedulerTick(ENV, { projectId, budgetMs: 0 });
    const project = store.get('projects', projectId);
    const tasks = store.list('tasks').filter(t => t.projectId === projectId);
    progressed = project?.state !== 'queued' || tasks.some(t => t.state !== 'queued');
  }
  assert.ok(progressed, 'the scheduler must claim the queued command rather than leaving it queued forever');
});
