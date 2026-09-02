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
import { json, now, ok, fail } from './core.js';
import { requireFounder, checkRateLimit } from './auth.js';

async function hydrate(env) {
  await ensureSchema(env);
  store.configure(env);
  if (!store.hydrated) await store.hydrate();
  ensureBuiltinTools();
  seedAgents();
}

function isIsolatedTestEnv(env) {
  return env?.SKIP_RESULT_PERSISTENCE === true || env?.SKIP_RESULT_PERSISTENCE === 'true' || env?.MAULI_TEST_MODE === true || env?.MAULI_TEST_MODE === 'true';
}

export default {
  async fetch(request, env, ctx) {
    await hydrate(env);
    const url = new URL(request.url);

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

        return ok({
          result: { ...queued, status: queued.status, execution: 'scheduler' },
          runId: queued.runId,
          resultFile: saved
        }, 202);
      } catch (error) {
        return ok({ result: { status: 'error', error: error?.message || 'Command queue failed', command: body.command } }, 500);
      }
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    await hydrate(env);
    const run = () => schedulerTick(env, { trigger: 'cloudflare-scheduled', scheduledTime: event?.scheduledTime ?? Date.now() });
    if (ctx?.waitUntil) ctx.waitUntil(run());
    else await run();
  }
};
