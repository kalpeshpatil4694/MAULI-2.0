import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../src/orchestrator.js';
import { store } from '../src/store.js';

test('L1 task ordering: planned tasks follow dependency sequence', async () => {
  const result = await planCommand('Create a simple e-commerce platform', {});
  assert.ok(result?.project?.id, 'project should exist');

  const tasks = store.list('tasks')
    .filter(task => task.projectId === result.project.id && !task.verificationForTaskId)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  assert.ok(tasks.length > 0, 'planned tasks should exist');

  for (let i = 1; i < tasks.length; i += 1) {
    const previous = tasks[i - 1];
    assert.ok(
      (tasks[i].dependsOn ?? []).includes(previous.id),
      `task ${tasks[i].title} should depend on ${previous.title}`
    );
    assert.ok(
      (tasks[i].sequence ?? 0) > (previous.sequence ?? 0),
      `task ${tasks[i].title} should have a later sequence`
    );
  }
});
