import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';

test('L1 task ordering: planner produces a valid dependency DAG, not a fixed serial chain', async () => {
  const result = await planCommand('Create a simple e-commerce platform', {});
  assert.ok(result?.project?.id, 'project should exist');

  const tasks = store.list('tasks')
    .filter(task => task.projectId === result.project.id && !task.verificationForTaskId)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  assert.ok(tasks.length > 0, 'planned tasks should exist');

  const byTitle = new Map(tasks.map(task => [task.title, task]));
  const dependencyIds = new Set(tasks.flatMap(task => task.dependsOn ?? []));

  // Every dependency must point to a task in this project and to an earlier
  // execution layer. This catches cycles and accidental cross-project links.
  for (const task of tasks) {
    for (const dependencyId of task.dependsOn ?? []) {
      const dependency = store.get('tasks', dependencyId);
      assert.ok(dependency, `dependency ${dependencyId} should exist`);
      assert.equal(dependency.projectId, result.project.id, 'dependency must belong to the same project');
      assert.ok(
        (dependency.sequence ?? 0) < (task.sequence ?? 0),
        `task ${task.title} must execute after dependency ${dependency.title}`
      );
    }
  }

  const research = [...byTitle.entries()].find(([title]) => title.startsWith('Research and validate requirements'))?.[1];
  const planning = [...byTitle.entries()].find(([title]) => title.startsWith('Define product and architecture plan'))?.[1];
  const backend = [...byTitle.entries()].find(([title]) => title.startsWith('Implement backend code and API'))?.[1];
  const database = [...byTitle.entries()].find(([title]) => title.startsWith('Implement database and persistence schema'))?.[1];
  const frontend = [...byTitle.entries()].find(([title]) => title.startsWith('Implement frontend code and user experience'))?.[1];
  const security = [...byTitle.entries()].find(([title]) => title.startsWith('Perform security review'))?.[1];
  const testing = [...byTitle.entries()].find(([title]) => title.startsWith('Create testing and verification plan'))?.[1];

  assert.ok(research && planning && backend && database && frontend && security && testing, 'expected e-commerce planning tasks should exist');

  assert.deepEqual(planning.dependsOn, [research.id], 'planning must follow research');
  assert.deepEqual(backend.dependsOn, [planning.id], 'backend must follow product planning');
  assert.deepEqual(frontend.dependsOn, [planning.id, backend.id], 'frontend must wait for planning and backend');
  // Persistence and security are REVIEWS of the generated code, not further products to
  // generate — they used to share the internal.code executor and each paid for another full
  // AI app generation, which is why one command took minutes and produced competing
  // artifacts. They therefore follow the code that already exists rather than racing it.
  assert.deepEqual(database.dependsOn, [frontend.id, backend.id], 'persistence review must follow the generated code');
  assert.deepEqual(security.dependsOn, [frontend.id, backend.id], 'security review must follow the generated code');
  assert.equal(database.executor, 'internal.verify-code', 'persistence must not generate a second app');
  assert.equal(security.executor, 'internal.verify-code', 'security must not generate a second app');
  assert.deepEqual(testing.dependsOn, [planning.id], 'testing plan must not be serially blocked by implementation');

  // Only the tasks that WRITE the product run the code generator.
  const generators = tasks.filter(task => task.executor === 'internal.code').map(task => task.title);
  assert.deepEqual(generators.sort(), [backend.title, frontend.title].sort(),
    `exactly one generating task per produced surface, got: ${generators.join(', ')}`);

  // The planner must still preserve real parallelism where it is safe.
  assert.equal((testing.dependsOn ?? []).includes(backend.id), false);

  // Final QA is the only project-wide gate and depends on every implementation
  // task, so no premature delivery can bypass the DAG.
  const qa = tasks.find(task => task.finalProjectVerification);
  assert.ok(qa, 'final QA task should exist');
  for (const task of tasks.filter(task => !task.finalProjectVerification)) {
    assert.ok((qa.dependsOn ?? []).includes(task.id), `final QA should depend on ${task.title}`);
  }

  assert.ok(dependencyIds.size > 0, 'planned DAG should contain dependency edges');
});
