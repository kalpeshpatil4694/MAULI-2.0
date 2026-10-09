export { MauliProjectExecutionCoordinator } from './execution-coordinator.js';

// MAULI 2.0 — production Worker entrypoint.
// HTTP remains owned by index.js; scheduled execution is owned by the persistent scheduler.

import app from './index.js';
import { ensureSchema, pruneEvents, pruneOldResults, boundedD1 } from './db.js';
import { dedupeAgents, runMaintenance } from './maintenance.js';
import { store } from './store.js';
import { ensureBuiltinTools } from './tools.js';
import { seedAgents } from './agents.js';
import { schedulerTick } from './scheduler.js';
import { now } from './core.js';
import { handleFounderCommand } from './command-endpoint.js';
import { DASHBOARD_LIVE_SCRIPT } from './dashboard-live.js';

let _workerInit = false; let _lastHydrateTime = 0; const HYDRATE_COOLDOWN = 300000; // 5 min cooldown to prevent D1 row exhaustion
let _d1Failed = false; let _d1FailTime = 0; const D1_FAIL_COOLDOWN = 300000; // 5 min retry after D1 failure
// Read-only polling contract: GET /api/state and GET /api/projects/:id/detail are pure reads.
// They must never write to D1 or start execution. Dashboard polling used to fire a throttled
// scheduler tick, which meant a founder leaving the dashboard open could trigger writes and
// duplicate task runs (and burn the free-tier D1 write budget). Execution is now owned
// exclusively by the cron trigger and by explicit POSTs (/api/command, /api/approvals/:id,
// /api/chat), which is what makes polling cheap and idempotent.
async function hydrate(env, { scheduler = false } = {}) {
  if (_workerInit && (Date.now() - _lastHydrateTime) < HYDRATE_COOLDOWN) return;
  // After a D1 failure (e.g. daily rows_read limit), retry after the cooldown so the
  // worker self-heals when the limit resets instead of staying in memory mode forever.
  if (_d1Failed && (Date.now() - _d1FailTime) < D1_FAIL_COOLDOWN) {
    if (!_workerInit) { ensureBuiltinTools(); seedAgents(); _workerInit = true; _lastHydrateTime = Date.now(); }
    return;
  }
  try {
    if (!_workerInit) await ensureSchema(env);
    store.configure(env);
    if (!store.hydrated) {
      if (scheduler) await store.hydrateScheduler();
      else await store.hydrateOnce();
    }
    _d1Failed = false;
    _d1FailTime = 0;
  } catch (d1Error) {
    console.warn('D1 unavailable, running in-memory mode:', d1Error?.message);
    _d1Failed = true;
    _d1FailTime = Date.now();
    store.configure(env);
  }
  ensureBuiltinTools();
  seedAgents();
  _workerInit = true; _lastHydrateTime = Date.now();
}

function injectDashboardLive(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  return new HTMLRewriter()
    .on('body', { element(element) { element.append(DASHBOARD_LIVE_SCRIPT, { html: true }); } })
    .transform(response);
}

export default {
  async fetch(request, rawEnv, ctx) {
    // Every D1 statement in this invocation runs under a deadline (see boundedD1), so a
    // statement that never settles fails as an ordinary error instead of wedging the request,
    // a scheduler tick, and the per-project execution lock.
    const env = boundedD1(rawEnv);
    const url = new URL(request.url);
    // Request hydration is handled by the application layer so read endpoints can stay cheap.
    // Founder commands are queued immediately. Execution is owned by the persistent scheduler,
    // so a long build can never turn into a false 60-second timeout response.
    //
    // The endpoint itself lives in src/command-endpoint.js so it can be exercised under Node:
    // this module cannot be imported there (it re-exports the Durable Object, which pulls in
    // `cloudflare:workers`), and the suite therefore used to test src/index.js's synchronous
    // look-alike instead of the handler that runs here.
    if (request.method === 'POST' && url.pathname === '/api/command') {
      return handleFounderCommand(request, env, ctx);
    }

    // Approval processing: after index.js processes the approval and queues tasks,
    // trigger the scheduler so tasks start executing immediately instead of waiting
    // for the next cron tick (up to 1 minute delay).
    if (request.method === 'POST' && url.pathname.startsWith('/api/approvals/')) {
      const response = await app.fetch(request, env, ctx);
      if (response.ok && ctx?.waitUntil) {
        const approvalId = url.pathname.split('/').pop();
        // index.js already ran governance.approveProject() (approval row -> 'approved',
        // project -> 'queued', live tasks -> 'queued'). Do not repeat it here: it needs the
        // request body for the founder note, which is not in scope at this layer, and the
        // old call site read `body?.note` from the wrong scope — a ReferenceError that the
        // surrounding .catch(() => null) swallowed, so the project stayed parked.
        const decided = store.get('approvals', approvalId);
        ctx.waitUntil(schedulerTick(env, { trigger: 'approval-granted', approvalId, projectId: decided?.projectId, budgetMs: 20_000 }).catch(error => {
          store.addEvent('approval.scheduler_error', { approvalId, error: error?.message || 'Scheduler error after approval', at: now() });
        }));
      }
      return response;
    }

    // Chat endpoint: after a chat message creates a project, trigger the scheduler
    // so tasks start executing immediately instead of waiting for the next cron tick.
    if (request.method === 'POST' && url.pathname === '/api/chat') {
      const response = await app.fetch(request, env, ctx);
      if (response.ok && ctx?.waitUntil) {
        // Trigger scheduler in background - it picks up any newly queued projects/tasks
        ctx.waitUntil(schedulerTick(env, { trigger: 'chat-message', budgetMs: 20_000 }).catch(error => {
          store.addEvent('chat.scheduler_error', { error: error?.message || 'Scheduler error after chat', at: now() });
        }));
      }
      return response;
    }

    const response = await app.fetch(request, env, ctx);
    // The existing dashboard remains authoritative for data/rendering; this only adds a
    // small live lifecycle layer so Founder Command never looks idle after a successful queue.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      return injectDashboardLive(response);
    }
    return response;
  },  async scheduled(event, rawEnv, ctx) {
    const env = boundedD1(rawEnv);
    // Scheduler gets a deliberately small lifecycle-only bootstrap. A full store hydration
    // here used to read thousands of historical rows on every fresh cron isolate and could
    // consume the 5M/day D1 rows_read allowance by itself.
    if (!store.hydrated) await hydrate(env, { scheduler: true });
    const run = async () => {
      // Agent deduplication is maintenance, not per-minute execution work. Running the
      // full agents-table sweep on every cron isolate was a major D1 rows_read consumer.
      // Run it once every 6 hours; scheduler task claiming does not depend on the cleanup.
      const scheduledMs = Number(event?.scheduledTime) || Date.now();
      const scheduledDate = new Date(scheduledMs);
      if (scheduledDate.getUTCMinutes() === 0 && scheduledDate.getUTCHours() % 6 === 0) {
        await dedupeAgents(env).catch(() => null);
      }
      // The scheduler owns project finalization (finalizeCommand): routing the cron tick
      // through runMaintenance keeps cron and tests on one code path.
      await runMaintenance(env, { scheduledTime: event?.scheduledTime ?? Date.now() });
      // Self-throttling storage pruning (DB was at 93% of the 500MB free tier):
      // events shrink the audit table, results reclaim the 20KB-per-row command results.
      await pruneEvents(env).catch(() => null);
      await pruneOldResults(env).catch(() => null);
    };
    await run();
  }
};
