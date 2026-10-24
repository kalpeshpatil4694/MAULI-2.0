import { listTaskArtifacts, listProjectArtifacts } from './artifacts.js';

const handlers = new Map();
const permissions = new Map();

export function registerExecutor(name, handler, meta = {}) {
  if (!name || typeof handler !== 'function') throw new Error('Executor name and handler are required');
  handlers.set(name, { handler, ...meta });
}

export function listExecutors() {
  return [...handlers.entries()].map(([name, x]) => ({
    name,
    description: x.description ?? '',
    risk: x.risk ?? 'normal',
    capabilities: x.capabilities ?? []
  }));
}

export function getExecutor(name) {
  return handlers.get(name);
}

export function grantExecutor(name, scope = 'internal') {
  permissions.set(name, scope);
  return { name, scope };
}

export function getExecutorScope(name, fallback = 'internal') {
  return permissions.get(name) ?? fallback;
}

registerExecutor('internal.plan', async ({ task, callTool }) => {
  let diagnostics = { healthy: true };
  if (typeof callTool === 'function') {
    try {
      const health = await callTool('health.check', { type: 'planning-diagnostics' });
      if (health && typeof health === 'object') diagnostics = health;
    } catch (_) {}
  }
  return {
    type: 'plan',
    taskId: task?.id,
    output: 'Execution plan generated.',
    diagnostics,
    summary: String(task?.description || task?.title || 'Execution plan')
  };
}, {
  description: 'Safe internal planning executor',
  risk: 'low',
  scope: 'internal',
  capabilities: ['planning']
});
grantExecutor('internal.plan', 'internal');

registerExecutor('internal.verify-code', async ({ task }) => {
  // A review task (persistence/schema, security) produces no code of its own: the code it
  // judges is the one the project's generating task wrote. Looking only at THIS task's
  // artifacts made every review fail with "artifact_present: false" even though the app had
  // already been generated, so the review task failed its own acceptance and took the
  // project down with it. The task's own artifacts still win when it has any.
  const own = listTaskArtifacts(task?.id);
  const artifacts = own.length ? own : listProjectArtifacts(task?.projectId);
  const codeArtifacts = artifacts.filter(a => a.type === 'code-workspace');
  const checks = [
    { name: 'artifact_present', passed: codeArtifacts.length > 0 },
    { name: 'files_present', passed: codeArtifacts.some(a => Array.isArray(a.content?.files) && a.content.files.length > 0) },
    { name: 'artifact_content_valid', passed: codeArtifacts.some(a => {
      const files = a.content?.files;
      return Array.isArray(files) && files.every(f => f && typeof f.path === 'string' && typeof f.content === 'string');
    }) }
  ];
  const passed = checks.every(c => c.passed);
  return {
    type: 'verification',
    taskId: task?.id,
    passed,
    checks,
    artifactId: codeArtifacts[0]?.id ?? null,
    projectId: task?.projectId ?? null,
    fileCount: codeArtifacts.reduce((n, a) => n + (a.content?.files?.length ?? 0), 0),
    summary: passed ? 'Code artifact is present and structurally valid.' : 'Code verification failed: required artifact is missing or invalid.'
  };
}, {
  description: 'Verifies generated code artifacts without executing untrusted code',
  risk: 'low',
  scope: 'internal',
  capabilities: ['verification', 'quality-assurance']
});
grantExecutor('internal.verify-code', 'internal');
