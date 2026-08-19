import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

function normalizeOutput(value = '') {
  return String(value).slice(0, MAX_OUTPUT_BYTES);
}

export async function runCommand(command, args = [], options = {}) {
  if (!command || !Array.isArray(args)) throw new Error('Invalid execution request');
  const timeout = Math.min(Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      env: options.env ? { ...process.env, ...options.env } : process.env
    });
    return {
      success: true,
      exitCode: 0,
      stdout: normalizeOutput(result.stdout),
      stderr: normalizeOutput(result.stderr),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      success: false,
      exitCode: Number.isInteger(error.code) ? error.code : 1,
      stdout: normalizeOutput(error.stdout),
      stderr: normalizeOutput(error.stderr || error.message),
      timedOut: error.killed === true,
      durationMs: Date.now() - startedAt
    };
  }
}

export async function runNodeTest(testArgs = [], options = {}) {
  return runCommand(process.execPath, ['--test', ...testArgs], options);
}

export function executionPolicy(options = {}) {
  return {
    adapter: options.adapter ?? 'node-local',
    timeoutMs: Math.min(Number(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), DEFAULT_TIMEOUT_MS),
    shell: false,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    network: options.network === true ? 'requested' : 'disabled-by-default'
  };
}
