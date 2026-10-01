import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';
import { getArtifactDurable } from '../src/artifacts.js';
import { recoverStuckProjects } from '../src/maintenance.js';

// Two production defects, both found by actually running a founder command end to end.
//
// 1. A delivered artifact intermittently answered "Artifact not found" on download while
//    the same Worker listed it one request earlier. getArtifact() answers from the isolate's
//    hydrated store, and hydration on the request path is `.catch(() => {})`-swallowed: a
//    cold isolate whose hydrate read failed served every artifact route from an empty store.
//    A miss in the cache must now fall through to D1, which is authoritative, before the
//    route is allowed to claim the artifact does not exist.
//
// 2. A project whose approval was already granted stayed in 'awaiting_approval' because the
//    two writes are not atomic and the isolate died between them. claimNextTask refuses such
//    a project, the gate check reported "waiting for a human" who had already answered, and
//    the chain sat at 6/13 tasks until a founder re-pressed Approve by hand. The approval row
//    is the authority; recovery must re-assert the project state from it.

function resetStore() {
  store.configure(null);
  store.data = new Map();
  store.events = [];
  store.hydrated = false;
  store.versions = new Map();
}

function fakeD1(rows) {
  return {
    prepare(sql) {
      const bound = [];
      return {
        bind(...values) { bound.push(...values); return this; },
        first: async () => {
          const id = bound[1];
          const row = rows[`${bound[0]}/${id}`];
          return row ? { data: JSON.stringify(row) } : null;
        },
        run: async () => ({ success: true })
      };
    }
  };
}

test('an artifact missing from the hydrated store is read from D1 instead of 404ing', async () => {
  resetStore();
  const artifact = { id: 'artifact_durable_read', projectId: 'project_durable', type: 'code-workspace', content: { files: [] } };
  const env = { DB: fakeD1({ [`artifacts/${artifact.id}`]: artifact }) };

  assert.equal(store.get('artifacts', artifact.id), null, 'the isolate cache is empty');
  const found = await getArtifactDurable(artifact.id, env);
  assert.ok(found, 'the artifact must be found in D1 even though the cache missed');
  assert.equal(found.projectId, 'project_durable');
  assert.equal(store.get('artifacts', artifact.id)?.id, artifact.id, 'the row is adopted into the cache');
  // A second call is answered from the cache.
  assert.equal((await getArtifactDurable(artifact.id, env)).id, artifact.id);
  // An id that exists nowhere is still honestly reported as missing.
  assert.equal(await getArtifactDurable('artifact_not_in_d1', env), null);
  // No D1 at all: no throw, no invented artifact.
  assert.equal(await getArtifactDurable('artifact_x', {}), null);
});

test('recovery reactivates a project whose approval was granted but never re-asserted', async () => {
  resetStore();
  store.put('projects', { id: 'project_stuck_approved', state: 'awaiting_approval' });
  store.put('tasks', { id: 'task_stuck_approved', projectId: 'project_stuck_approved', state: 'queued' });
  store.put('approvals', { id: 'approval_granted', projectId: 'project_stuck_approved', state: 'approved', decidedAt: '2026-10-01T13:38:18.219Z' });

  const dry = await recoverStuckProjects({ dryRun: true });
  const verdict = dry.reports.find(r => r.projectId === 'project_stuck_approved');
  assert.equal(verdict.verdict, 'would_reactivate');
  assert.equal(store.get('projects', 'project_stuck_approved').state, 'awaiting_approval', 'a dry run must not write');

  const live = await recoverStuckProjects({ dryRun: false });
  const applied = live.reports.find(r => r.projectId === 'project_stuck_approved');
  assert.equal(applied.verdict, 'reactivated_approved');
  assert.equal(store.get('projects', 'project_stuck_approved').state, 'active', 'the project must become runnable again');

  // Idempotent: a second pass has nothing left to re-assert.
  const again = await recoverStuckProjects({ dryRun: false });
  assert.notEqual(again.reports.find(r => r.projectId === 'project_stuck_approved')?.verdict, 'reactivated_approved');
});

test('a genuinely pending approval is still reported as waiting for the founder', async () => {
  resetStore();
  store.put('projects', { id: 'project_waiting', state: 'awaiting_approval' });
  store.put('tasks', { id: 'task_waiting', projectId: 'project_waiting', state: 'queued' });
  store.put('approvals', { id: 'approval_pending', projectId: 'project_waiting', state: 'pending' });

  const report = await recoverStuckProjects({ dryRun: false });
  const verdict = report.reports.find(r => r.projectId === 'project_waiting');
  assert.equal(verdict.verdict, 'awaiting_approval');
  assert.equal(store.get('projects', 'project_waiting').state, 'awaiting_approval', 'an unanswered gate must not be bypassed');
});