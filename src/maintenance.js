// MAULI 2.0 — periodic maintenance operations (run from the scheduled handler).
// Kept separate from db.js so it can touch both D1 and the in-memory store
// without creating an import cycle.

import { hasD1 } from './db.js';
import { store } from './store.js';

let _lastAgentDedupe = 0;
const AGENT_DEDUPE_INTERVAL = 60 * 60 * 1000; // at most once per hour

// Prefer the copy with the most history (learning/skill tree), then reliability,
// then idle state, then newest. This keeps the valuable copy instead of the first.
function dedupeScore(agent) {
  let score = 0;
  const metadata = agent?.metadata ?? {};
  score += Object.keys(metadata.learning ?? {}).length * 10;
  score += Object.keys(metadata.skillTree ?? {}).length * 2;
  score += Math.max(0, Number(metadata.successRate ?? 0)) * 5;
  if (agent.state === 'available') score += 3;
  if (agent.currentTaskId) score -= 10;
  const ts = Date.parse(agent.updatedAt ?? agent.heartbeatAt ?? 0);
  if (Number.isFinite(ts)) score += Math.min(10, ts / 1e12);
  return score;
}

/**
 * Collapse duplicate agents (same name) down to one kept copy.
 *  - Re-points assignedAgentId/agentId in tasks, runs, artifacts, executions,
 *    verifications and memory to the kept agent (D1 + in-memory store).
 *  - Deletes the duplicate rows from D1 and the in-memory store.
 * Self-throttled to once per hour; after the first run the agent table is small
 * so subsequent runs are cheap.
 */
export async function dedupeAgents(env) {
  if (!hasD1(env)) return { deduped: 0, reason: 'no-d1' };
  const now = Date.now();
  if (now - _lastAgentDedupe < AGENT_DEDUPE_INTERVAL) return { deduped: 0, reason: 'cooldown' };
  try {
    const rows = await env.DB.prepare('SELECT id, data FROM entities WHERE type = ?').bind('agents').all();
    const agents = (rows.results ?? []).map(r => ({ id: r.id, data: JSON.parse(r.data) }));
    if (!agents.length) { _lastAgentDedupe = now; return { deduped: 0, reason: 'none' }; }

    const byName = new Map();
    for (const a of agents) {
      const name = a.data?.name || 'unnamed';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(a);
    }

    const keepIds = new Set();
    const removeIds = new Set();
    const keptForName = new Map(); // name -> kept agent id
    for (const [name, list] of byName) {
      list.sort((a, b) => dedupeScore(b.data) - dedupeScore(a.data));
      keepIds.add(list[0].id);
      keptForName.set(name, list[0].id);
      for (const dup of list.slice(1)) removeIds.add(dup.id);
    }
    if (!removeIds.size) { _lastAgentDedupe = now; return { deduped: 0, reason: 'no-duplicates', total: agents.length }; }

    const idToName = new Map(agents.map(a => [a.id, a.data?.name || 'unnamed']));

    // Re-point references in other entity types (D1 + memory).
    let repointed = 0;
    for (const type of ['tasks', 'runs', 'artifacts', 'executions', 'verifications', 'memory']) {
      const refs = await env.DB.prepare('SELECT id, data FROM entities WHERE type = ?').bind(type).all();
      for (const row of refs.results ?? []) {
        const data = JSON.parse(row.data);
        let changed = false;
        for (const field of ['assignedAgentId', 'agentId']) {
          const value = data[field];
          if (value && removeIds.has(value)) {
            const keptId = keptForName.get(idToName.get(value));
            if (keptId) { data[field] = keptId; changed = true; }
          }
        }
        if (!changed) continue;
        const stamp = new Date().toISOString();
        await env.DB.prepare('INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at')
          .bind(type, row.id, JSON.stringify(data), data.createdAt ?? stamp, stamp).run();
        repointed++;
        // Update the in-memory copy without firing a redundant D1 write.
        const bucket = store.data.get(type);
        const mem = bucket?.get(row.id);
        if (mem) bucket.set(row.id, { ...mem, ...data, id: mem.id, updatedAt: data.updatedAt ?? mem.updatedAt });
      }
    }

    // Delete duplicate agents from D1 + memory store.
    const ph = [...removeIds].map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM entities WHERE type = 'agents' AND id IN (${ph})`).bind(...removeIds).run();
    const keptInMemory = store.list('agents').filter(a => keepIds.has(a.id));
    store.data.set('agents', new Map(keptInMemory.map(a => [a.id, a])));

    _lastAgentDedupe = now;
    return { deduped: removeIds.size, kept: keepIds.size, repointed, total: agents.length };
  } catch (error) {
    return { deduped: 0, error: error?.message ?? String(error) };
  }
}