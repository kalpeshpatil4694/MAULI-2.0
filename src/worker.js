// MAULI 2.0 — production Worker entrypoint.
// HTTP remains owned by index.js; scheduled execution is owned by the persistent scheduler.

import app from './index.js';
import { ensureSchema } from './db.js';
import { store } from './store.js';
import { ensureBuiltinTools } from './tools.js';
import { seedAgents } from './agents.js';
import { schedulerTick } from './scheduler.js';

async function hydrate(env) {
  await ensureSchema(env);
  store.configure(env);
  if (!store.hydrated) await store.hydrate();
  ensureBuiltinTools();
  seedAgents();
}

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    await hydrate(env);
    const run = () => schedulerTick(env, { trigger: 'cloudflare-scheduled', scheduledTime: event?.scheduledTime ?? Date.now() });
    if (ctx?.waitUntil) ctx.waitUntil(run());
    else await run();
  }
};
