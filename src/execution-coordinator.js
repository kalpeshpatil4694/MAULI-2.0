import { DurableObject } from "cloudflare:workers";

/**
 * MAULI 2.0 — per-project execution coordinator.
 * The Worker remains stateless; this object is the single durable gate for one
 * project's scheduler execution. It prevents a command-triggered scheduler,
 * approval trigger, dashboard retry, or cron invocation from executing the same
 * project concurrently across different Worker isolates.
 */
export class MauliProjectExecutionCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS coordinator_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          token TEXT,
          busy_until INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0
        )
      `);
      const row = this.ctx.storage.sql.exec("SELECT id FROM coordinator_lock WHERE id=1").toArray()[0];
      if (!row) this.ctx.storage.sql.exec("INSERT INTO coordinator_lock(id, token, busy_until, updated_at) VALUES(1, NULL, 0, 0)");
    });
  }

  acquire(leaseMs = 90000) {
    const now = Date.now();
    const row = this.ctx.storage.sql.exec("SELECT token, busy_until FROM coordinator_lock WHERE id=1").toArray()[0];
    if (row && Number(row.busy_until) > now) {
      return { granted: false, busyUntil: Number(row.busy_until) };
    }
    const token = crypto.randomUUID();
    const until = now + Math.max(5000, Math.min(120000, Number(leaseMs) || 90000));
    this.ctx.storage.sql.exec(
      "UPDATE coordinator_lock SET token=?, busy_until=?, updated_at=? WHERE id=1",
      token, until, now
    );
    return { granted: true, token, busyUntil: until };
  }

  release(token) {
    if (!token) return { released: false };
    const row = this.ctx.storage.sql.exec("SELECT token FROM coordinator_lock WHERE id=1").toArray()[0];
    if (!row || row.token !== token) return { released: false };
    this.ctx.storage.sql.exec("UPDATE coordinator_lock SET token=NULL, busy_until=0, updated_at=? WHERE id=1", Date.now());
    return { released: true };
  }

  status() {
    const row = this.ctx.storage.sql.exec("SELECT token, busy_until, updated_at FROM coordinator_lock WHERE id=1").toArray()[0];
    return { busy: Boolean(row && Number(row.busy_until) > Date.now()), busyUntil: Number(row?.busy_until || 0), updatedAt: Number(row?.updated_at || 0) };
  }
}
