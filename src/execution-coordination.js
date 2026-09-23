export async function withProjectExecutionLock(env, projectId, fn, options = {}) {
  if (!env?.MAULI_PROJECT_EXECUTOR || !projectId) return fn({ coordinated: false });
  const id = env.MAULI_PROJECT_EXECUTOR.idFromName(String(projectId));
  const stub = env.MAULI_PROJECT_EXECUTOR.get(id);
  const leaseMs = options.leaseMs ?? 120000;
  const acquired = await stub.acquire(leaseMs);
  if (!acquired?.granted) return { status: 'coordinator-busy', projectId, busyUntil: acquired.busyUntil ?? null };
  const heartbeatMs = options.heartbeatMs ?? Math.max(10000, Math.min(30000, Math.floor(leaseMs / 3)));
  const heartbeat = setInterval(() => {
    stub.renew(acquired.token, leaseMs).catch(() => null);
  }, heartbeatMs);
  try {
    return await fn({ coordinated: true, leaseUntil: acquired.busyUntil, leaseHeartbeatMs: heartbeatMs });
  } finally {
    clearInterval(heartbeat);
    await stub.release(acquired.token).catch(() => null);
  }
}

export async function projectExecutionStatus(env, projectId) {
  if (!env?.MAULI_PROJECT_EXECUTOR || !projectId) return { enabled: false };
  const stub = env.MAULI_PROJECT_EXECUTOR.get(env.MAULI_PROJECT_EXECUTOR.idFromName(String(projectId)));
  return { enabled: true, projectId, ...(await stub.status()) };
}
