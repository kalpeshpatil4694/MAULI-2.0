import test from 'node:test';
import assert from 'node:assert/strict';
import {
  supersededProjectDatabases,
  planDatabaseHygiene,
  D1_ACCOUNT_DATABASE_LIMIT
} from '../scripts/deploy-executor.mjs';

// Free-plan accounts allow 10 D1 databases and that ceiling NEVER resets, so a database left
// behind per schema revision is not a slow cost — it is a permanent slot gone. These tests
// pin the two properties the cleanup relies on: it must identify exactly one project's
// superseded databases, and it must never propose deleting a name it does not own.

const db = (name, created_at) => ({ id: 'uuid-' + name, name, created_at });

test('the free-plan database ceiling is what the guard assumes', () => {
  assert.equal(D1_ACCOUNT_DATABASE_LIMIT, 10);
});

test('only the same project\'s older schema versions are superseded', () => {
  const databases = [
    db('generated-shop-aaaaaaaaaa', '2026-10-01'),
    db('generated-shop-bbbbbbbbbb', '2026-10-02'),
    db('mauli2-production', '2026-09-01')
  ];
  const stale = supersededProjectDatabases(databases, 'generated-shop-bbbbbbbbbb');
  assert.deepEqual(stale.map((entry) => entry.name), ['generated-shop-aaaaaaaaaa']);
});

test('a project id that prefixes another project id does not steal its database', () => {
  // "shop" and "shop-2" both start with "generated-shop-", so a prefix match would delete a
  // different founder's data. The hash suffix is fixed-length, which is what makes this safe.
  const databases = [
    db('generated-shop-aaaaaaaaaa', '2026-10-01'),
    db('generated-shop-2-cccccccccc', '2026-10-02'),
    db('generated-shop-2-dddddddddd', '2026-10-03')
  ];
  const stale = supersededProjectDatabases(databases, 'generated-shop-2-dddddddddd');
  assert.deepEqual(stale.map((entry) => entry.name), ['generated-shop-2-cccccccccc']);
});

test('a NEWER schema version of the same project is never treated as superseded', () => {
  // Rolling back to an earlier revision must not delete the database a later revision created:
  // that data is unrecoverable, and the operator can still roll forward to it.
  const databases = [
    db('generated-shop-aaaaaaaaaa', '2026-10-01'),
    db('generated-shop-bbbbbbbbbb', '2026-10-20')
  ];
  const stale = supersededProjectDatabases(databases, 'generated-shop-aaaaaaaaaa', { currentCreatedAt: '2026-10-01' });
  assert.deepEqual(stale, []);
  // And the reverse direction does reclaim the older one.
  const forward = supersededProjectDatabases(databases, 'generated-shop-bbbbbbbbbb', { currentCreatedAt: '2026-10-20' });
  assert.deepEqual(forward.map((entry) => entry.name), ['generated-shop-aaaaaaaaaa']);
});

test('an unversioned database name has no superseded siblings', () => {
  const databases = [db('generated-order', '2026-10-01'), db('generated-order-aaaaaaaaaa', '2026-10-02')];
  assert.deepEqual(supersededProjectDatabases(databases, 'generated-order'), []);
});

test('hygiene keeps the newest schema per project and never touches the control plane', () => {
  const plan = planDatabaseHygiene([
    db('mauli2-production', '2026-09-01'),
    db('generated-shop-aaaaaaaaaa', '2026-10-01'),
    db('generated-shop-bbbbbbbbbb', '2026-10-05'),
    db('generated-order-cccccccccc', '2026-10-02'),
    db('generated-order-dddddddddd', '2026-10-06'),
    db('generated-blog-eeeeeeeeee', '2026-10-03')
  ]);
  const byProject = Object.fromEntries(plan.groups.map((group) => [group.project, group]));
  assert.equal(plan.total, 6);
  assert.equal(byProject['generated-shop'].kept, 'generated-shop-bbbbbbbbbb');
  assert.deepEqual(byProject['generated-shop'].stale.map((entry) => entry.name), ['generated-shop-aaaaaaaaaa']);
  assert.equal(byProject['generated-order'].kept, 'generated-order-dddddddddd');
  // A project with one database has nothing to clean and must not appear in the plan at all.
  assert.equal(byProject['generated-blog'], undefined);
  // The control-plane database matches no versioned name and can never be proposed for deletion.
  assert.ok(!JSON.stringify(plan.groups).includes('mauli2-production'));
});

test('an explicitly kept database is protected even when it is not the newest', () => {
  const plan = planDatabaseHygiene([
    db('generated-shop-aaaaaaaaaa', '2026-10-01'),
    db('generated-shop-bbbbbbbbbb', '2026-10-05')
  ], { keep: ['generated-shop-aaaaaaaaaa'] });
  assert.equal(plan.groups[0].kept, 'generated-shop-aaaaaaaaaa');
  assert.deepEqual(plan.groups[0].stale.map((entry) => entry.name), ['generated-shop-bbbbbbbbbb']);
});

test('a clean account produces an empty plan', () => {
  const plan = planDatabaseHygiene([db('mauli2-production', '2026-09-01'), db('generated-shop-aaaaaaaaaa', '2026-10-01')]);
  assert.deepEqual(plan.groups, []);
});
