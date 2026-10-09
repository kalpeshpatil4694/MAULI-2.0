// The production founder-command endpoint — the ONLY implementation of POST /api/command.
//
// Why this is its own module: it used to live inline in src/worker.js, and worker.js cannot be
// imported under Node because it re-exports the Durable Object from execution-coordinator.js,
// which imports the `cloudflare:workers` built-in. No test could therefore call the real
// endpoint, and the suite instead drove src/index.js's *synchronous* handler — a different
// implementation with a different status code (201 vs 202), a different rate-limit scope
// (checkCommandRateLimit('command') vs the default bucket) and no scheduler hand-off. That is
// how a green suite and a working deployment could describe different programs.
//
// Keeping the endpoint in a plain module means there is one production implementation and the
// tests exercise it directly rather than a look-alike.
import { now, fail, json } from './core.js';
import { requireFounder, checkRateLimit } from './auth.js';
import { PLATFORMS, normalizePlatform, resolvePlatform } from './platforms.js';
import { queueCommand } from './orchestrator.js';
import { saveCommandResult } from './result-recorder.js';
import { schedulerTick } from './scheduler.js';
import { store } from './store.js';

export function isIsolatedTestEnv(env) {
  return env?.SKIP_RESULT_PERSISTENCE === true || env?.SKIP_RESULT_PERSISTENCE === 'true'
    || env?.MAULI_TEST_MODE === true || env?.MAULI_TEST_MODE === 'true';
}

export async function handleFounderCommand(request, env, ctx) {
  const limit = checkRateLimit(request);
  if (!limit.ok) return fail(limit.error, limit.status, { retryAfter: limit.retryAfter });
  const auth = requireFounder(request, env);
  if (!auth.ok) return fail(auth.error, auth.status);
  const body = await json(request);
  if (!body.command) return fail('Founder command is required', 400);
  // An unbuildable target is reported rather than quietly swapped for another one: a founder
  // who asked for Android must never be handed a web build that reports success.
  if (body.platform !== undefined && body.platform !== null && body.platform !== '' && !normalizePlatform(body.platform)) {
    return fail(`Unsupported platform: ${body.platform}. Supported: ${PLATFORMS.map(p => p.id).join(', ')}`, 400);
  }
  const target = resolvePlatform(body.platform, body.command);

  try {
    // Hand over what the founder actually sent, not the value already resolved from it.
    // Passing the resolved id back in made queueCommand re-resolve it and report
    // source:'explicit' for a command that named no platform at all.
    const queued = await queueCommand(body.command, env, { platform: body.platform });
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
      // ctx.waitUntil only extends the invocation 30 s past the response (Cloudflare limit),
      // so the drain gets a 20 s budget: tasks that do not fit stay queued and the cron
      // scheduler finishes them instead of being cancelled mid-run.
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
