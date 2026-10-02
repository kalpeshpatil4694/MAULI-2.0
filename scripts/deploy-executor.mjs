#!/usr/bin/env node
// MAULI 2.0 — THE DEPLOYMENT EXECUTOR.
//
// MAULI's Worker cannot run wrangler, so `MAULI_DEPLOY_EXECUTOR` names a runner that can.
// This is that runner: it receives a generated project's real files, builds it, provisions
// the D1 database its own wrangler config declares, deploys it with wrangler, and answers
// with the deployment Cloudflare actually performed.
//
// It never invents a URL. There are exactly three honest outcomes:
//   * a real deployment → DEPLOYED with the URL, deployment id, version and timestamp
//   * a real failure    → FAILED with a categorised, secret-free message
//   * no credentials    → FAILED with the `credentials` category, never a fake success
//
// The token is read from the environment and passed to wrangler through the process
// environment only. It is never logged, never echoed into an error, and never returned.
//
// Usage:
//   node scripts/deploy-executor.mjs                     # listen on MAULI_DEPLOY_PORT (8788)
//   node scripts/deploy-executor.mjs --once <file.json> # deploy one payload and print JSON

import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Secrets must never appear in a deployment record, a log line or an API response.
const SECRET_VALUE_RE = /(?:bearer\s+)[A-Za-z0-9._~+/=-]{8,}|\b[A-Za-z0-9_-]{32,}\b|(?:token|key|secret|password)\s*[=:]\s*\S+/gi;
export function redact(value) {
  return String(value ?? '').replace(SECRET_VALUE_RE, '[redacted]').slice(0, 400);
}

function run(command, args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, 300000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: String(error?.message ?? error) }); });
  });
}

/** Which category a wrangler failure belongs to — credentials, quota, build or deployment. */
export function categorize(stderr, stdout) {
  const raw = `${stderr ?? ''}\n${stdout ?? ''}`;
  if (/authentication|unauthorized|invalid[_ -]?token|api[_ -]?token|permission|forbidden|not authenticated/i.test(raw)) return 'credentials';
  if (/quota|limit exceeded|rate limit|insufficient|allowance|too many requests/i.test(raw)) return 'quota';
  if (/parse|syntax|unexpected (token|identifier)|bundl|esbuild|ts\d{4}|could not resolve/i.test(raw)) return 'build';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(raw)) return 'network';
  return 'deployment';
}

/** Write the generated project's files into a throwaway build directory. */
export async function stageProject(files, { root }) {
  await mkdir(root, { recursive: true });
  let written = 0;
  for (const file of files ?? []) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
    // A generated path must stay inside the staging directory; a `../` in a filename is a
    // traversal attempt, not a file layout.
    const target = join(root, file.path);
    if (!target.startsWith(root)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    written += 1;
  }
  return written;
}

/**
 * Provision the D1 database the generated wrangler config declares, and write its id back.
 * A generated project that declares a database it does not have fails on its first query,
 * so this is part of deploying, not an optional extra.
 */
async function provisionDatabase(root, databaseName) {
  const created = await run('npx', ['--yes', 'wrangler', 'd1', 'create', databaseName], { cwd: root });
  if (created.code !== 0) return { ok: false, message: redact(created.stderr || created.stdout) };
  const match = /database_id\s*=\s*"?([0-9a-f-]{32,})"?/i.exec(`${created.stdout}\n${created.stderr}`)
    ?? /"database_id"\s*:\s*"([0-9a-f-]{32,})"/i.exec(created.stdout);
  if (!match) return { ok: false, message: 'wrangler created the database but reported no database_id to bind' };
  const configPath = join(root, 'wrangler.jsonc');
  const config = await readFile(configPath, 'utf8').catch(() => null);
  if (config === null) return { ok: true, databaseId: match[1] };
  await writeFile(configPath, config.replace(/("database_id"\s*:\s*)"[^"]*"/i, `$1"${match[1]}"`), 'utf8');
  return { ok: true, databaseId: match[1] };
}

/**
 * Build and deploy ONE generated project. Returns a deployment record — never a boolean and
 * never a URL that was not produced by a real `wrangler deploy`.
 */
export async function deployGeneratedProject({ projectId = null, files = [], artifactId = null, environment = 'production' } = {}) {
  const startedAt = new Date().toISOString();
  const commit = process.env.GIT_COMMIT ?? process.env.GITHUB_SHA ?? null;
  const base = { projectId, artifactId, commit, environment, deployedAt: startedAt, attemptedAt: startedAt };
  const list = (files ?? []).filter((f) => f && typeof f.path === 'string' && typeof f.content === 'string');
  if (!list.length) {
    return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: 'build', errorMessage: 'the deploy request carried no generated files' } };
  }
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    return {
      deployment: {
        ...base, status: 'FAILED', url: null, deploymentId: null,
        errorCategory: 'credentials',
        errorMessage: 'CLOUDFLARE_API_TOKEN is not configured for the deploy executor, so no deployment can be performed (DEPENDENCY_REQUIRED)'
      }
    };
  }
  const root = await mkdtemp(join(tmpdir(), `mauli-deploy-${randomUUID().slice(0, 8)}-`));
  try {
    const written = await stageProject(list, { root });
    if (!written) {
      return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: 'build', errorMessage: 'no file could be staged from the generated project' } };
    }
    const config = await readFile(join(root, 'wrangler.jsonc'), 'utf8').catch(() => null);
    const dbName = /"database_name"\s*:\s*"([^"]+)"/i.exec(config ?? '')?.[1] ?? null;
    const needsDb = Boolean(dbName) && !/"database_id"\s*:\s*"[0-9a-f-]{8,}"/i.test(config ?? '');
    if (needsDb) {
      const db = await provisionDatabase(root, dbName);
      if (!db.ok) {
        return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: categorize(db.message, ''), errorMessage: `the generated project's D1 database could not be provisioned: ${db.message}` } };
      }
    }
    const validation = await run('npx', ['--yes', 'wrangler', 'deploy', '--dry-run'], { cwd: root });
    if (validation.code !== 0) {
      return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: categorize(validation.stderr, validation.stdout), errorMessage: `wrangler validation failed before deployment: ${redact(validation.stderr || validation.stdout)}` } };
    }
    // `wrangler deploy` — NOT `--json`. That flag does not exist in the wrangler this
    // repository pins, and passing it failed the deployment with "Unknown argument: json",
    // which is exactly the kind of infrastructure error that must not be read as a product
    // failure. The real URL and version id are read out of wrangler's own output.
    const deployed = await run('npx', ['--yes', 'wrangler', 'deploy'], { cwd: root });
    if (deployed.code !== 0) {
      return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: categorize(deployed.stderr, deployed.stdout), errorMessage: redact(deployed.stderr || deployed.stdout) } };
    }
    let parsed = null;
    try { parsed = JSON.parse(deployed.stdout); } catch (_) { parsed = null; }
    const result = parsed?.result ?? parsed ?? {};
    const output = `${deployed.stdout}\n${deployed.stderr}`;
    const url = result.url ?? /https:\/\/[^\s"']+\.workers\.dev/.exec(output)?.[0] ?? null;
    if (!url) {
      return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: 'deployment', errorMessage: 'wrangler reported success without a deployment URL, so there is nothing to run an acceptance against' } };
    }
    return {
      deployment: {
        ...base,
        status: 'DEPLOYED',
        url: String(url).replace(/\/+$/, ''),
        deploymentId: result.deployment_id ?? result.version_id ?? result.id
          ?? /Current Version ID:\s*([0-9a-f-]{16,})/i.exec(output)?.[1] ?? null,
        deployedAt: new Date().toISOString(),
        environment: result.environment ?? environment
      }
    };
  } catch (error) {
    return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: 'deployment', errorMessage: redact(error?.message ?? error) } };
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

/** The HTTP surface MAULI_DEPLOY_EXECUTOR points at. */
export function createDeployExecutorServer({ token = null } = {}) {
  return createServer((req, res) => {
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'mauli-deploy-executor', configured: Boolean(process.env.CLOUDFLARE_API_TOKEN) });
    if (req.method !== 'POST') return send(405, { error: 'POST the generated project to this endpoint' });
    // The executor builds and deploys other people's code; it must be callable only by the
    // control plane that holds its token.
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let payload = null;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return send(400, { error: 'the request body is not valid JSON' }); }
      const out = await deployGeneratedProject({
        projectId: payload.projectId ?? null,
        files: payload.files ?? [],
        artifactId: payload.artifactId ?? null,
        environment: payload.environment ?? 'production'
      });
      return send(out.deployment.status === 'DEPLOYED' ? 200 : 502, { deployment: out.deployment, error: out.deployment.errorMessage ?? null });
    });
  });
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  if (process.argv.includes('--once')) {
    const file = process.argv[process.argv.indexOf('--once') + 1];
    if (!file) { console.error('--once requires a JSON payload file'); process.exit(2); }
    const { readFileSync } = await import('node:fs');
    const payload = JSON.parse(readFileSync(file, 'utf8'));
    const out = await deployGeneratedProject(payload);
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.deployment.status === 'DEPLOYED' ? 0 : 1);
  } else {
    const port = Number(process.env.MAULI_DEPLOY_PORT ?? 8788);
    createDeployExecutorServer({ token: process.env.MAULI_DEPLOY_EXECUTOR_TOKEN ?? null }).listen(port, '0.0.0.0', () => {
      console.log(`MAULI deploy executor listening on :${port} (wrangler credentials: ${process.env.CLOUDFLARE_API_TOKEN ? 'present' : 'MISSING — every deployment will be BLOCKED'})`);
    });
  }
}

export default deployGeneratedProject;
