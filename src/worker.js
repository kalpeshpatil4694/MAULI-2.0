// MAULI 2.0 — production Worker entrypoint.
// HTTP remains owned by index.js; scheduled execution is owned by the persistent scheduler.

import app from './index.js';
import { ensureSchema } from './db.js';
import { store } from './store.js';
import { ensureBuiltinTools } from './tools.js';
import { seedAgents } from './agents.js';
import { schedulerTick } from './scheduler.js';
import { queueCommand } from './orchestrator.js';
import { saveCommandResult } from './result-recorder.js';
import { json, now, fail } from './core.js';
import { requireFounder, checkRateLimit } from './auth.js';
import { DASHBOARD_LIVE_SCRIPT } from './dashboard-live.js';

let _workerInit = false; let _lastHydrateTime = 0; const HYDRATE_COOLDOWN = 60000;
let _d1Failed = false; let _d1FailTime = 0; const D1_FAIL_COOLDOWN = 300000; // 5 min retry after D1 failure
async function hydrate(env) {
  if (_workerInit && (Date.now() - _lastHydrateTime) < HYDRATE_COOLDOWN) return;
  // If D1 previously failed, wait 5 min before retrying
  if (_d1Failed && (Date.now() - _d1FailTime) < D1_FAIL_COOLDOWN) {
    // Still initialize tools/agents (no D1 needed)
    if (!_workerInit) { ensureBuiltinTools(); seedAgents(); _workerInit = true; _lastHydrateTime = Date.now(); }
    return;
  }
  try {
    await ensureSchema(env);
    store.configure(env);
    if (!store.hydrated) await store.hydrate();
    _d1Failed = false; // D1 is working again
  } catch (d1Error) {
    console.warn('D1 unavailable, running in-memory mode:', d1Error?.message);
    _d1Failed = true; _d1FailTime = Date.now();
    // Configure store anyway — it works in-memory without D1
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const lightPath = url.pathname === "/api/health" || url.pathname === "/api/heartbeat" || url.pathname === "/api/cf/debug";
    if (!lightPath) await hydrate(env);

    // Founder commands are queued immediately. Execution is owned by the persistent scheduler,
    // so a long build can never turn into a false 60-second timeout response.
    if (request.method === 'POST' && url.pathname === '/api/command') {
      const limit = checkRateLimit(request);
      if (!limit.ok) return fail(limit.error, limit.status, { retryAfter: limit.retryAfter });
      const auth = requireFounder(request, env);
      if (!auth.ok) return fail(auth.error, auth.status);
      const body = await json(request);
      if (!body.command) return fail('Founder command is required', 400);

      try {
        const queued = await queueCommand(body.command, env);
        const payload = {
          runId: queued.runId,
          command: body.command,
          generatedAt: now(),
          result: queued
        };
        const saved = isIsolatedTestEnv(env)
          ? { saved: true, skipped: true, testMode: true }
          : await saveCommandResult(payload, env).catch(() => ({ saved: false }));

        if (queued.status === 'queued' && ctx?.waitUntil) {
          ctx.waitUntil(schedulerTick(env, { trigger: 'founder-command', runId: queued.runId }).catch(error => {
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
        ctx.waitUntil(schedulerTick(env, { trigger: 'approval-granted', approvalId: url.pathname.split('/').pop() }).catch(error => {
          store.addEvent('approval.scheduler_error', { approvalId: url.pathname.split('/').pop(), error: error?.message || 'Scheduler error after approval', at: now() });
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
        ctx.waitUntil(schedulerTick(env, { trigger: 'chat-message' }).catch(error => {
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
  },

  async scheduled(event, env, ctx) {
    await hydrate(env);
    const run = () => schedulerTick(env, { trigger: 'cloudflare-scheduled', scheduledTime: event?.scheduledTime ?? Date.now() });
    if (ctx?.waitUntil) ctx.waitUntil(run());
    else await run();
  }
};
