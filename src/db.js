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

export async function d1List(env, type) {
  const result = await env.DB.prepare('SELECT data FROM entities WHERE type = ? ORDER BY updated_at DESC').bind(type).all();
  return (result.results ?? []).map(row => JSON.parse(row.data));
}

export async function d1Put(env, type, value) {
  const now = new Date().toISOString();
  const item = { ...value, createdAt: value.createdAt ?? now, updatedAt: now };
  await env.DB.prepare(`INSERT INTO entities(type,id,data,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(type,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).bind(type, item.id, JSON.stringify(item), item.createdAt, now).run();
  return item;
}

export async function d1Events(env, limit = 50) {
  const result = await env.DB.prepare('SELECT id,type,payload,created_at FROM events ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  return (result.results ?? []).map(r => ({ id:r.id, type:r.type, payload:JSON.parse(r.payload), at:r.created_at }));
}

export async function d1Event(env, event) {
  await env.DB.prepare('INSERT INTO events(id,type,payload,created_at) VALUES(?,?,?,?)').bind(event.id,event.type,JSON.stringify(event.payload),event.at).run();
  return event;
}
