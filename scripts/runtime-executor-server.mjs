#!/usr/bin/env node
// MAULI 2.0 — THE RUNTIME EXECUTOR.
//
// MAULI's Worker cannot execute generated code, so `MAULI_RUNTIME_EXECUTOR` names a runner
// that can. This is that runner: it takes a generated project's files, its specification,
// and — above all — the deployment URL the deploy executor actually produced, and drives
// that URL over real network HTTP.
//
// It is NOT a second test system and NOT a mock. Every request it issues goes over the wire
// to the deployment; the response the evidence reports is the response the deployment gave.
// A request without a deployment URL is refused rather than quietly run in-process, because
// running the source in the runner's own memory proves the runner works, not the product.
//
// Usage:
//   node scripts/runtime-executor-server.mjs                # listen on MAULI_RUNTIME_PORT (8789)
//   node scripts/runtime-executor-server.mjs --once <file>  # run one payload and print JSON

import { createServer } from 'node:http';
import { runProductionRuntimeAcceptance } from './production-runtime.mjs';
import { normalizeDeployment } from '../src/generated-deployment.js';

const CONTROL_PLANE_HOSTS = () => new Set(
  (process.env.MAULI_CONTROL_PLANE_URLS ?? process.env.MAULI_BASE_URL ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean).map((s) => { try { return new URL(s).host.toLowerCase(); } catch { return null; } })
    .filter(Boolean)
);

/**
 * Refuse a run that is pointed at MAULI's own control plane or at nothing at all.
 * Point 3: the generated application's runtime URL is never the control plane, and a run
 * with no URL would be executed from source — which is a fixture, not production proof.
 *
 * The control-plane list is read on EVERY call, not once at import: this is a long-running
 * service and a snapshot taken at startup goes stale the moment the deployment's own URL
 * is configured or changed.
 */
export function assertRealTarget(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return { ok: false, reason: 'no deployment URL was supplied, so there is no deployed application to run the acceptance against (running the source instead would be a fixture, not production evidence)' };
  }
  const host = new URL(String(url)).host.toLowerCase();
  if (CONTROL_PLANE_HOSTS().has(host)) {
    return { ok: false, reason: `${url} is MAULI's own control-plane URL, not the generated application's runtime URL` };
  }
  return { ok: true };
}

/**
 * Run one acceptance against a real deployment. Returns the structured report the gate
 * judges, or an explicit refusal explaining why nothing could be run.
 */
export async function runAcceptanceAgainst(payload = {}) {
  const deployment = normalizeDeployment(payload.deployment ?? null);
  const target = assertRuntimeTarget(deployment);
  if (!target.ok) return { refused: true, reason: target.reason };
  const report = await runProductionRuntimeAcceptance(payload.files ?? [], {
    spec: payload.spec ?? {},
    architecture: payload.architecture ?? null,
    objective: payload.objective ?? '',
    requirements: payload.requirements ?? [],
    api: payload.api ?? null,
    // The single most important argument in this file: the run is issued against the real
    // deployment URL, which switches the executor into its `deployed-http` transport.
    baseUrl: deployment.url,
    projectId: payload.projectId ?? null,
    artifactId: payload.artifactId ?? null,
    deployment,
    platform: payload.platform ?? null,
    credentials: payload.credentials ?? {},
    env: payload.env ?? {}
  });
  report.projectId = payload.projectId ?? null;
  return { refused: false, runtimeAcceptance: report };
}

function assertRuntimeTarget(deployment) {
  if (deployment.status !== 'DEPLOYED' || !deployment.url) {
    return { ok: false, reason: `the generated project is not deployed (deployment status: ${deployment.status}), so production runtime acceptance is BLOCKED — DEPENDENCY_REQUIRED, never skipped` };
  }
  return assertRealTarget(deployment.url);
}

/** The HTTP surface MAULI_RUNTIME_EXECUTOR points at. */
export function createRuntimeExecutorServer({ token = null } = {}) {
  return createServer((req, res) => {
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, service: 'mauli-runtime-executor' });
    if (req.method !== 'POST') return send(405, { error: 'POST an acceptance request to this endpoint' });
    if (token && req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized' });
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let payload = null;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return send(400, { error: 'the request body is not valid JSON' }); }
      try {
        const out = await runAcceptanceAgainst(payload);
        if (out.refused) return send(409, { error: out.reason, runtimeAcceptance: null });
        return send(200, { runtimeAcceptance: out.runtimeAcceptance });
      } catch (error) {
        return send(500, { error: `the acceptance run threw: ${String(error?.message ?? error).slice(0, 300)}`, runtimeAcceptance: null });
      }
    });
  });
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  if (process.argv.includes('--once')) {
    const file = process.argv[process.argv.indexOf('--once') + 1];
    if (!file) { console.error('--once requires a JSON payload file'); process.exit(2); }
    const { readFileSync } = await import('node:fs');
    const out = await runAcceptanceAgainst(JSON.parse(readFileSync(file, 'utf8')));
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.refused || out.runtimeAcceptance?.status !== 'passed' ? 1 : 0);
  } else {
    const port = Number(process.env.MAULI_RUNTIME_PORT ?? 8789);
    createRuntimeExecutorServer({ token: process.env.MAULI_RUNTIME_EXECUTOR_TOKEN ?? null }).listen(port, '0.0.0.0', () => {
      console.log(`MAULI runtime executor listening on :${port} (accepts only real deployment URLs)`);
    });
  }
}

export default runAcceptanceAgainst;
