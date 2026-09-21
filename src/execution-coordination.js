export async function withProjectExecutionLock(env, projectId, fn, options = {}) {
  if (!env?.MAULI_PROJECT_EXECUTOR || !projectId) return fn({ coordinated: false });
  const id = env.MAULI_PROJECT_EXECUTOR.idFromName(String(projectId));
  const stub = env.MAULI_PROJECT_EXECUTOR.get(id);
  const acquired = await stub.acquire(options.leaseMs ?? 90000);
  if (!acquired?.granted) return { status: 'coordinator-busy', projectId, busyUntil: acquired.busyUntil ?? null };
  try {
    return await fn({ coordinated: true, leaseUntil: acquired.busyUntil });
  } finally {
    await stub.release(acquired.token).catch(() => null);
  }
}

export async function projectExecutionStatus(env, projectId) {
  if (!env?.MAULI_PROJECT_EXECUTOR || !projectId) return { enabled: false };
  const stub = env.MAULI_PROJECT_EXECUTOR.get(env.MAULI_PROJECT_EXECUTOR.idFromName(String(projectId)));
  return { enabled: true, projectId, ...(await stub.status()) };
}
