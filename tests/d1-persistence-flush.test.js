import test from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../src/store.js';

test('L1 store flush waits for pending persistence before Result snapshot', async () => {
  let persisted = false;
  let release;
  const pending = new Promise(resolve => { release = () => { persisted = true; resolve(); }; });
  let tracked;
  tracked = pending.finally(() => store.pendingWrites.delete(tracked));
  store.pendingWrites.add(tracked);

  let flushed = false;
  const flushPromise = store.flush().then(() => { flushed = true; });
  await Promise.resolve();
  assert.equal(flushed, false);
  assert.equal(persisted, false);

  release();
  await flushPromise;
  assert.equal(persisted, true);
  assert.equal(flushed, true);
  assert.equal(store.pendingWrites.size, 0);
});
