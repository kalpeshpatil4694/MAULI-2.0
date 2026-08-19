import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { registerExecutionAdapter } from './execution-adapter.js';

const execFileAsync = promisify(execFile);

function safePath(root, relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) throw new Error(`Unsafe artifact path: ${relativePath}`);
  const full = join(root, normalized);
  if (!full.startsWith(`${root}/`)) throw new Error(`Unsafe artifact path: ${relativePath}`);
  return full;
}

export function localRunnerAvailable() {
  return typeof process !== 'undefined' && process.versions?.node;
}

export async function runLocalArtifact({ artifact, command = 'node', args = [], timeoutMs = 10000 } = {}) {
  if (!artifact || !Array.isArray(artifact.content?.files)) throw new Error('A code artifact with files is required');
  const root = await mkdtemp(join(tmpdir(), 'mauli-l1-'));
  try {
    for (const file of artifact.content.files) {
      const path = safePath(root, file.path);
      await mkdirForFile(path);
      await writeFile(path, file.content, 'utf8');
    }
    const result = await execFileAsync(command, args, { cwd: root, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    return { adapter: 'local-node', status: 'accepted', executed: true, exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { adapter: 'local-node', status: 'failed', executed: true, exitCode: Number.isInteger(error.code) ? error.code : 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '', error: error.message };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function mkdirForFile(path) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
}

registerExecutionAdapter('local-node', {
  capabilities: ['node-execution', 'test-execution', 'zero-cost-local'],
  cost: 'zero',
  available: () => localRunnerAvailable(),
  execute: runLocalArtifact
});
