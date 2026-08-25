import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommand, getCommand } from '../src/command-runtime.js';

test('command runtime persists accepted lifecycle metadata', async () => {
  const command = await createCommand({}, 'test command');
  assert.match(command.id, /^cmd_[0-9a-f-]+$/);
  assert.equal(command.state, 'accepted');
  assert.equal(command.phase, 'accepted');
  assert.deepEqual(command.progress, { percent: 0, completed: 0, total: 0, currentTask: null });
  const stored = await getCommand({}, command.id);
  assert.equal(stored.id, command.id);
  assert.equal(stored.state, 'accepted');
});
