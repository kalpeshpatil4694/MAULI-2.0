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
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Secrets must never appear in a deployment record, a log line or an API response.
const WRANGLER_BIN = join(process.cwd(), 'node_modules', '.bin', 'wrangler');

function wranglerCommand() {
  if (!existsSync(WRANGLER_BIN)) throw new Error('the deploy executor has no local pinned Wrangler binary; run npm ci in the executor environment');
  return WRANGLER_BIN;
}

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
    const rootAbs = resolve(root);
    const target = resolve(rootAbs, file.path);
    const rel = relative(rootAbs, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    written += 1;
  }
  return written;
}

/**
 * Provision (or find) the D1 database the generated wrangler config declares, and write its
 * id back. A generated project that declares a database it does not have fails on its first
 * query, so this is part of deploying, not an optional extra.
 *
 * It REUSES an existing database of that name rather than creating a second one. Deploying
 * the same product again is normal — after a repair, or on the next CI run — and "a database
 * with that name already exists" is not a product failure, it is this function having no
 * memory. Reusing also keeps a repaired deployment pointed at the same data, which is what
 * a redeploy means.
 */
async function provisionDatabase(root, databaseName) {
  const listed = await run(wranglerCommand(), ['d1', 'list', '--json'], { cwd: root });
  let existingId = null;
  if (listed.code === 0) {
    try {
      const list = JSON.parse(listed.stdout);
      const hit = (Array.isArray(list) ? list : []).find((d) => d?.name === databaseName);
      existingId = hit?.uuid ?? hit?.database_id ?? null;
    } catch (_) { existingId = null; }
  }
  let databaseId = existingId;
  if (!databaseId) {
    const created = await run(wranglerCommand(), ['d1', 'create', databaseName], { cwd: root });
    if (created.code !== 0) return { ok: false, message: redact(created.stderr || created.stdout) };
    databaseId = /database_id\s*=\s*"?([0-9a-f-]{32,})"?/i.exec(`${created.stdout}\n${created.stderr}`)?.[1]
      ?? /"database_id"\s*:\s*"([0-9a-f-]{32,})"/i.exec(created.stdout)?.[1]
      ?? null;
    if (!databaseId) return { ok: false, message: 'wrangler created the database but reported no database_id to bind' };
  }
  const configPath = join(root, 'wrangler.jsonc');
  const config = await readFile(configPath, 'utf8').catch(() => null);
  if (config === null) return { ok: true, databaseId, reused: Boolean(existingId) };
  await writeFile(configPath, config.replace(/("database_id"\s*:\s*)"[^"]*"/i, `$1"${databaseId}"`), 'utf8');
  return { ok: true, databaseId, reused: Boolean(existingId) };
}

/**
 * Wait until the URL wrangler just created actually SERVES this project.
 *
 * `wrangler deploy` returning success means the version was uploaded, not that the edge is
 * already answering with it. Probing too early reads the previous version — or nothing — and
 * reports a working deployment as broken. Two things are therefore asserted before any
 * acceptance is allowed to run:
 *
 *   * the deployment answers at all (real HTTP over the real hostname), and
 *   * its bindings are this project's own, checked through the product's own routes.
 *
 * The binding check is the important half. A Worker that answers `501` on `/api/live` is not a
 * product failure — it is a Durable Object binding that was never deployed, which is a
 * deployment defect. Reading it as a product FAIL sends the founder looking at their app for
 * a bug that Cloudflare has.
 */
export async function waitForDeployment(url, { requiresRealtime = false, attempts = 20, intervalMs = 3000 } = {}) {
  // A 200 from `fetch` proves nothing about WHO answered. A freshly created workers.dev
  // subdomain is reachable at the edge before the route is serving, and Cloudflare answers
  // that window with its OWN error page: a real HTTP response, a real 404, and not the
  // application at all. The first version of this wait accepted any response and therefore
  // accepted Cloudflare's 404 as proof of a healthy deployment — the acceptance run then
  // probed an application that was not there and reported 404 on every one of its routes.
  //
  // Readiness is therefore the APPLICATION answering: `/api/health` must return the
  // generated app's own JSON, which carries its `service` name. An HTML error page, an empty
  // body or a missing `ok` field is not a deployment and the wait keeps polling.
  const probe = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(`${String(url).replace(/\/+$/, '')}/api/health`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      const body = await res.text().catch(() => '');
      let json = null;
      try { json = JSON.parse(body); } catch (_) { json = null; }
      const ours = res.ok && json !== null && json.ok === true && typeof json.service === 'string';
      return {
        reached: ours,
        status: res.status,
        service: ours ? json.service : null,
        body: ours ? '' : redact(body.slice(0, 120))
      };
    } finally { clearTimeout(timer); }
  };
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await probe().catch((error) => ({ reached: false, status: 0, body: redact(error?.message ?? error) }));
    if (last.reached) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (!last?.reached) {
    return {
      ready: false,
      reason: `the deployment at ${url} did not serve its own /api/health within ${(attempts * intervalMs) / 1000}s (last answer: HTTP ${last?.status ?? 0}${last?.body ? ` — ${last.body}` : ''}). An HTTP response that is not the generated app's JSON means the edge is serving its error page, not this project.`
    };
  }
  if (!requiresRealtime) return { ready: true, status: last.status, service: last.service };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const live = await fetch(`${String(url).replace(/\/+$/, '')}/api/live`, { signal: controller.signal });
    if (live.status === 501) {
      return {
        ready: false,
        reason: 'the deployed Worker has no LIVE Durable Object binding, so a product whose specification requires live updates cannot work. This is a deployment defect (errorCategory "deployment"), not a product failure.'
      };
    }
    return { ready: true, status: last.status, service: last.service, liveStatus: live.status };
  } catch (error) {
    return { ready: true, status: last.status, service: last.service, liveStatus: 0, liveWarning: redact(error?.message ?? error) };
  } finally { clearTimeout(timer); }
}

/**
 * Build and deploy ONE generated project. Returns a deployment record — never a boolean and
 * never a URL that was not produced by a real `wrangler deploy`.
 */
export async function deployGeneratedProject({ projectId = null, files = [], artifactId = null, environment = 'production', requiresRealtime = false, waitForReady = true } = {}) {
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
  const safe = String(projectId ?? 'project').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  try {
    const written = await stageProject(list, { root });
    if (!written) {
      return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: 'build', errorMessage: 'no file could be staged from the generated project' } };
    }
    // Each project gets its OWN Worker name. Two generated products can share a record
    // noun ("order", "entry"), and a shared name would let the second deployment silently
    // replace the first project's URL — which is precisely the identity failure the whole
    // deployment contract exists to prevent.
    if (projectId) {
      const configPath = join(root, 'wrangler.jsonc');
      const config = await readFile(configPath, 'utf8').catch(() => null);
      if (config) {
        // Every generated project gets its own Worker AND its own D1 database. Reusing a
        // database by entity name (for example generated_order) would let two unrelated
        // Founder commands see each other's rows. The name is deterministic so redeploys
        // of the same project reuse the same database and preserve its data.
        const workerName = `generated-${safe}`.slice(0, 63);
        const databaseName = `generated-${safe}`.slice(0, 63);
        // Kept in scope for the deploy log below.
        const rewritten = config
          .replace(/("name"\s*:\s*)"[^"]*"/i, `$1"${workerName}"`)
          .replace(/("database_name"\s*:\s*)"[^"]*"/i, `$1"${databaseName}"`);
        await writeFile(configPath, rewritten, 'utf8');
      }
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
    const validation = await run(wranglerCommand(), ['deploy', '--dry-run'], { cwd: root });
    if (validation.code !== 0) {
      return { deployment: { ...base, status: 'FAILED', url: null, deploymentId: null, errorCategory: categorize(validation.stderr, validation.stdout), errorMessage: `wrangler validation failed before deployment: ${redact(validation.stderr || validation.stdout)}` } };
    }
    // `wrangler deploy` — NOT `--json`. That flag does not exist in the wrangler this
    // repository pins, and passing it failed the deployment with "Unknown argument: json",
    // which is exactly the kind of infrastructure error that must not be read as a product
    // failure. The real URL and version id are read out of wrangler's own output.
    const deployed = await run(wranglerCommand(), ['deploy'], { cwd: root });
    // wrangler's own output is the only account of what Cloudflare actually did — which
    // bindings it accepted, which version it published. The executor used to keep it to
    // itself, so a deployment that "succeeded" while quietly dropping a Durable Object
    // binding produced no evidence anywhere and the only symptom was a 501 at runtime.
    // Redacted before it is ever printed; secrets are never written to a CI log.
    const deployLog = redact([deployed.stdout, deployed.stderr].filter(Boolean).join('\n'));
    if (process.env.MAULI_DEPLOY_VERBOSE !== '0') console.error(`[deploy-executor] ${safe}\n${deployLog}`);
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
    const deploymentId = result.deployment_id ?? result.version_id ?? result.id
      ?? /Current Version ID:\s*([0-9a-f-]{16,})/i.exec(output)?.[1] ?? null;
    const finalUrl = String(url).replace(/\/+$/, '');

    // Do not hand a URL to the acceptance runner until the edge is really serving THIS
    // version. Without this wait, the acceptance probes whatever the previous deployment
    // left behind — the failure mode that made three different products report one another's
    // defects.
    if (waitForReady) {
      const ready = await waitForDeployment(finalUrl, { requiresRealtime });
      if (!ready.ready) {
        return {
          deployment: {
            ...base, status: 'FAILED', url: finalUrl, deploymentId,
            errorCategory: 'deployment',
            errorMessage: ready.reason,
            deployedAt: new Date().toISOString(),
            environment: result.environment ?? environment
          }
        };
      }
    }
    return {
      deployment: {
        ...base,
        status: 'DEPLOYED',
        url: finalUrl,
        deploymentId,
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
        environment: payload.environment ?? 'production',
        requiresRealtime: payload.requiresRealtime === true
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
