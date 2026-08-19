import { runCommand, runNodeTest } from './code-execution-adapter.js';
import { registerExecutionAdapter } from './execution-adapter.js';

export function registerLocalCodeExecutionAdapter() {
  return registerExecutionAdapter('node-local', {
    capabilities: ['node', 'javascript', 'testing', 'code-execution'],
    cost: 'zero',
    available: () => true,
    execute: async ({ artifact, task, cwd }) => {
      const files = Array.isArray(artifact?.content?.files) ? artifact.content.files : [];
      if (!files.length) return { adapter: 'node-local', status: 'rejected', executed: false, reason: 'No files to execute' };
      const testArgs = Array.isArray(artifact.content?.tests) ? artifact.content.tests : [];
      if (!testArgs.length) return { adapter: 'node-local', status: 'accepted', executed: false, reason: 'No executable test command supplied' };
      const result = await runNodeTest(testArgs, { cwd });
      return { adapter: 'node-local', status: result.success ? 'passed' : 'failed', executed: true, taskId: task?.id, ...result };
    }
  });
}

export async function runLocalCommand(command, args = [], options = {}) {
  return runCommand(command, args, options);
}
