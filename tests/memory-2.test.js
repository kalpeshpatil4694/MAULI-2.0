import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMORY_TYPES, MEMORY_SCOPES, remember, recall, getMemory, forgetMemory, linkMemories } from '../src/memory.js';
import { store } from '../src/store.js';

function reset() { store.data.delete('memory'); store.events = []; }

test('Memory 2.0 supports all required memory domains and scopes', () => {
  assert.ok(MEMORY_TYPES.includes('decision'));
  assert.ok(MEMORY_TYPES.includes('learning'));
  assert.ok(MEMORY_TYPES.includes('tool_result'));
  assert.deepEqual(MEMORY_SCOPES, ['founder','company','project','task','agent','tool']);
});

test('scoped memory is isolated and recall is ranked', () => {
  reset();
  remember({ type:'project_requirement', content:'checkout must support UPI', scope:'project', scopeId:'p1', importance:'high', tags:['checkout'], confidence:0.9 });
  remember({ type:'project_requirement', content:'checkout uses email', scope:'project', scopeId:'p2' });
  const result = recall({ scope:'project', scopeId:'p1', query:'UPI checkout', limit:10 });
  assert.equal(result.length, 1);
  assert.match(result[0].content, /UPI/);
});

test('duplicate memories are idempotent', () => {
  reset();
  const a = remember({ type:'technical_knowledge', content:'Cloudflare Workers are serverless', scope:'company' });
  const b = remember({ type:'technical_knowledge', content:'Cloudflare Workers are serverless', scope:'company' });
  assert.equal(a.id, b.id);
  assert.equal(recall({ scope:'company' }).length, 1);
});

test('decision supersession preserves history', () => {
  reset();
  const old = remember({ type:'decision', content:'Use provider A', scope:'company', importance:'high' });
  const next = remember({ type:'decision', content:'Use provider B', scope:'company', supersedes:old.id });
  assert.equal(getMemory(old.id).status, 'superseded');
  assert.equal(recall({ type:'decision' }).map(x => x.id).includes(old.id), false);
  assert.equal(next.supersedes, old.id);
});

test('error and solution can be linked', () => {
  reset();
  const error = remember({ type:'error', content:'provider timeout', scope:'task', scopeId:'t1' });
  const solution = remember({ type:'solution', content:'retry with fallback provider', scope:'task', scopeId:'t1', relatedMemoryIds:[error.id], confidence:0.8 });
  assert.ok(solution.relatedMemoryIds.includes(error.id));
  assert.equal(linkMemories(error.id, [solution.id]).relatedMemoryIds[0], solution.id);
});

test('forget archives without destroying the memory record', () => {
  reset();
  const m = remember({ type:'technical_knowledge', content:'temporary fact', scope:'company' });
  const archived = forgetMemory(m.id);
  assert.equal(archived.status, 'archived');
  assert.equal(getMemory(m.id).status, 'archived');
});
