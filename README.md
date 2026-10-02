# MAULI 2.0

**Autonomous AI Company Platform**

MAULI 2.0 is the next-generation, modular evolution of the MAULI AI Company concept. It combines an executive company brain, agent hive, real execution, memory, verification, governance, and an upgradeable Virtual Company interface.

## Vision

Founder command → Executive AI → company/project planning → agent selection → task orchestration → real execution → verification → approval → delivery.

## Core Principles

- Founder-first governance
- Modular and upgradeable architecture
- Agent specialization and coordination
- Real tool execution with controlled permissions
- Persistent company/project/task memory
- Verification before delivery
- Self-correction and failure recovery
- Security, auditability, and cost controls
- UI independent of the core execution engine

## Initial Architecture

```text
Founder
  ↓
Executive / SK
  ↓
Company Brain
  ↓
Project Engine
  ↓
Workflow / Task Engine
  ↓
Agent Orchestrator
  ↓
Agent Hive
  ↓
Execution Runtime + Tools
  ↓
Verification / Recovery
  ↓
Approval / Governance
  ↓
Delivery
```

The Virtual Company UI is a presentation and control layer over these services; it is not the system's source of truth.

## Runtime Stack

MAULI 2.0 runs entirely on Cloudflare's free tier:

- **Cloudflare Workers** — the HTTP API, dashboard, and cron entrypoint (`src/worker.js`).
- **D1** — the single durable datastore for every entity, event, and command result.
- **Durable Objects** — the per-project execution coordinator that guarantees one
  scheduler owns a project's execution at a time.
- **Workers AI** — code/app generation.

There is **no R2 or other object storage**. Generated artifacts are stored as bounded D1
rows and streamed back to the founder as a zip on demand. Deployment and CI must never
require an object-storage binding.

## Command Lifecycle

```text
Founder command (POST /api/command)
  → queue + persist project/tasks (immediate, visible in the dashboard)
  → approval gate when required (POST /api/approvals/:id)
  → scheduler owns execution (cron */5 + explicit command/approval/chat triggers)
  → agents execute → verification → pipeline gates
      (build → test → requirements → security → functional-fidelity
       → production-runtime → qa → integrity)
  → final delivery artifact (unique id, metadata, manifest + sha256 integrity)
  → command result upserted under its own runId (never overwrites another run)
```

Dashboard polling (`GET /api/state`, `GET /api/projects/:id/detail`) is strictly read-only:
it never writes to D1 and never starts execution.### A working product, not a demo
"Generated code is not proof of functionality." Generation runs a bounded repair loop
(Detect → Diagnose → Fix → Rebuild → Retest) against the functional fidelity gate, the QA
gate judges the merged code of every agent, and final delivery refuses an app that is only a
demo — reporting per-requirement coverage statuses instead of claiming success. Verify any
downloaded code workspace on demand:

```bash
node scripts/verify-generated-app.mjs --verify workspace.json   # exits non-zero if it does not work
```

### A product that was actually run
"Tests passed" is not "the product works". Between Functional Fidelity and QA sits the
mandatory **Production Runtime** gate, and it answers one question in code:

> Founder ने command दिल्यावर MAULI ने तयार केलेला application त्याच्या वास्तविक requirements
> प्रमाणे deploy होतो, चालतो, data persist करतो, user journey पूर्ण करतो आणि प्रत्येक critical
> requirement साठी runtime evidence देतो का?

A NO for any critical requirement means no QA PASS, no Integrity PASS, no Final Delivery and
no ZIP — the project stays BLOCKED with the exact reason. The evidence comes from running
the generated application (health → API contract → authentication → CRUD → persistence →
error path → user journey), never from reading its source:

```bash
npm run verify:runtime    # the engine's own contract: a real product passes, a fake is caught
npm run verify:deployment # the A–L deployment/identity scenario matrix
npm run accept:runtime -- --project <projectId> --key <founder key> --deployed <generated app url>
```

The verdict is stored on the project (`runtimeAcceptance`), rendered in the Founder Command
Center as **Production Runtime: PASS / FAILED / BLOCKED** with tested-at, deployment, API,
database, authentication, journey and the blocking reason, and re-checked by Final Delivery.
Secrets are never persisted: the store redacts credential-shaped keys before writing.

### Deploy first, then prove it over the network

A backend product is proved by running **its own deployed URL**, so the deployment is part of
the evidence rather than a detail beside it. Every generated project carries a deployment
record — `status`, `url`, `deploymentId`, `deployedAt`, `commit`, `environment` and the id of
the exact artifact that was deployed:

```text
generated source → install → build → wrangler validation → deploy → actual URL
  → real HTTP E2E → real D1 CRUD → authentication journey → per-requirement runtime evidence
```

- **Automatic and per project.** `POST /api/runtime-acceptance/sweep` walks every project with
  generated code and no passing evidence. There is no `MAULI_RUNTIME_PROJECT` in production;
  the variable survives only as an optional single-project fixture filter for debugging.
- **No runner, no silent skip.** With no `MAULI_DEPLOY_EXECUTOR` / `MAULI_RUNTIME_EXECUTOR` a
  backend project is **BLOCKED / DEPENDENCY_REQUIRED**, never passed and never skipped.
- **Source-level execution is not production.** A run made by executing the source in-process
  is a fixture; against a deployed backend the gate refuses it.
- **Identity is checked, not assumed.** Project ↔ artifact ↔ deployment ↔ evidence ↔ matrix ↔
  delivery must be one chain. A run produced for another project is refused at the write
  (HTTP 409), a URL that is MAULI's own control plane is refused, and a repair that
  regenerates the code invalidates the previous PASS until the new build is re-accepted.
- **Honest failures.** A failed deployment records its category (`credentials`, `quota`,
  `build`, `deployment`, `network`), a redacted message and a timestamp; QA, Integrity and
  Final Delivery all stay blocked behind it.

Browser-only projects are not forced through a Worker deployment they never owed: they are
judged on UI interaction, on-device persistence and requirement evidence in a real runtime.
Native projects owe `android-launch` — an APK/AAB that merely builds is
`ANDROID_RUNTIME = BLOCKED`.


## CI/CD

The pipeline in `.github/workflows/l1-ci.yml` runs, in order:

```text
Install (npm ci) → Syntax/Lint → Unit → Integration → Security → Generated-app runtime
  → User journey → Production runtime acceptance → Self-Test → Wrangler Validation
  → Build Verification → Deploy → Post-deploy smoke → Production runtime acceptance
```

Installs are deterministic from the committed `package-lock.json`.

## Repository Status

This repository is intentionally independent from the original `mauli-ai-company` repository. The original project remains unchanged and is not used as a deployment target for MAULI 2.0.
