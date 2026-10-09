# MAULI 2.0 — Audit of the Initial Workflow Stages

**Revision audited:** `603f845` (`main`, verified identical to `origin/main` at audit time)
**Scope:** stages 1–5 of the autonomous workflow — Founder Command, Natural Language
Requirement Analysis, Executive AI Orchestration, Project Creation, Repository and Workspace
Setup.
**Requirement of record:** *"Every stage must have a real implementation, a defined input and
output, a persisted status, error handling, retry rules and verifiable completion evidence."*

**Method.** Source reading on the audited revision (file and line references below are to that
revision), plus the repository's own tests. Where a claim could not be established from code it
is marked **⚠ unverified** rather than asserted. This is the first of several passes; it
deliberately does not change product behaviour.

---

## 1. Scorecard

| Stage | Real implementation | Defined input/output | Persisted status | Error handling | Retry rules | Verifiable evidence | Verdict |
|---|---|---|---|---|---|---|---|
| 1. Founder Command | ✅ | ✅ | ⚠ derived, no first-class `command` entity | ✅ | ⚠ partial | ✅ | **Mostly complete** |
| 2. NL Requirement Analysis | ✅ | ✅ | ⚠ spec persisted on the project, no own record/state | ❌ none (pure, no try/catch) | ❌ none | ✅ (consumed by gates) | **Partial** |
| 3. Executive AI Orchestration | ✅ | ✅ | ⚠ plan persisted only inside `command_results` | ✅ (swallows AI errors) | ⚠ AI has no retry; task retries handle the rest | ✅ | **Mostly complete** |
| 4. Project Creation | ✅ | ✅ | ✅ | ✅ (fail-loud durable-ack) | ✅ (flush + re-read once) | ✅ | **Complete** |
| 5. Repository & Workspace Setup | ⚠ partial | ⚠ | ⚠ ambiguous (inside artifacts) | ⚠ | ⚠ | ⚠ | **Partial — largest gap** |

---

## 2. Actual pipeline routing

Two entry paths exist for the same endpoint. **Which one production uses matters.**

```
wrangler.jsonc  main = src/worker.js

POST /api/command
  └─ src/worker.js  → queueCommand()  (src/orchestrator.js:62)  → project state 'queued'
       → ctx.waitUntil(schedulerTick(…, budgetMs: 20_000))   (worker.js)
       → cron */5 * * * * → runMaintenance → schedulerTick → finalizeCommand
       → 202 Accepted, durable runId

POST /api/command  (REMOVED — see F-1 below)
  └─ src/index.js had a second, synchronous handler: planCommand() → executePlannedProject
       inline inside Promise.race([…, 60 s timeout]), answering 201.
```

**F-1 resolution (this pass).** The endpoint now lives in `src/command-endpoint.js`, which
`worker.js` delegates to, and the synchronous duplicate has been deleted. The reason it could
ever be tested is worth recording: `worker.js` re-exports the Durable Object and therefore
imports `cloudflare:workers`, so it **cannot be imported under Node at all** — an inline handler
could only ever be inspected as text. Extracting it into a plain module is what makes the
production path testable.

`tests/command-async-architecture.test.js` pins the deployed path and explicitly asserts the
worker does **not** use the 60-second `Promise.race` form, so the async/scheduler-backed design
is intentional and tested. The `src/index.js:867` handler is reachable only when
`src/index.js` is imported directly — which is what **27 test files do**. Three of them
drive `POST /api/command` through that module (`tests/api-contract.test.js`,
`tests/auth.test.js`, `tests/l1-command-api.test.js`); two more reference the path without
driving the route (`tests/founder-auth.test.js`, `test/security-governance.test.js`).

> **F-1 (High) — RESOLVED.** The command route asserted by tests was not the route that ran in
> production: they differed in execution model (inline vs scheduler), status code (201 vs 202),
> rate-limit scope (5/min vs 20/min), and durability guarantees. Resolution: the production
> handler was extracted into `src/command-endpoint.js` (importable under Node, since `worker.js`
> is not), `worker.js` delegates to it, the synchronous duplicate was deleted, and the tests now
> drive the real handler. A negative control in `tests/command-async-architecture.test.js` fails
> if the second route is ever reintroduced.

---

## 3. Stage 1 — Founder Command

**Implementation.** `POST /api/command` (`src/worker.js`), delegating to
`queueCommand()` (`src/orchestrator.js:62`). The worker also triggers the scheduler
immediately via `ctx.waitUntil(...)` with a 20 s budget so short commands finish without waiting
for the next cron tick.

**Input.** `{ command: string, platform?: string }`, founder-authenticated.

**Output.** `202` with `{ runId, command, platform, generatedAt, result }` where
`result.status ∈ { queued, awaiting_approval }` plus the created project and tasks.
`command_results` row written via `saveCommandResult()` (`src/result-recorder.js:55`).

**Persisted status.** ⚠ **Derived, not first-class.** There is no `commands` entity with its own
state machine. Progress is reconstructed from:
- `projects.state` — `planning → queued → awaiting_approval → active → completed | failed`
- correlation fields `commandRunId`, `commandReceivedAt`, `commandStartedAt`, `queuedAt`,
  `commandCompletedAt` on the project and on every task
- `command_results` rows, and events `command.completed` / `command.failed` /
  `command.scheduler_error`

**Error handling.** ✅ `checkRateLimit` → `429` with `retryAfter`; `requireFounder` → auth
failure; `400` on a missing command and on an unsupported platform (explicitly refused rather
than silently substituted); `500` with `{ ok: false, result: { status: 'error' } }` from the
catch in the worker.

**Retry rules.** ⚠ **Partial.** There is no retry of a *command*. The durable-ack block in
`queueCommand` retries the store flush **once** and then throws
(`'Command tasks could not be durably persisted to D1'`) — a fail-loud, non-silent path. Rate
limiting is the only back-pressure on repeated submission. Downstream task retries (§3.1) do
the actual recovery work.

**Verifiable evidence.** ✅ Durable `runId`; the project row read back from D1 before
acknowledgement; task rows individually verified present in D1; `command_results`; events.
This is the strongest evidence chain of the five stages.

**Gaps / deviations.**
- **F-1** (above) — duplicate implementation, tests on the shadowed path.
- No first-class command state; a founder asking "what happened to my command?" is answered by
  inference from project + result rows.
- `src/index.js:867` returns `200` on error (`ok({ result: { status: 'error' } })`) instead of an
  error status — truthful body, misleading status code.

### 3.1 Retry rules (cross-cutting, owned by the scheduler)

Real and bounded, verified in source:

| Mechanism | Where | Rule |
|---|---|---|
| Task retry | `retryDecision` (`src/verification.js:54`) | retry while `attempt < task.maxAttempts` (default 3) |
| Alternate agent | `recoverFailedTask` (`src/orchestrator.js:131`) | re-queue on a *different* capable agent, bounded by `maxAttempts` |
| Infra recovery | `src/scheduler.js:116` | `infraRecoveries` counter, separate from verification attempts |
| Stale lease | `src/scheduler.js:17` | `LEASE_MS = 90_000`, orphan sweep reclaims |
| Durable ack | `src/orchestrator.js:74` | flush, re-read, one retry, then throw |

Prohibitions from the directive are respected: retries are bounded, blocked tasks are
reconsidered rather than parked forever (`src/projects.js` derives `blocked` only when nothing
is runnable), and there is no unbounded loop.

---

## 4. Stage 2 — Natural Language Requirement Analysis

**Implementation.** ✅ `extractRequirementSpec()` (`src/requirement-spec.js:155`, 413 lines).
Fully deterministic — catalogue matching over product types, roles, features, external services,
domain nouns, plus regex inference for auth, realtime, persistence and security. It is invoked
once per command from `specForCommand()` (`src/orchestrator.js:53`) **before any task, agent or
file exists**, so nothing downstream can substitute a generic product.

**Input.** `{ command, platform }`.

**Output.** A structured, versioned specification (`SPEC_VERSION = 2`): `productType`, `roles`,
`features`, `inputs`, `outputs`, `businessRules`, `dataRequirements`, `authentication`, `apis`,
`externalServices`, `realtime`, `security`, `multiUser`, `offlineRequested`,
`acceptanceCriteria`, `requirements[]`, `domainWords`, and an `understanding` verdict
`COMPLETE | PARTIAL | BLOCKED`.

**Persisted status.** ⚠ **Partial.** The spec is stored as `project.requirementSpec` and read by
delivery, the code executor, `pipeline-gates` and `runtime-evidence`. There is **no
`requirement_spec` record with its own state, provenance or retry history** — the analysis has
no lifecycle, only a stored artefact.

**Error handling.** ❌ **None.** The function is pure and has no `try/catch`; malformed input is
normalised (`String(...).trim()`). This is defensible for a pure function, but it means the
stage has no failure mode, and therefore no error-handling evidence to point at.

**Retry rules.** ❌ **None.** Deterministic and side-effect-free, so retry is not meaningful —
but the directive asks for it explicitly, and the honest answer is that this stage has no retry
policy because it cannot fail.

**Verifiable evidence.** ✅ Strong. The verdict is genuinely consumed, not decorative:
- `src/functional-code-executor.js:506` — `if (spec.understanding === 'BLOCKED') return null;`
  (generation refuses)
- `src/pipeline-gates.js:316` — gate `specification_extracted` fails when `BLOCKED`
- `src/delivery.js:249` — the verdict is carried into the delivery manifest

All three verified present on the audited revision.

**Gaps / deviations.**
- **F-2 (Medium). `BLOCKED` does not halt the pipeline at this stage.** The project is still
  created and tasks still planned; the refusal surfaces only later at generation/verification.
  The founder pays for a full plan before being told the command was not understood.
- **F-3 (Medium). No persisted lifecycle for the analysis** — no record of *which* inputs
  produced *which* spec, and no way to audit a re-derivation after the extractor changes
  (`SPEC_VERSION` exists but nothing records the spec an older project was built from, beyond
  the copy embedded on the project row).
- The `understanding` vocabulary is not part of the project state machine, so it is invisible to
  the dashboard's state model.

---

## 5. Stage 3 — Executive AI Orchestration

**Implementation.** ✅ `interpretCommand()` (`src/orchestrator.js:46`) → optional
`interpretWithAI()` → `freePlanFromCommand()` fallback → `ensureExecutablePlan()` →
`specForCommand()` → risk classification → `createProject()` → `addTasks()` → agent selection.

Agent **selection** is real: `selectAgents` / `findAgent` / `planAgent` with tool requirements
(`requireAllTools`), a cooldown fallback, and a documented last-resort partial-capability match
so a gate demanding capabilities no single agent holds cannot stall the chain. The roster
(`src/agents.js:87`) contains all nine agents from the target diagram — Executive (SK
Executive), Research, Product, Planning, Frontend, Backend, Database, Security, QA — plus nine
more (DevOps, Mobile, Desktop, AI/ML, Data, Creative, API, PDF, Native).

**Input.** The founder command + `env` (for AI binding) + `{ platform }`.

**Output.** `{ intent, aiPlan, platform, project, tasks[], status }`; tasks carry
`assignedAgentId`, `toolNames`, `dependsOn`, `sequence`, `maxAttempts`, `executor`.

**Persisted status.** ⚠ **Indirect.** The project carries `architecture` and
`requirementSpec`; the plan is returned in the API response and captured inside the
`command_results` payload. There is **no `plan` entity**, and nothing records whether the plan
came from AI or the deterministic fallback.

**Error handling.** ⚠ **Deliberately silent.** `try { plan = await interpretWithAI(env, command) } catch (_) {}`
— the AI failure is swallowed by design and the deterministic plan takes over. This is a
reasonable availability choice, but it means an AI outage is **invisible** except in the
`env`-level AI quota snapshot (`src/ai.js:41`), and by the time it is visible the founder has
already been served a template plan.

**Retry rules.** ⚠ AI calls have a deadline (`DEFAULT_AI_TIMEOUT_MS = 60_000`) and a daily
request cap (`AI_DAILY_REQUEST_LIMIT = 100`), but **no retry**; task-level retries
(§3.1) handle downstream failures.

**Verifiable evidence.** ✅ Partly. `generationPath` and `groqModel` are surfaced on
`/api/health`; the AI quota snapshot has a source label. But there is no per-command record of
the plan provider, so "was this project planned by AI or by the fallback?" is **not auditable**
per project.

**Gaps / deviations.**
- **F-4 (Medium). No plan provenance.** The directive requires verifiable completion evidence;
  the plan is the least evidenced artefact in the chain.
- **F-5 (Low). AI failure is swallowed with an empty catch** — no event, no counter, no log.
  Contrast with the persistence layer, which records `persistenceErrors` for the same class of
  problem.

---

## 6. Stage 4 — Project Creation

**Implementation.** ✅ `createProject()` (`src/projects.js:29`) + `addTaskToProject()`
(`src/projects.js:41`), driven from `queueCommand`.

**Input.** `{ name, objective, founderCommand, requirements, platform, requirementSpec, architecture, runId, commandReceivedAt }`.

**Output.** A persisted project row plus its task graph (dependencies via `dependsOn`,
`sequence` ordering, a mandatory final QA task from `finalQA()`, `src/orchestrator.js:129`) and the
project moved to `queued`.

**Persisted status.** ✅ **Complete and authoritative.** `projects` and `tasks` are in
`CRITICAL_TYPES` (`src/store.js:40`), so their writes are never dropped under write pressure.

Task lifecycle — **all eight specified states exist**, declared in `src/tasks.js:6`:
`queued, assigned, working, verifying, completed, failed, blocked, cancelled`. ✅

Project lifecycle — **seven of the eight specified states exist**: `planning`, `queued`,
`awaiting_approval`, `active`, `completed`, `failed`, `blocked`. ⚠ **`paused` is not
implemented anywhere** (see F-9). The code additionally derives `escalated` as a terminal
failure outcome (`src/orchestrator.js:147`), a state the directive does not list.

**Error handling.** ✅ Best-in-class here. `queueCommand` waits on `store.flush()`, reads the
project row back from D1, enumerates every expected task id, re-flushes once, and **throws**
rather than acknowledging a phantom command. An unbuildable platform is rejected up front.

**Retry rules.** ✅ One bounded retry (flush → re-read → flush → re-read) with explicit failure.
The compare-and-set in `store.putDurable` re-applies a dropped terminal write against the
version D1 actually holds, bounded by `MAX_CAS_RETRIES = 2` (`src/store.js`).

**Verifiable evidence.** ✅ D1 read-back of the project and each task before the `202`;
`project.created` event; `command_results`. This satisfies the directive's evidence bar.

**Gaps / deviations.** None material. One observation: `awaiting_approval` is correctly a
*project* state and the scheduler skips it — the fix that stopped a high-risk command from
executing while parked. Approval is required only for sensitive risks (production, destructive,
external-write, cost-bearing), matching the directive's "human approval only for genuinely
sensitive actions".

---

## 7. Stage 5 — Repository and Workspace Setup

**This is the largest gap.** The target architecture specifies *"Project Setup: GitHub
Repository, Project Structure"*.

**Implementation.** ⚠ **Partial — "Project Structure" exists; "GitHub Repository" does not.**

What exists:
- **Generated file set ("project structure").** `generateFullStackApp()`
  (`src/fullstack-codegen.js:1678`) and `generateFunctionalArtifact()`
  (`src/functional-code-executor.js:527`) produce the project's files.
- **Workspace as an artefact.** `registerArtifact()` (`src/artifacts.js:9`) persists it as a
  `code-workspace` artifact in D1. `artifacts` is a `CRITICAL_TYPE`. The module docstring is
  explicit: *"Artifacts are metadata + generated content; no local filesystem is assumed."*
- **Editing surface.** `src/file-editor.js` provides `editFile` / `undoEdit` /
  `getEditHistory` / `getFileChangeSummary` against the artifact — a virtual workspace with an
  undo history.
- **Delivery.** `src/delivery.js` + `src/zip.js` produce the downloadable ZIP.

What is **missing**:
- **No per-project GitHub repository is ever created.** A repository-wide search for
  `POST /user/repos` / `/orgs/{org}/repos` returns nothing. The only GitHub write paths are:
  - `/api/build-app` (`src/index.js:884`) pushing generated files to a `build/*` branch of the
    **single shared** `GITHUB_RESULT_REPO` (default `kalpeshpatil4694/MAULI-2.0`), which is a
    build channel, not a project workspace;
  - `src/generated-deployment.js:226` issuing a `repository_dispatch` into a configured repo.
- No project-scoped branch, no project-scoped repo, no workspace path, no clone.

**Input / Output.** ⚠ Input is the code artifact; output is a `code-workspace` artifact row and
(only on the build path) a shared `build/*` branch. There is no defined "repository created"
output because no repository is created.

**Persisted status.** ⚠ **Ambiguous.** There is no `repository` or `workspace` entity and no
`setup` state. The setup outcome must be inferred from the existence of a `code-workspace`
artifact, and from `projects.runtimeDeployment` (owned by a later stage).

**Error handling.** ⚠ Split across paths: `/api/build-app` fails loudly with `422` when
`www/index.html` or `package.json` is absent, but there is no error path for workspace setup
itself, because there is no such stage.

**Retry rules.** ⚠ None at this stage. `build-apps.yml` uses workflow-level `concurrency` with
`cancel-in-progress` to collapse repeat pushes — a de-duplication rule, not a retry rule.

**Verifiable evidence.** ⚠ Weakest of the five. Artifact existence + `builds` rows are the only
signals. Nothing records "the workspace was provisioned successfully" as a stage outcome.

**Gaps / deviations.**
- **F-6 (High). No per-project repository/workspace provisioning stage.** Directly at odds with
  the target diagram and with the directive's "Repository and Workspace Setup" step.
- **F-7 (Medium). No `setup` stage status or evidence**, so this stage cannot satisfy
  "persisted status" or "verifiable completion evidence" as written.
- **F-8 (Low). `src/dashboard.js.bak`** is a stale backup file inside `src/`; it is gitignored
  (`git ls-files` does not list it) but it inflates the syntax-check surface.

---

## 8. Prioritised backlog for subsequent passes

| # | Severity | Finding | Suggested direction |
|---|---|---|---|
| ~~F-1~~ | ~~High~~ | ~~Two `/api/command` implementations; tests exercise the production-shadowed one~~ | **Resolved** — endpoint extracted to `src/command-endpoint.js`, `worker.js` delegates to it, legacy handler deleted, tests repointed, negative control added |
| F-6 | High | No per-project repository/workspace provisioning | Add an explicit `workspace_setup` step (repo, branch, structure) with a durable outcome |
| F-2 | Medium | `BLOCKED` understanding does not stop the pipeline early | Halt (or gate to `awaiting_approval`) before planning tasks |
| F-3 | Medium | Requirement analysis has no persisted record/lifecycle | Persist the spec as its own row keyed by command run id + `SPEC_VERSION` |
| F-4 | Medium | No plan provenance (AI vs deterministic) | Record `planSource` on the project/plan row |
| F-7 | Medium | Stage 5 has no status or evidence | Emit a setup record: `{ status, repo, branch, files, at }` |
| F-5 | Low | AI failure swallowed by an empty catch | Emit an event + counter as persistence does |
| F-8 | Low | Stale `src/dashboard.js.bak` in the source tree | Delete |
| F-9 | Low | Project state `paused` is specified but never implemented; `escalated` is used instead and is undocumented in the state model | Either implement `paused` (a real hold/wait) or document `escalated` as the terminal-failure state |

---

## 9. What is genuinely complete

- A real, deterministic requirement extractor whose verdict is **enforced** by a gate and by the
  code executor — not decorative.
- Project creation with fail-loud durable acknowledgement, one of the strongest evidence chains
  in the codebase.
- Bounded retry/recovery for all downstream work: attempt caps, alternate-agent recovery,
  infra-recovery counters, 90 s leases with orphan reclamation.
- All eight **task** states exist and are persisted as critical writes.
- Seven of the eight **project** states exist; `paused` is the exception (F-9).
- The full nine-agent roster from the target diagram, plus nine additional specialist agents.

## 10. Verification of this audit

- Revision checked: `git rev-parse HEAD` = `origin/main` = `603f845` at audit time.
- Claims about routing were verified against `wrangler.jsonc` (`main: src/worker.js`) and
  `tests/command-async-architecture.test.js`.
- Claims about `BLOCKED` consumption were verified by locating its three consumers
  (`src/functional-code-executor.js:506`, `src/pipeline-gates.js:316`, `src/delivery.js:249`).
- The absence of per-project repository creation was verified by a repository-wide search for
  GitHub repository-creation endpoints (no matches).
- No product code was modified by this pass. Full suite on this revision: `node --test`
  605/605 pass, 0 fail; `npm run check` 228/228.
