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
      (build → test → requirements → security → qa → integrity)
  → final delivery artifact (unique id, metadata, manifest + sha256 integrity)
  → command result upserted under its own runId (never overwrites another run)
```

Dashboard polling (`GET /api/state`, `GET /api/projects/:id/detail`) is strictly read-only:
it never writes to D1 and never starts execution.

## CI/CD

The pipeline in `.github/workflows/l1-ci.yml` runs, in order:

```text
Install (npm ci) → Syntax/Lint → Unit → Integration → Security → Self-Test
  → Wrangler Validation → Build Verification → Deploy
```

Installs are deterministic from the committed `package-lock.json`.

## Repository Status

This repository is intentionally independent from the original `mauli-ai-company` repository. The original project remains unchanged and is not used as a deployment target for MAULI 2.0.
