// MAULI 2.0 — periodic maintenance operations (run from the scheduled handler).
// Kept separate from db.js so it can touch both D1 and the in-memory store
// without creating an import cycle.

import { hasD1 } from './db.js';
import { store } from './store.js';
import { schedulerTick } from './scheduler.js';
import { approveProject } from './governance.js';

// A project is "stuck" when it is still not terminal but nothing can move it forward:
// no live execution, no runnable task, and no pending founder gate. These accumulate on
// production after deploys/restarts interrupt an in-flight chain, and they make the project
// list look broken (a project showing "active" that has been idle for hours).
const ACTIVE_PROJECT_STATES = new Set(['active', 'queued', 'planning', 'escalated', 'executing', 'awaiting_approval']);
const RUNNABLE_TASK_STATES = new Set(['queued', 'assigned']);

/**
 * Diagnose every non-terminal project and re-queue the ones that can actually progress.
 * Returns a per-project verdict so the founder sees *why* each project was or was not
 * touched, instead of a silent bulk mutation. Safe to call repeatedly (idempotent).
 */
export async function recoverStuckProjects({ dryRun = false } = {}) {
  const stamp = new Date().toISOString();
  const tasks = store.list('tasks');
  const byProject = new Map();
  for (const task of tasks) {
    if (!task?.projectId) continue;
    if (!byProject.has(task.projectId)) byProject.set(task.projectId, []);
    byProject.get(task.projectId).push(task);
  }
  const runningRunProjectIds = new Set(
    store.list('runs')
      .filter(r => r.state === 'running')
      .map(r => store.get('tasks', r.taskId)?.projectId)
      .filter(Boolean)
  );

  const reports = [];
  for (const project of store.list('projects')) {
    if (!project?.id) continue;
    if (!ACTIVE_PROJECT_STATES.has(project.state)) continue;
    const own = byProject.get(project.id) ?? [];
    const counts = own.reduce((acc, t) => {
      acc[t.state] = (acc[t.state] ?? 0) + 1;
      return acc;
    }, {});
    const runnable = own.filter(t => RUNNABLE_TASK_STATES.has(t.state));

    // A project parked on a founder gate is not stuck: it is waiting for a human.
    const gate = store.list('approvals').find(a => a.projectId === project.id && a.state === 'pending');
    if (gate) {
      reports.push({ projectId: project.id, state: project.state, verdict: 'awaiting_approval', approvalId: gate.id, counts });
      continue;
    }
    // No tasks at all means the plan never landed (or was pruned). Nothing to re-queue;
    // report it instead of inventing work.
    if (!own.length) {
      reports.push({ projectId: project.id, state: project.state, verdict: 'no_tasks', counts });
      continue;
    }
    // Everything finished AND every task actually passed: the row missed the finalization
    // write. Completion must mean "no task failed" — buildFinalDelivery refuses a delivery
    // that has a failed task, so marking such a project completed would be a lie that the
    // very next scheduler pass contradicts with a command.failed event.
    if (own.every(t => t.state === 'completed' || (t.state === 'cancelled' && t.collapsedDuplicate))) {
      if (!dryRun && project.state !== 'completed') {
        await store.putDurable('projects', { ...project, state: 'completed', completedAt: project.completedAt ?? stamp, updatedAt: stamp, id: project.id });
        store.addEvent('project.recovered', { projectId: project.id, from: project.state, to: 'completed', reason: 'all tasks completed', at: stamp });
      }
      reports.push({ projectId: project.id, state: project.state, verdict: 'finalize_completed', counts });
      continue;
    }
    // Work exists and something is already runnable or actively executing: leave it alone.
    // The live-run check must be per-project — one running task anywhere in the system used
    // to mark every project in_progress, so nothing was ever diagnosed or re-queued.
    if (runnable.length || runningRunProjectIds.has(project.id)) {
      reports.push({ projectId: project.id, state: project.state, verdict: 'in_progress', counts });
      continue;
    }
    // Nothing is runnable and nothing is executing: a dead chain. Re-queue the live work
    // through the same governance path a founder approval uses, which also retries any
    // failed or blocked task whose dependencies are satisfied.
    if (dryRun) {
      reports.push({ projectId: project.id, state: project.state, verdict: 'would_requeue', counts });
      continue;
    }
    const approved = approveProject(
      { id: `auto_recovery_${project.id}`, projectId: project.id, risk: 'normal', action: 'stuck-project-recovery', state: 'pending' },
      project,
      'automatic stuck-project recovery'
    );
    const after = store.list('tasks').filter(t => t.projectId === project.id);
    const stillFailed = after.filter(t => t.state === 'failed');
    // A task that failed and cannot be retried is a real outcome, not a bug to paper over.
    // Retire the project as failed so it stops masquerading as active work in the list.
    if (stillFailed.length) {
      store.put('projects', { ...store.get('projects', project.id), state: 'failed', updatedAt: stamp, id: project.id });
      store.addEvent('project.recovered', { projectId: project.id, from: project.state, to: 'failed', reason: `${stillFailed.length} unretriable task(s)`, at: stamp });
      reports.push({ projectId: project.id, state: project.state, verdict: 'failed_chain', counts, failedTasks: stillFailed.length });
      continue;
    }
    reports.push({
      projectId: project.id,
      state: project.state,
      verdict: approved ? 'requeued' : 'requeue_failed',
      counts,
      newState: approved?.project?.state ?? null,
    });
  }

  return {
    scanned: reports.length,
    requeued: reports.filter(r => r.verdict === 'requeued').length,
    finalized: reports.filter(r => r.verdict === 'finalize_completed').length,
    failed: reports.filter(r => r.verdict === 'failed_chain').length,
    dryRun,
    reports,
  };
}

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
    // A small table is not necessarily clean: a single duplicate is enough to make the
    // dashboard count and cards wrong. Only skip reference scans when every name is unique.
    if ([...byName.values()].every(list => list.length === 1)) {
      _lastAgentDedupe = now;
      return { deduped: 0, reason: 'clean', total: agents.length };
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

    // Delete duplicate agents from D1 in small chunks: D1 rejects statements with more
    // than 100 bound parameters, so the previous single giant IN(...) failed silently and
    // the duplicates were never actually removed.
    const removeList = [...removeIds];
    for (let i = 0; i < removeList.length; i += 90) {
      const chunk = removeList.slice(i, i + 90);
      const ph = chunk.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM entities WHERE type = 'agents' AND id IN (${ph})`).bind(...chunk).run();
    }
    const keptInMemory = store.list('agents').filter(a => keepIds.has(a.id));
    store.data.set('agents', new Map(keptInMemory.map(a => [a.id, a])));

    _lastAgentDedupe = now;
    return { deduped: removeIds.size, kept: keepIds.size, repointed, total: agents.length };
  } catch (error) {
    return { deduped: 0, error: error?.message ?? String(error) };
  }
}

/**
 * One code path owns project finalization: run the persistent scheduler, then prune.
 * Exported so the cron handler and tests exercise exactly what production runs.
 */
let _lastStuckRecovery = 0;
const STUCK_RECOVERY_INTERVAL = 30 * 60 * 1000; // at most twice per hour

export async function runMaintenance(env, context = {}) {
  // Self-heal before scheduling: a project whose chain was interrupted by a deploy or
  // restart is otherwise skipped by the scheduler forever (no runnable task, no live run).
  let recovery = { scanned: 0, requeued: 0, finalized: 0, skipped: 'cooldown' };
  if (store.hydrated && Date.now() - _lastStuckRecovery > STUCK_RECOVERY_INTERVAL) {
    _lastStuckRecovery = Date.now();
    recovery = await recoverStuckProjects({ dryRun: false });
  }
  const scheduler = await schedulerTick(env, {
    trigger: 'cloudflare-scheduled',
    scheduledTime: context?.scheduledTime ?? Date.now(),
    budgetMs: 8 * 60_000,
  }).catch(error => {
    store.addEvent('scheduler.tick_error', { error: error?.message ?? String(error), at: new Date().toISOString() });
    return null;
  });
  return { scheduler, recovery };
}