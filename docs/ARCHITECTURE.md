# MAULI 2.0 Architecture

## 1. System Layers

### Founder Interface
Receives founder commands, exposes approvals, status, results, and the Virtual Company view.

### Executive Layer
SK/Executive interprets founder intent, maintains company-level priorities, creates projects, proposes plans, and governs agent work.

### Company Brain
Contains company rules, decisions, policies, objectives, organizational state, and long-term context.

### Project and Task Layer
Projects contain requirements, milestones, workflows, tasks, dependencies, acceptance criteria, and results.

### Agent Hive
Provides agent registry, capabilities, lifecycle, mailbox, routing, leases, heartbeats, coordination, and dynamic agent composition.

### Execution Runtime
Agents use explicitly granted tools through controlled runtimes/sandboxes. Execution must be observable and auditable.

### Verification and Recovery
Every important result can be tested, validated, retried, repaired, escalated, or returned for approval.

### Governance and Security
Founder approval, risk classification, permission scopes, secrets isolation, audit logs, budgets, and circuit breakers protect the system.

### Virtual Company
A replaceable UI layer visualizing the real state of the company, projects, departments, agents, tasks, workflows, approvals, and live activity.

## 2. Key Design Rule

The UI is never the source of truth. Core state lives in backend services/storage and is exposed to any interface: web, mobile, voice, desktop, or future 3D UI.

## 3. Agent Lifecycle

```text
registered → available → assigned → working → verifying → completed
                         ↓
                      blocked
                         ↓
                   retry / recover
                         ↓
                     escalated
```

## 4. Command Lifecycle

```text
Founder command
  → intent normalization
  → requirement extraction
  → risk classification
  → project/plan creation
  → task decomposition
  → agent selection
  → execution
  → verification
  → approval when required
  → delivery
  → memory/audit update
```

## 5. Persistence and Delivery

The entire system persists to **D1** (entities + events + command results) and coordinates
execution through **Durable Objects**. There is no object storage: generated artifacts live
as bounded D1 rows and are streamed to the founder as a zip by
`GET /api/artifacts/:id/download`. Nothing in the runtime, the wrangler config, CI, or the
deploy path depends on an R2 bucket.

Delivery is gated. A project cannot be marked complete until every task is completed and the
mandatory pipeline gates pass (`src/pipeline-gates.js`), in order:

```text
build → test → requirements → security → qa → integrity
```

Each command run upserts exactly one `command_results` row keyed by its `runId`, so a retry
rewrites its own result and can never overwrite another run's result.

### Generated-application functional verification

Code existing is not proof that a feature works. Two layers enforce this:

- **Static fidelity gate** (`src/generated-app-quality.js`), run by the Worker inside the QA
  gate. It rejects placeholder/demo wording, no-op or log-only handlers, buttons whose
  handler is never defined, pages with no interaction, data requests with no persistence,
  mocked APIs and fake async. A project that fails it cannot reach final delivery.
- **Runtime verifier** (`scripts/verify-generated-app.mjs`), run in CI and locally. It loads
  a generated app into a bounded DOM shim, executes its scripts inside a `vm` with a hard
  timeout, invokes the app's handlers and reports whether the DOM/state actually changed.

The template engine never returns a non-functional template: `generateFromTemplate()` runs
the static gate on its own output and falls back to a known-working app instead of shipping
a demo. Running generated code inside a production Worker is intentionally out of scope —
the free tier's CPU budget and the sandbox boundary mean runtime execution needs a separate
sandbox/runner.

### Read-only polling

Dashboard polling (`GET /api/state`, `GET /api/projects/:id/detail`) performs reads only. It
never writes to D1 and never starts execution. Execution begins from the cron trigger
(`*/5 * * * *`) or from explicit POSTs: `/api/command`, `/api/approvals/:id`, `/api/chat`.

## 6. Upgradeability

New agents, departments, tools, workflows, model providers, execution runtimes, and UI clients should be addable through interfaces/contracts rather than invasive changes to the core.
