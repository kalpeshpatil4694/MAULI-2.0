export function hasD1(env) { return Boolean(env?.DB && typeof env.DB.prepare === 'function'); }

export async function ensureSchema(env) {
  if (!hasD1(env)) return false;
  const statements = [
    `CREATE TABLE IF NOT EXISTS entities (type TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(type,id))`,
    `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)`,
    `CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`
  ];
  for (const sql of statements) await env.DB.prepare(sql).run();
  return true;
}

function projectStateFromTasks(project, tasks) {
  const own = tasks.filter(t => t?.projectId === project?.id);
  if (!own.length) return project?.state ?? 'planning';
  if (own.some(t => t.state === 'failed')) return 'escalated';
  if (own.some(t => ['working', 'running', 'blocked', 'assigned'].includes(t.state))) return 'active';
  if (own.every(t => t.state === 'completed')) return 'completed';
  if (own.some(t => t.state === 'completed')) return 'active';
  return project?.state === 'completed' ? 'active' : (project?.state ?? 'planning');
}

export async function d1List(env, type) {
  const result = await env.DB.prepare('SELECT data FROM entities WHERE type = ? ORDER BY updated_at DESC').bind(type).all();
  const rows = (result.results ?? []).map(row => JSON.parse(row.data));
  if (type !== 'projects' || !rows.length) return rows;
  const taskResult = await env.DB.prepare('SELECT data FROM entities WHERE type = ?').bind('tasks').all();
  const tasks = (taskResult.results ?? []).map(row => JSON.parse(row.data));
  return rows.map(project => ({ ...project, state: projectStateFromTasks(project, tasks) }));
}

export async function d1Put(env, type, value, { critical = false } = {}) {
  const { canWriteD1, recordD1Write } = await import('./d1-quota.js');
  if (!canWriteD1(env, critical)) return { ...value, _d1WriteDeferred: true };
  const now = new Date().toISOString();
  const item = { ...value, createdAt: value.createdAt ?? now, updatedAt: now };
  const result = await env.DB.prepare(`INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).bind(type, item.id, JSON.stringify(item), item.createdAt, now).run();
  recordD1Write(env, Math.max(1, Number(result?.meta?.rows_written) || 1));
  return item;
}

export async function d1Events(env, limit = 50) {
  const result = await env.DB.prepare('SELECT id,type,payload,created_at FROM events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return (result.results ?? []).map(r => ({ id:r.id, type:r.type, payload:JSON.parse(r.payload), at:r.created_at }));
}

export async function d1Event(env, event, { critical = false } = {}) {
  const { canWriteD1, recordD1Write } = await import('./d1-quota.js');
  if (!canWriteD1(env, critical)) return { ...event, _d1WriteDeferred: true };
  const result = await env.DB.prepare('INSERT INTO events(id,type,payload,created_at) VALUES(?,?,?,?)').bind(event.id,event.type,JSON.stringify(event.payload),event.at).run();
  recordD1Write(env, Math.max(1, Number(result?.meta?.rows_written) || 1));
  return event;
}

export async function claimBuildVersion(env, projectId, buildId, branch, startedAt) {
  if (!hasD1(env)) return false;
  return d1Put(env, 'build_locks', { id: 'project:' + projectId, projectId, buildId, branch, startedAt, status: 'active' }, { critical: true });
}

export async function getBuildVersion(env, projectId) {
  if (!hasD1(env)) return null;
  const row = await env.DB.prepare('SELECT data FROM entities WHERE type = ? AND id = ? LIMIT 1').bind('build_locks', 'project:' + projectId).first();
  return row?.data ? JSON.parse(row.data) : null;
}

// ═══════════════════════════════════════════════════
// D1 Storage Usage & Cleanup (Free Tier Limits)
// ═══════════════════════════════════════════════════

// Cloudflare Free Tier Limits
const FREE_LIMITS = {
  d1DatabaseMB: 500,
  d1AccountMB: 5000,
  d1QueriesPerInvocation: 50,
  workersRequestsPerDay: 100000,
  workersCpuMs: 10,
  workersMemoryMB: 128,
  workersSubrequests: 50,
  workersSizeMB: 3,
  kvReadsPerDay: 100000,
  kvWritesPerDay: 1000,
  kvStorageMB: 25000,
};

/** Get D1 storage usage breakdown by entity type */
export async function getD1Usage(env) {
  if (!hasD1(env)) return { d1: false, types: [], totalBytes: 0, totalRows: 0 };
  try {
    const typeRows = await env.DB.prepare(
      'SELECT type, COUNT(*) as cnt, SUM(LENGTH(data)) as bytes FROM entities GROUP BY type ORDER BY bytes DESC'
    ).all();
    const types = (typeRows.results ?? []).map(r => ({
      type: r.type,
      count: r.cnt,
      bytes: r.bytes ?? 0,
      mb: ((r.bytes ?? 0) / 1048576).toFixed(2),
    }));
    const totalBytes = types.reduce((s, t) => s + t.bytes, 0);
    const totalRows = types.reduce((s, t) => s + t.count, 0);

    const eventCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM events').first();
    const eventBytes = await env.DB.prepare('SELECT COALESCE(SUM(LENGTH(payload)),0) as bytes FROM events').first();

    return {
      d1: true,
      types,
      events: { count: eventCount?.cnt ?? 0, bytes: eventBytes?.bytes ?? 0 },
      totalBytes,
      totalRows,
      totalMB: (totalBytes / 1048576).toFixed(2),
    };
  } catch (e) {
    return { d1: false, error: e.message, types: [], totalBytes: 0, totalRows: 0 };
  }
}

/** Get full usage report with limits */
export async function getUsageReport(env) {
  const d1 = await getD1Usage(env);
  const hasD1Conn = hasD1(env);
  const limits = FREE_LIMITS;

  return {
    limits,
    d1: {
      connected: hasD1Conn,
      usedMB: parseFloat(d1.totalMB ?? '0'),
      limitMB: limits.d1DatabaseMB,
      remainingMB: Math.max(0, limits.d1DatabaseMB - parseFloat(d1.totalMB ?? '0')).toFixed(2),
      pct: Math.min(100, (parseFloat(d1.totalMB ?? '0') / limits.d1DatabaseMB) * 100).toFixed(1),
      rows: d1.totalRows,
      events: d1.events,
      breakdown: d1.types,
    },
    workers: {
      requestsPerDay: limits.workersRequestsPerDay,
      cpuMs: limits.workersCpuMs,
      memoryMB: limits.workersMemoryMB,
      subrequests: limits.workersSubrequests,
      sizeMB: limits.workersSizeMB,
    },
    kv: {
      readsPerDay: limits.kvReadsPerDay,
      writesPerDay: limits.kvWritesPerDay,
      storageMB: limits.kvStorageMB,
    },
    account: {
      d1StorageMB: limits.d1AccountMB,
      d1Databases: 10,
    },
  };
}

/** Cleanup old data to free D1 storage */
export async function cleanupD1(env, options = {}) {
  if (!hasD1(env)) return { cleaned: false, reason: 'No D1 connection' };
  const { maxEvents = 500, deleteOldResults = true } = options;
  const results = {};

  // 1. Prune events (keep most recent N)
  try {
    const eventCount = await env.DB.prepare('SELECT COUNT(*) as cnt FROM events').first();
    const count = eventCount?.cnt ?? 0;
    if (count > maxEvents) {
      const toDelete = count - maxEvents;
      const oldEvents = await env.DB.prepare(
        'SELECT id FROM events ORDER BY created_at ASC LIMIT ?'
      ).bind(toDelete).all();
      if (oldEvents.results?.length) {
        const ids = oldEvents.results.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).bind(...ids).run();
        results.eventsPruned = ids.length;
      }
    } else {
      results.eventsPruned = 0;
    }
  } catch (e) { results.eventsError = e.message; }

  // 2. Delete old command_results (keep last 20)
  if (deleteOldResults) {
    try {
      const crCount = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM entities WHERE type = 'command_results'"
      ).first();
      const count = crCount?.cnt ?? 0;
      if (count > 20) {
        const toDelete = count - 20;
        const old = await env.DB.prepare(
          "SELECT id FROM entities WHERE type = 'command_results' ORDER BY updated_at ASC LIMIT ?"
        ).bind(toDelete).all();
        if (old.results?.length) {
          const ids = old.results.map(r => r.id);
          const placeholders = ids.map(() => '?').join(',');
          await env.DB.prepare(`DELETE FROM entities WHERE type = 'command_results' AND id IN (${placeholders})`).bind(...ids).run();
          results.resultsPruned = ids.length;
        }
      } else {
        results.resultsPruned = 0;
      }
    } catch (e) { results.resultsError = e.message; }
  }

  // 3. Delete old build records (keep last 10)
  try {
    const buildCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM entities WHERE type = 'builds'"
    ).first();
    const count = buildCount?.cnt ?? 0;
    if (count > 10) {
      const toDelete = count - 10;
      const old = await env.DB.prepare(
        "SELECT id FROM entities WHERE type = 'builds' ORDER BY updated_at ASC LIMIT ?"
      ).bind(toDelete).all();
      if (old.results?.length) {
        const ids = old.results.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM entities WHERE type = 'builds' AND id IN (${placeholders})`).bind(...ids).run();
        results.buildsPruned = ids.length;
      }
    } else {
      results.buildsPruned = 0;
    }
  } catch (e) { results.buildsError = e.message; }

  // 4. Compact old verifications (keep last 50)
  try {
    const vCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM entities WHERE type = 'verifications'"
    ).first();
    const count = vCount?.cnt ?? 0;
    if (count > 50) {
      const toDelete = count - 50;
      const old = await env.DB.prepare(
        "SELECT id FROM entities WHERE type = 'verifications' ORDER BY updated_at ASC LIMIT ?"
      ).bind(toDelete).all();
      if (old.results?.length) {
        const ids = old.results.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM entities WHERE type = 'verifications' AND id IN (${placeholders})`).bind(...ids).run();
        results.verificationsPruned = ids.length;
      }
    } else {
      results.verificationsPruned = 0;
    }
  } catch (e) { results.verificationsError = e.message; }

  // 5. Compact old runs (keep last 50)
  try {
    const rCount = await env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM entities WHERE type = 'runs'"
    ).first();
    const count = rCount?.cnt ?? 0;
    if (count > 50) {
      const toDelete = count - 50;
      const old = await env.DB.prepare(
        "SELECT id FROM entities WHERE type = 'runs' ORDER BY updated_at ASC LIMIT ?"
      ).bind(toDelete).all();
      if (old.results?.length) {
        const ids = old.results.map(r => r.id);
        const placeholders = ids.map(() => '?').join(',');
        await env.DB.prepare(`DELETE FROM entities WHERE type = 'runs' AND id IN (${placeholders})`).bind(...ids).run();
        results.runsPruned = ids.length;
      }
    } else {
      results.runsPruned = 0;
    }
  } catch (e) { results.runsError = e.message; }

  // Re-measure after cleanup
  const after = await getD1Usage(env);
  results.freedMB = (parseFloat(d1.totalMB ?? '0') - parseFloat(after.totalMB ?? '0')).toFixed(2);
  results.afterMB = after.totalMB;
  results.cleaned = true;
  return results;
}
