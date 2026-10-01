export { MauliProjectExecutionCoordinator } from './execution-coordinator.js';

// MAULI 2.0 — production Worker entrypoint.
// HTTP remains owned by index.js; scheduled execution is owned by the persistent scheduler.

import app from './index.js';
import { ensureSchema, pruneEvents, pruneOldResults, boundedD1 } from './db.js';
import { dedupeAgents, runMaintenance } from './maintenance.js';
import { store } from './store.js';
import { ensureBuiltinTools } from './tools.js';
import { PLATFORMS, normalizePlatform, resolvePlatform } from './platforms.js';
import { seedAgents } from './agents.js';
import { schedulerTick } from './scheduler.js';
import { queueCommand } from './orchestrator.js';
import { saveCommandResult } from './result-recorder.js';
import { json, now, fail } from './core.js';
import { requireFounder, checkRateLimit } from './auth.js';
import { DASHBOARD_LIVE_SCRIPT } from './dashboard-live.js';

let _workerInit = false; let _lastHydrateTime = 0; const HYDRATE_COOLDOWN = 300000; // 5 min cooldown to prevent D1 row exhaustion
let _d1Failed = false; let _d1FailTime = 0; const D1_FAIL_COOLDOWN = 300000; // 5 min retry after D1 failure
// Read-only polling contract: GET /api/state and GET /api/projects/:id/detail are pure reads.
// They must never write to D1 or start execution. Dashboard polling used to fire a throttled
// scheduler tick, which meant a founder leaving the dashboard open could trigger writes and
// duplicate task runs (and burn the free-tier D1 write budget). Execution is now owned
// exclusively by the cron trigger and by explicit POSTs (/api/command, /api/approvals/:id,
// /api/chat), which is what makes polling cheap and idempotent.
async function hydrate(env) {
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
    if (!store.hydrated) await store.hydrateOnce();
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

function isIsolatedTestEnv(env) {
  return env?.SKIP_RESULT_PERSISTENCE === true || env?.SKIP_RESULT_PERSISTENCE === 'true' || env?.MAULI_TEST_MODE === true || env?.MAULI_TEST_MODE === 'true';
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
    // Light paths never block the response on hydration: they either render static HTML
    // ("/" is a pure template — dashboardHTML has no store access) or read memory-only
    // types that hydration does not load (notifications, file_edits). Blocking on those
    // made first paint take 12-15 s (ensureSchema + full hydrate) on every cold isolate.
    const lightPath = url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/api/notifications" || url.pathname.startsWith("/api/edits") || url.pathname === "/api/health" || url.pathname === "/api/heartbeat" || url.pathname.startsWith("/api/cf/") || url.pathname === "/api/state" || url.pathname === "/api/usage" || url.pathname === "/api/activity" || url.pathname === "/api/live-status" || url.pathname === "/api/learning/stats" || url.pathname === "/api/learning/skill-tree" || url.pathname === "/api/collaboration/stats" || url.pathname === "/api/messages" || url.pathname === "/api/mcp/servers" || url.pathname === "/api/self-test" || url.pathname === "/api/result-diagnostic";
    // Only block on hydration for POST/command traffic. Light polling paths (the dashboard
    // hits these every 60s) hydrate in the background so the response stays cheap while the
    // isolate still converges to memory-served data instead of re-reading D1 forever.
    if (!_workerInit) {
      if (lightPath) { if (ctx?.waitUntil) ctx.waitUntil(hydrate(env).catch(() => {})); }
      else await hydrate(env);
    }

    // Founder commands are queued immediately. Execution is owned by the persistent scheduler,
    // so a long build can never turn into a false 60-second timeout response.
    if (request.method === 'POST' && url.pathname === '/api/command') {
      const limit = checkRateLimit(request);
      if (!limit.ok) return fail(limit.error, limit.status, { retryAfter: limit.retryAfter });
      const auth = requireFounder(request, env);
      if (!auth.ok) return fail(auth.error, auth.status);
      const body = await json(request);
      if (!body.command) return fail('Founder command is required', 400);
      // This handler, not the one in index.js, is what a founder's command actually hits.
      // An unbuildable target is reported rather than quietly swapped for another one: a
      // founder who asked for Android must never be handed a web build that reports success.
      if (body.platform !== undefined && body.platform !== null && body.platform !== '' && !normalizePlatform(body.platform)) {
        return fail(`Unsupported platform: ${body.platform}. Supported: ${PLATFORMS.map(p => p.id).join(', ')}`, 400);
      }
      const target = resolvePlatform(body.platform, body.command);

      try {
        const queued = await queueCommand(body.command, env, { platform: target.platform });
        const payload = {
          runId: queued.runId,
          command: body.command,
          platform: target.platform,
          generatedAt: now(),
          result: queued
        };
        const saved = isIsolatedTestEnv(env)
          ? { saved: true, skipped: true, testMode: true }
          : await saveCommandResult(payload, env).catch(() => ({ saved: false }));

        if (queued.status === 'queued' && ctx?.waitUntil) {
          // ctx.waitUntil only extends the invocation 30 s past the response (Cloudflare
          // limit), so the drain gets a 20 s budget: tasks that do not fit stay queued
          // and the cron scheduler finishes them instead of being cancelled mid-run.
          ctx.waitUntil(schedulerTick(env, { trigger: 'founder-command', runId: queued.runId, projectId: queued.project?.id, budgetMs: 20_000 }).catch(error => {
            store.addEvent('command.scheduler_error', { runId: queued.runId, error: error?.message || 'Scheduler error', at: now() });
          }));
        }

        const responseData = {
          result: { ...queued, status: queued.status, execution: 'scheduler' },
          runId: queued.runId,
          resultFile: saved
        };
        return Response.json({ ok: true, data: responseData, ...responseData }, { status: 202 });
      } catch (error) {
        const result = { status: 'error', error: error?.message || 'Command queue failed', command: body.command };
        return Response.json({ ok: false, data: { result }, result }, { status: 500 });
      }
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
    // Skip hydration if store is already hydrated — avoids D1 reads every 5 min
    if (!store.hydrated) await hydrate(env);
    const run = async () => {
      // Collapse duplicate agents (old cold-start registration created ~60 copies per
      // name) and re-point task/run references before the tick so stuck tasks unstick.
      await dedupeAgents(env).catch(() => null);
      // The scheduler owns project finalization (finalizeCommand): routing the cron tick
      // through runMaintenance keeps cron and tests on one code path.
      await runMaintenance(env, { scheduledTime: event?.scheduledTime ?? Date.now() });
      // Self-throttling storage pruning (DB was at 93% of the 500MB free tier):
      // events shrink the audit table, results reclaim the 20KB-per-row command results.
      await pruneEvents(env).catch(() => null);
      await pruneOldResults(env).catch(() => null);
    };
    if (ctx?.waitUntil) ctx.waitUntil(run()); else await run();
  }
};
