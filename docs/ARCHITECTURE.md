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
a demo. Every template route is also runtime-verified in CI, and each one persists its data
(`localStorage`), so a refresh keeps the user's work.

Three rules close the gap between "code exists" and "the feature works":

1. **The gate judges the merged project.** A project's code is the union of every agent's
   `code-workspace` artifact (the frontend agent ships `www/`, the backend agent ships
   `server.js`, the database agent ships the schema). QA fidelity runs over that union —
   judging only the newest artifact is what once let a project ship without the persistence
   another agent had written.
2. **Generation repairs itself.** `internal.code` runs Detect → Diagnose → Fix → Rebuild →
   Retest: the model's own output goes through the fidelity gate, and a failure earns one
   bounded repair call whose prompt names the violation codes (`no-persistence`,
   `noop-handler`, `unbound-handler`, …). If the repair still fails the gate, the demo is
   **not** registered as the product — the fidelity-gated template takes over and the
   refusal is recorded on the artifact metadata (`aiFailed`, `aiError`).
3. **Delivery reports requirement statuses.** `buildFinalDelivery()` refuses to emit a
   `final-delivery` artifact for a non-functional app and records per-requirement
   `requirementCoverage` (IMPLEMENTED / FAILED / BLOCKED) plus the fidelity score and
   violations. The Worker's honest status is keyword evidence in executed source — never
   prose, since a README that repeats the founder's own words proves nothing.
4. **A working app is not automatically the right app.** Production shipped a contact form
   for "build a personal habit tracker with streaks" and scored it 100, because template
   routing matched the single word "personal" to the portfolio template and the coverage
   check counted the page's own copy as evidence. Three rules close this:
   - **Routing is scored, not first-match.** Every template declares its own domain
     vocabulary; generic words (`app`, `web`, `personal`, `track`) can never outrank a real
     domain match, and domain words match on word boundaries so "bookmark" is not "book".
   - **Requirement evidence has two honest levels.** Behavioural evidence (the app's own
     JavaScript, storage keys, ids, classes, data attributes and field labels) is the
     strong signal; visible copy counts too but is reported as `evidence: 'prose'`.
     A requirement with no evidence at all is `MISSING`.
   - **Delivery refuses the wrong product.** A project whose app has no evidence for the
     founder's own command is refused, and a template that the router reported as
     `templateMatched: false` is refused outright — MAULI says it could not build the thing
     rather than delivering something unrelated.

### Liveness: a run must be reclaimable

Correctness is worthless if the system can wedge. Every recovery path — `claimNextTask`, the
orphan sweep in `recoverStaleTasks`, `recoverStaleExecutions`, and `recoverStuckProjects` —
asks the same question: *is this execution stale?* If that answer depends only on a
heartbeat, then an execution whose terminal write never landed (isolate killed mid-tick
under `ctx.waitUntil`, a compare-and-set that lost and could not be re-applied, a body that
never settles) stays reclaimable only while its heartbeat is old. Anything that keeps that
heartbeat fresh makes the run **immortal**, and one immortal run disables all four paths at
once: the task is never re-claimed, never swept as an orphan, and the project is reported
`in_progress` so nothing is re-queued. Production sat at 0/13 tasks with a single run still
`running` and no path left to recover it.

The lease is therefore bounded twice: by recency (90s without a heartbeat) **and** by an
absolute lifetime measured from the immutable `startedAt` (`MAX_RUN_LIFETIME_MS`, 10
minutes). `heartbeatExecution()` refuses to renew past that bound, and both `stale()` and
`isStaleRun()` treat an over-lifetime run as stale regardless of how recent its heartbeat
is. The bound sits far above `DEFAULT_TASK_TIMEOUT_MS` (180s) so a slow-but-working
generation is never killed, and a run that merely stops beating is still reclaimed by the
ordinary lease rule inside its lifetime.

The runtime journey the verifier performs: it loads the app, builds a DOM, executes its
scripts (firing the `DOMContentLoaded`/`load` listeners real apps initialise in), presses
every zero-argument handler **and replays the literal-argument calls the markup wires**
(`tap(48)`, `ins('7')`) — including controls the app renders into `innerHTML` — then checks
whether the DOM or `localStorage` actually changed. Node-only entry points (`server.js`) are
never executed as browser code. `node scripts/verify-generated-app.mjs --verify <file.json>`
runs that journey against a downloaded artifact and exits non-zero when the app does not work.

Running generated code inside a production Worker is intentionally out of scope —
the free tier's CPU budget and the sandbox boundary mean runtime execution needs a separate
sandbox/runner.

### Read-only polling

Dashboard polling (`GET /api/state`, `GET /api/projects/:id/detail`) performs reads only. It
never writes to D1 and never starts execution. Execution begins from the cron trigger
(`*/5 * * * *`) or from explicit POSTs: `/api/command`, `/api/approvals/:id`, `/api/chat`.

### Target platform is part of the command

"Build a habit tracker" and "Build a habit tracker for Android" are different products. The
platform used to be discovered *afterwards*, when the founder clicked a build button, so
MAULI generated the same web page for both and the packaging step was a separate,
easy-to-forget action. The target is now captured with the command.

- **`src/platforms.js`** owns the registry: `web`, `android`, `ios`, `desktop`, each with a
  label, icon, and the requirements its packaging needs. `normalizePlatform()` resolves what
  founders actually type (`exe` → desktop, `apk` → android, `iPhone` → iOS) and returns
  `null` for anything unbuildable, so a typo is reported instead of guessed at.
- **Detection is a fallback, not the mechanism.** `detectPlatformFromText()` reads the
  command when no platform was chosen, matching on word boundaries so `mac` does not fire on
  "machine" and `ios` does not fire on "curious". An explicit choice always wins, and a
  command naming no platform still builds for the web rather than failing.
- **`POST /api/command` rejects an unknown platform** with a 400 listing the supported ones.
  Silently substituting a different target is exactly the failure this feature removes.
- **The platform is persisted on the project**, adds its packaging requirement to the plan,
  and is recorded in the delivery manifest and metadata, so a download states what it is.
- **`POST /api/build-app` defaults to the project's own platform** rather than a hard-coded
  `android`, so a desktop commission produces an EXE build.
- The dashboard renders a platform selector above the command box, sends the choice with
  the command, and labels each project and its build button with the target it was
  commissioned for.

## 6. Upgradeability

New agents, departments, tools, workflows, model providers, execution runtimes, and UI clients should be addable through interfaces/contracts rather than invasive changes to the core.
