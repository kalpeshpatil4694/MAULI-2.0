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
build → test → requirements → security → functional-fidelity → production-runtime
      → qa → integrity
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

### The founder types a command, not a template

The question behind a new commission is always the same: *do I have to build a template and
a system first?* No. The founder types one command; MAULI decides between two routes and
either way the founder receives a working product:

- **An existing template matches.** Routing is scored over 25 templates (each declaring its
  own domain vocabulary), so `Build an app for my mother daily medicine timetable with
  doses` scores 3 (`medicine`, `doses`, `timetable`) and lands on `medicine-tracker`.
- **Nothing matches.** The router reports `templateMatched: false` and **delivery refuses**
  rather than shipping an unrelated page with a perfect score. While the Workers AI
  allowance is exhausted that refusal is the honest end state, and the useful answer is for
  MAULI to *write the template* — which is the agent's job, done here for
  `medicine-tracker`: doses with morning/afternoon/evening/night slots, a daily taken tick,
  a 7-day adherence percentage, and persistence. Three tests plus the runtime journey keep
  it honest.

Writing the template surfaced the same class of bug as the Wi-Fi audit scores: two
medicines entered inside the same millisecond received the same `Date.now()` id, and since
every handler is wired by id, deleting one row deleted the other. `nextMedId()` pairs the
timestamp with a counter.

### A refusal must not be a silent substitution

A founder can ask for something MAULI should not build — tooling that attacks a network,
account or device the founder does not own. The correct answer is a refusal, not a quieter
version of the same thing. What MAULI does instead is deliver the legitimate half of the
intent and say plainly what it is.

"Build a Wi-Fi hacking app" therefore produces a **wireless security auditor for your own
network**: it scores the settings of the network the user administers — encryption
(WPA3/WPA2/WEP/open), whether the router still has its factory password, whether WPS is
on, whether the admin panel is exposed to the internet, whether guest traffic is isolated —
returns a 0–100 score with a grade, and lists the fixes. It also scores a candidate Wi-Fi
password. It touches nothing but a form, and it cannot reach anyone else's network.

- **Routing has to survive the hyphen.** Normalisation turned the hyphen in `Wi-Fi` into a
  space, so the request tokenised to `wi fi`, matched neither the `wifi` nor the `wi-fi`
  domain word, scored **zero** against the wireless template and silently fell through to
  the generic web-app page. `scoreTemplates()` now scores a second, hyphen-collapsed view
  of the same command alongside the spaced one. Multi-word domains (`to do`, `access point`)
  still match the spaced view, so hyphen normalisation is additive rather than a trade.
- **The audit template is first in `ROUTING_PRIORITY`** and owns `wifi`, `wi-fi`,
  `wireless`, `network`, `router`, `ssid`, `wpa2/3`, `wep`, `wps`, `access point`, `audit`,
  `auditor`. `security` is deliberately *not* a domain word: "password security app" must
  still reach the password manager.
- **Scores are calibrated against real configurations.** A fully hardened network has to be
  able to reach 100 and a router still on its shipped defaults has to land in the danger
  band — an early version of this template topped out at 35, so a perfect network was graded
  "At risk" by the page meant to reward good settings.
- **`tests/wifi-audit-template.test.js` locks all of it in**: the phrasing the founder
  actually types routes to the template, neighbouring domains are not stolen, the audit
  scores and persists, and the delivered page contains no `aircrack`, `deauth`, evil-twin,
  handshake-capture or "hack someone else's network" tooling. The verifier runs the
  generated page too: `functional`, 20 DOM mutations, storage written.

### Two liveness defects found by actually running a command

Running the wireless-auditor commission end to end in production (rather than only in the
test suite) exposed two failures that no unit test had:

1. **A delivered artifact intermittently answered 404.** `getArtifact()` answers from the
   isolate's hydrated store, and hydration on the request path is `.catch(() => {})`-swallowed.
   A cold isolate whose hydrate read failed therefore served *every* artifact route from an
   empty store: the founder clicked a delivered artifact and got "Artifact not found" for a
   row the same Worker had listed one request earlier. `getArtifactDurable()` now falls through
   to D1 on a cache miss and adopts the row, so one authoritative read happens before the
   route is allowed to claim the artifact does not exist.
2. **An approved project could sit at 6/13 tasks forever.** The approval decision and the
   project-state write are two writes, not one atomic step. When an isolate died between them,
   the approval said `approved` while the project still said `awaiting_approval` —
   `claimNextTask` refuses such a project, and the maintenance gate check reported it as
   "waiting for a human" who had already answered. Recovery now treats the approval row as
   the authority and re-asserts the project state (`reactivated_approved`). An approval that
   is genuinely still `pending` is untouched.

### FUNCTIONAL FIDELITY 2.0 — the command becomes a specification

Everything above treats a founder command as prose to be planned. That is the root of the
whole failure class this section removes. A command is now read as a **structured
specification** first, and every later stage is accountable to it.

```text
Founder command
  → extractRequirementSpec()      src/requirement-spec.js
  → selectArchitecture()          src/architecture.js
  → generate                      src/functional-code-executor.js
                                 src/fullstack-codegen.js
  → requirement matrix + gates    src/requirement-matrix.js, src/pipeline-gates.js
  → runtime execution             scripts/user-journey.mjs
  → delivery gate                 src/delivery.js
```

**Extraction is deterministic and offline.** `extractRequirementSpec()` runs inside the
Worker with no model call and no network: product type, platform, roles, core features,
inputs, outputs, business rules, data requirements, authentication, APIs, external
services, real-time, security and acceptance criteria, each requirement carrying a stable
`REQ-001`… id. It reports its own confidence as `COMPLETE`, `PARTIAL` or `BLOCKED`; a
command it cannot identify is `BLOCKED` and is never rounded up, because rounding up is
what licenses a generic substitution.

**Architecture is a decision, not a constant** (`src/architecture.js`). A server is owed to
the founder only when something genuinely needs one: several users, accounts, live updates,
an external service, a native client, or a product whose records are the *business's* rather
than one person's device. A personal medicine tracker is honestly a frontend plus a device
store, and forcing a Worker and D1 onto it would be its own kind of wrong product. Each
selected layer also produces an **obligation** — `realtime-channel`, `auth-protected`,
`database-write` — so naming an architecture is a promise the matrix later checks.

**The requirement matrix is the delivery gate** (`src/requirement-matrix.js`). Every
requirement is judged `PASS` / `PARTIAL` / `FAIL` / `BLOCKED` / `NOT APPLICABLE`, and a
critical `FAIL` makes the project **NOT DELIVERABLE** before anything is written to the
founder. `NOT APPLICABLE` is not a loophole: a server-only requirement (a 401 on a protected
route) is recorded as not applicable when the selected architecture has no server, because
refusing a working single-user tracker for lacking an endpoint it was never owed is the same
mistake in the opposite direction. `buildFinalDelivery()` throws on a critical failure and
records the full matrix, the traceability chain and the quality score on the artifact.

**Two statuses, never merged** (`dualStatus()`). The delivery reports `functional` and
`founderRequirementComplete` independently, because an app can run beautifully and still not
be the product that was requested. The ten-category quality score is derived from executed
evidence only; with no evidence the score is `0` and `functionalClaim` is `false` — a
percentage is never printed without what is behind it.

### A product that actually has a backend

Until now MAULI could only produce a browser page. That is a legitimate product for an
offline note pad and a fake one for anyone who asked for accounts, shared data or live
updates, because there was nothing behind the page to talk to.

`src/fullstack-codegen.js` is a compiler, not a template library: it reads the extracted
specification and emits the architecture that specification selected — a Worker entry point
with real D1 SQL, PBKDF2 password hashing, server-side session enforcement, WebSocket
broadcast through a Durable Object, migrations, and a `wrangler.jsonc` — plus a frontend
that calls those endpoints for every read and write. The founder's domain noun becomes the
entity (`coffee shop order app` → `/api/orders`), so the delivered product is the product
that was requested. "Generate less, implement correctly."

It is the honest answer when the model cannot write the product: with the Workers AI
allowance exhausted, MAULI previously had nothing left but a static template, which is a
different product. Now it compiles the architecture instead, and records
`generatedBy: 'fullstack-codegen'` with the architecture id and the REQ ids it implements.

### The backend is executed, not scanned

`scripts/generated-runtime.mjs` is a small but real Workers runtime: an in-memory D1 that
parses the SQL a generated app actually issues (`prepare().bind().run()/all()/first()`),
real WebCrypto, and a `WebSocketPair` of two genuinely connected sockets.
`scripts/user-journey.mjs` loads the generated Worker, issues real requests, and derives the
founder's journey from the specification — open → register → login → create → read → update
→ refresh → live update → logout → error — executing each step and recording *evidence*
rather than a verdict about the source text.

Four defects were found by running it rather than reading it, and each is now a regression
test:

1. **The verifier ran `worker/index.js` as browser script.** Any product with a backend was
   reported `broken: Unexpected token 'export'`. Server entry points are now excluded from
   the DOM shim and executed by the journey runner instead.
2. **The D1 shim's `.first()` returned the result envelope, not the row.** Every
   "does this user already exist" check was therefore truthy, so a brand new address was
   answered `409 already registered`. A harness bug that looked exactly like a broken
   product.
3. **`UPDATE` bound its parameters in reverse order.** The id was written into the title
   column and `WHERE` compared against the timestamp, so a 200 update was reported as
   "new value stored: false".
4. **The shim replaced `console` with a silent one on `globalThis`.** That silenced the
   *verifier's own* output for as long as the runtime was loaded, so a failure inside the
   harness printed nothing and looked like a clean exit — the reason two debugging runs
   above appeared to succeed while producing no results.

The journey is also a trap: a backend that answers `200 {ok:true}` from a literal, one that
never refuses an unauthenticated read, and a product with no backend at all are all caught
and reported (`tests/generated-app-runtime.test.js`).

### The repair loop re-runs the journey, not the test

`scripts/repair-loop.mjs` is Detect → Diagnose → Fix → Rebuild → Retest, bounded. The
diagnosis names the founder step that broke *and what was observed* when it broke, and the
retest executes the **whole** journey from the start, because the common failure is a repair
that fixes the step it broke while quietly regressing the step that was already working. It
stops at its bound and reports failure rather than spinning.

### What the matrix caught in MAULI's own templates

The gate is not decoration. Running all 25 shipped templates through their own requirement
matrix found that the **todo app could create, complete and delete a task but never edit
one** — a record product missing a third of its CRUD surface. The template was fixed
(`stEd`/`svEd`/`cnEd`, a per-row Edit control) rather than the requirement being softened.
`tests/functional-fidelity-2.test.js` now asserts every shipped template satisfies its own
matrix, so the same regression cannot come back quietly.

Two false positives were found and corrected in the extractor at the same time, because a
gate that refuses correct work gets disabled:

- **"manager" read as a user role.** "A bookmark manager" and "a task manager" are products,
  not roles; matching `manager` invented a login requirement and refused a working
  bookmark app for it.
- **"chat" read as a real-time requirement.** A chat product is not automatically a live
  one. Treating it as one invented a requirement the founder never stated.

### What the final acceptance run found

Running three previously unseen founder commands through the live pipeline — rather than
the test suite — found six defects that no test had:

1. **"the counter screen updates live" was not read as a real-time requirement.** The live
   word comes *after* the verb, and the detector only looked the other way round, so MAULI
   planned a counter app with no live channel at all.
2. **A domain with no catalogue entry was BLOCKED.** "A laundry pickup and drop-off app …
   register each garment" matched no product type and no feature, because "register each" was
   not read as a create action. A shop app with no way to register a garment is a different
   product.
3. **The model returned a browser-only page for a product that owed a server.** The Workers
   AI allowance reset mid-test and produced a localStorage laundry counter: fidelity score
   92, one warning, and it would have been merged over the correct full-stack build. Now
   generation discards model output with no backend entry point when the specification
   selected a Worker API, and delivery refuses a merged result that has none.
4. **A requirement nobody can observe was scored FAIL.** "Runs on the web" has no evidence
   vocabulary, so the runtime branch recorded its absence as a failure and downgraded a
   complete product to REQUIREMENT NOT VERIFIED.
5. **The D1 shim's `.first()` returned the result envelope**, so every duplicate check was
   truthy and a brand-new address was answered `409 already registered`.
6. **`UPDATE` bound its parameters in reverse order**, writing the id into the title column
   and comparing `WHERE` against the timestamp — a 200 update reported as "not stored".

Two more were caught by `wrangler deploy --dry-run` while every unit test passed: three
duplicate keys in the synonym map (the later entry silently wins), and an assignment to a
destructured `const` that would have thrown inside the Worker at exactly the moment the
model produced a browser-only page.

### THE WRANGLER CONFIGURATION GATE — a config that parses is not a config that deploys

`wrangler deploy` reads `wrangler.jsonc` before it reads anything else, so a malformed config
is not a runtime failure, it is a build that never happens. Worse, the failures are invisible
to every other kind of check: the file parses as JSONC, `JSON.parse` accepts it, a reviewer
reads it as correct, and wrangler still refuses it. Probing a **real deployed** generated
Worker — not reading it — found three defects in one pass:

1. **The D1 500 was a SQL reserved word.** The coffee-shop order product's entity is `order`,
   so the generated migration said `CREATE TABLE IF NOT EXISTS order ( … )`, which is not
   valid SQLite. The deploy *succeeded* and then every single API call answered
   `500 D1_ERROR: near "order": syntax error`. Identifiers are now quoted through
   `quoteSql()`, in the migration and in the Worker's own runtime `CREATE`.
2. **The Durable Object binding was emitted as `"durable_objects": [ … ]`.** wrangler's
   schema wants an object with a `bindings` array. Correcting it to an array produced the
   opposite failure — a jsonc parse error — because the two shapes were confused in the fix
   as well as in the generator. The current shape is the one wrangler actually accepts, and
   it is now asserted rather than assumed.
3. **A browser-only product declared `"main": "worker/index.js"` for a Worker it never
   generates.** wrangler loads the declared entry point first and refuses
   (`The entry-point file at "worker/index.js" was not found`), so the product was a website
   nobody could host. An assets-only Worker must declare no `main` — and no assets
   *binding*, because there is no Worker to bind it to.

`scripts/wrangler-config-gate.mjs` is the gate, and it is deliberately not a linter. For each
generated product it parses the config as JSONC, checks it against wrangler's own schema
(D1 array with a real `database_id` and `migrations_dir`, `durable_objects.bindings` an array
under an object, the DO class present in `migrations[].new_sqlite_classes`, every declared
path actually shipped), **executes the migration through real SQLite**, and finally runs a
real `wrangler deploy --dry-run` and refuses to pass unless wrangler itself accepts the
config and reports `env.DB`, `env.LIVE` and the assets it read. `npm run verify:wrangler`
runs it in CI before the acceptance chain.

One thing that gate immediately caught in MAULI's own **harness**: the in-memory D1 shim read
table names with `/FROM\s+([A-Za-z_][\w]*)/` and could not parse the `"order"` the fixed
generator now sends. The shim threw, and a working generated backend was reported broken —
the same shape as defect 5 above, and the reason `table()` now refuses a name it could not
read instead of silently creating a table keyed `''`.

### DEPLOY JOB GREEN, DEPLOY JOB RED — six runs, one name

After the configuration gate passed, CI went green on `L1 validation` and stayed red on
`Deploy tested revision` for six consecutive runs of `main`. The code was correct and the
wrangler config deployed cleanly; the failure was one line above all of that, in how the
acceptance chain named its projects.

```js
`chain_${Buffer.from(command).toString('base64url').slice(0, 10).toLowerCase()}`
```

base64url discards the bytes it cannot encode and reads from the front. All three founder
commands begin **"Build a "**, so all three produced `chain_qnvpbgqgys`. The deploy executor
derives the Worker name from the project id, so three different products deployed to
**one Worker**, and the booking deployment — which has no live channel and therefore no
`LIVE` Durable Object binding — silently replaced the coffee-shop Worker's URL. The
coffee-shop acceptance then probed a Worker that was not its own and found `501` on
`/api/live`, which reads exactly like a broken Durable Object binding rather than like a name
collision. One product's evidence, attributed to another product: the identity failure the
whole deployment contract exists to prevent, reintroduced through the id that identifies it.

`chainProjectId()` now digests the **whole** command with SHA-256 and truncates to 12
characters — long enough that a collision is not reachable by the first-characters problem
that caused this, short enough that the derived Worker name stays inside the 40-character
limit the executor truncates at.

**A successful deploy is not yet a serving deploy.** The executor returned the URL the moment
`wrangler deploy` exited, which means *uploaded*, not *serving this version*; the acceptance
runner then probed whatever the edge had. `waitForDeployment()` polls the real hostname and
refuses to hand a URL forward until it answers, and — for a specification that requires live
updates — until `/api/live` is not `501`. A `501` there is a binding Cloudflare never
deployed, so it is recorded as `errorCategory: 'deployment'` with the reason spelled out,
rather than surfacing to the founder as a product failure and sending them to hunt a bug in
their own app. `tests/acceptance-identity.test.js` pins all seven of these claims, including
the negative control that a live route answering `200` *is* accepted.

**A binding in the config is not a binding at runtime.** The coffee-shop product still
answered `501` on `/api/live` after the identity fix, while `wrangler deploy --dry-run`
happily reported `env.LIVE (LiveConnections) Durable Object` among the worker's bindings and
every assertion in the configuration gate passed. The config declared the class as
`new_sqlite_classes`, but the class itself was a plain ES class. To workerd a class that does
not extend the runtime base is **not a Durable Object**: the deploy succeeds, the binding is
simply absent, and the product answers `501` — a defect in the deployment, reported to the
founder as a broken app. The class now `extends DurableObject`, imported from
`cloudflare:workers`.

That import is what made the defect invisible: the generated Worker is executed in the
harness through a `data:` URL module, and `cloudflare:workers` is not a real URL scheme, so
the harness rewrites the **specifier only** to an inlined definition of the same base class.
The shipped source stays byte-for-byte what Cloudflare runs, and the local run now proves the
class really answers the live route (`101`, upgraded) instead of the harness quietly
supplying the missing binding itself.

**A write has to actually arrive.** With the class a real Durable Object, the live channel
connected and the deploy went green — and every two-client proof still failed, because the
Worker holds no sockets: the Durable Object does. A write is delivered by asking the DO to
broadcast, and that handoff is a private route written in two places in the template. The
Worker POSTed to `https://mauli-live/broadcast`; the DO's router matched
`/api/live/broadcast`. The DO answered **404**, the write was dropped, and every product with
live updates reported "a change on one client did not reach the other" — while the deploy
succeeded, the config was correct and every other check stayed green. A dropped write is
indistinguishable from a product that has no live channel, unless the two halves of the route
are required to agree.

`tests/live-broadcast.test.js` reads the path out of the Worker's own request and requires the
DO's router to accept it, then drives a real write through the real namespace. Its negative
control reverts the path and confirms the test fails, so it cannot quietly stop testing
anything.

**Four harness defects, one symptom.** With the route fixed, the two-client proof still failed
— and each remaining cause was a place where the harness was *less* faithful than Cloudflare,
so every one of them looked like a product whose live channel had stopped working:

1. **A socket kept one listener per event type.** `addEventListener` assigned, so registering
   a close handler silently erased the message handler. The DOM's own semantics are a list.
2. **A closed socket stayed in the Durable Object's set.** Nothing invoked the DO's
   `webSocketClose`, so a disconnected client kept receiving broadcasts into a dead socket —
   and the reconnected client, correctly registered alongside it, appeared to receive nothing.
3. **The journey built its own Durable Object.** Clients connected to a private
   `new LiveConnections(...)` while the write broadcast through the runtime's instance. Two
   instances, two socket sets. Cloudflare gives every client of one id exactly one instance.
4. **The journey opened the socket by calling the DO directly**, skipping the Worker's own
   live route — and with it the hop a real request makes.

The hibernation change made this harder to see rather than easier: a Durable Object that
registers the **server** half and returns the **client** half broadcasts on the one the
harness was not forwarding. It now resolves whichever half the DO actually registered, and
the runtime publishes that set — as a `Set`, which one `Array.isArray` check was quietly
rejecting, falling back to the half nobody broadcasts on.

Every one of these failed **silently**: no assertion fired and no error was thrown. The only
evidence was a product that could not do the thing its specification promised.
`tests/live-broadcast.test.js` pins all five behaviours, including the route agreement, and
its negative control reverts the route and confirms the test fails.

**The client must not be Node's built-in WebSocket.** A Durable Object confirms the connection
the moment it accepts the socket, so that confirmation is almost always coalesced by TCP into
the very read that completed the handshake. Node's parser discards those bytes as part of the
response: the socket opens, every message is dropped, and the live channel looks connected
while delivering nothing. `ws` coped; the built-in client did not, and `ws` is not a declared
dependency — relying on it would have been luck. The acceptance client is a hand-rolled
RFC 6455 handshake and frame parser over a raw `node:net` socket, which is also a truer
picture of what a browser does. (Its `Sec-WebSocket-Accept` check was briefly written with a
transposed GUID, which made every live connection look refused while the server answered
`101` with a correct key.)

**A departed client has to be told.** The Durable Object keeps its own client set and drops a
socket in its `close` handler. The harness owns the TCP connection, and nothing ever invoked
that handler, so a disconnected client stayed registered forever — every later broadcast was
written into a dead socket and the set grew without bound. Reconnecting happened to keep
working, which is exactly why this survived: the leak was invisible until the set was
counted.

`scripts/audit-live-channel.mjs` (`npm run verify:live`, and a CI step) drives a raw RFC 6455
client against a real deployment harness and asserts six things end to end: the upgrade, the
server-side confirmation, delivery to both connected clients **exactly once**, a disconnected
client leaving the broadcast set, and a reconnected client receiving the next write. Its
negative control — removing the disconnect notification — reproduces the leak, so the check
cannot quietly stop testing anything.

### PRODUCTION RUNTIME ACCEPTANCE — nothing is delivered that was not run

Everything above proves the code is a working app. None of it proved the app **ran**. The
runtime branch of the requirement matrix read `project.runtimeEvidence`, which nothing ever
wrote; `runtimeRequired` was `false` on every path that reached delivery; and the pipeline
ended at `build → test → requirements → security → qa → integrity`. A project could reach
`completed` with a `REQUIREMENT NOT VERIFIED` badge and a QA row that said "passed".

A mandatory gate now sits between Functional Fidelity and QA:

```text
build → test → requirements → security → functional-fidelity
      → production-runtime → qa → integrity → Final Delivery
```

It answers one question, in code:

> Founder ने command दिल्यावर MAULI ने तयार केलेला application त्याच्या वास्तविक requirements
> प्रमाणे deploy होतो, चालतो, data persist करतो, user journey पूर्ण करतो आणि प्रत्येक critical
> requirement साठी runtime evidence देतो का?

**Three modules, one verdict.** `src/production-runtime.js` is pure and Worker-safe: it
knows which stages and tests an architecture owes (`runtimeObligations`), which runtime test
evidences each requirement (`runtimeRequirementEvidence`), the fourteen no-false-PASS rules,
and the verdict itself (`evaluateRuntimeAcceptance`). `src/runtime-evidence.js` is the store:
it merges the same code artifacts the gates judge, records a run, and projects it for the
dashboard. `scripts/production-runtime.mjs` is the only thing that PRODUCES evidence — it
executes the generated Worker against a real in-memory D1, real WebCrypto and a real
`WebSocketPair`, or, with `baseUrl`, over real HTTP against a deployed Worker.

```text
DEPLOYED WORKER → Health → API contract → Authentication → Core business operation
  → D1 persistence → create → read → update → read → delete → read-missing
  → Error handling → User journey → Runtime evidence → PASS / BLOCKED
```

**The report is never allowed to claim more than it observed.** A test that did not run is
absent, which the gate reads as BLOCKED; a test that observed a static body is FAIL. The
strongest check is anti-fake: the record list is captured *before* and *after* a create, and
an endpoint that answers the same bytes to both is a hardcoded JSON body whatever its status
code says. Unhandled rejections from the generated app are collected as evidence against the
app rather than being allowed to kill the run.

**Obligations are the superset of what the specification demands.** Deriving the required
tests from the architecture alone left `invalid-input` out while a critical security
requirement demanded exactly that test — so every app that owed input validation was
permanently BLOCKED by a test nobody had asked the run to perform. `runtimeObligations` now
unions the architecture's stages with `requiredTestsForRequirement()` for every requirement
in the specification.

**A local app is held to its own bar, not a server's** (spec item 9). A browser-only
architecture owes `ui-interaction`, `local-persistence` and `user-journey` — evidence its own
executor records — and the requirement vocabulary is *translated* rather than trimmed:
"create a record" on a device-store app is proven by the UI creating one, not by a 404 it was
never given a server for. Fake detection for a local app still runs, statically, over the
delivered source. `tests/production-runtime-acceptance.test.js` executes a calculator through
the real executor to keep both halves honest.

**External dependencies are declared, never faked** (spec item 10). A weather, maps, payment,
SMS, email or AI requirement whose credential is absent yields `blocked / dependency-required`
naming the env var — never a hardcoded success.

**Requirement → runtime evidence** (points 6 and 7). Every row of the matrix now carries
`runtimeTest`, `runtimeEvidence`, `runtimeStatus` and `failureReason`, so a critical
requirement with no passing runtime test is `BLOCKED`, and `summary.runtimeVerified` counts
only rows an executed test actually proved — a structural row's explanatory text is not a
PASS.

**The verdict is enforced twice.** The gate refuses to pass without a recorded run; Final
Delivery independently throws `Delivery blocked: PRODUCTION RUNTIME <STATUS> (<code>)` — and
also refuses any required gate whose own result says `passed:false`, because a gate row is
`completed` from verification's point of view while its verdict is a refusal. QA reads the
same refusal explicitly, so a completed QA row can never be read as "runtime was fine".

**Recording.** `POST /api/projects/:id/runtime-acceptance` (founder key) stores a run;
`POST .../runtime-acceptance/run` asks the configured `MAULI_RUNTIME_EXECUTOR` runner for one
and answers `424 Failed Dependency` when none is configured — a dependency failure, not a
pass. `scripts/accept-runtime.mjs --project <id>` is the harness: download the project's
code, run the smoke test, post the evidence, exit with the verdict. Credential-shaped keys
are redacted by the store before anything is written, so no secret is ever persisted.

**The founder sees it** (point 16): the Projects table has a Production Runtime column, the
live command card prints PASS / FAILED / BLOCKED with tested-at, API, DB, auth, journey and
critical pass/fail counts, and Project Details adds the blocking reason and any missing or
failed runtime tests above the progress numbers — never a bare "QA Passed".

Two defects the gate found in MAULI's own shipped code:

1. **The calculator template called `eval()`.** The security gate had always flagged it;
   nothing enforced the gate's verdict, so the delivery check that now refuses a
   `passed:false` gate turned a working-looking product into a blocked delivery. The template
   parses the expression instead of evaluating it — the gate was right and the product was
   fixed, rather than the rule being softened.
2. **`fakeRuntimeSignals` scanned with comments removed**, so `// TODO finish this` — the
   literal unfinished-work marker a user sees in the shipped source — was stripped before the
   rule looked at it. Markers are now scanned raw; only the code-shaped signals keep the
   comment-stripped view.

### DEPLOYMENT, IDENTITY, AND WHO IS THE RUNTIME CANDIDATE

The gate above proved the code is a working app and that a run of that code can be judged.
Two questions were still open, and both are ways a green pipeline can be meaningless:

1. **Was the application that was tested actually deployed?** Running generated source inside
   the acceptance process answers a different question than running the deployed product.
2. **Whose evidence is this?** Evidence produced for project A, attached to project B, is a
   pass for nothing.

`src/generated-deployment.js` owns the deployment record:

```js
{ status: 'NOT_DEPLOYED|DEPLOYING|DEPLOYED|FAILED', url, deploymentId, deployedAt,
  commit, environment, projectId, artifactId, errorCategory, errorMessage, attemptedAt }
```

A URL is only accepted when it is `https`, is **not** MAULI's own control-plane URL, and is
the URL recorded on this project's deployment. `assertRuntimeIdentity()` closes the chain:

```text
Project ID ↔ Artifact ↔ Deployment ↔ Runtime Evidence ↔ Requirement Matrix ↔ Final Delivery
```

and refuses, as `runtime-identity-mismatch`, a run for another project, a deployment owned by
another project, a URL that is not this project's, a source-level (`worker-runtime`) transport
standing in for a deployed (`deployed-http`) one, and — the repair case — an acceptance whose
`artifactId` is no longer the project's newest artifact.

**Automatic, per project, no configured id.** `projectsNeedingRuntimeAcceptance()` is the
candidate list: every project with generated code and no passing evidence. `sweepRuntimeAcceptance()`
drives them through `MAULI_DEPLOY_EXECUTOR` → `MAULI_RUNTIME_EXECUTOR` → recorded verdict.
`MAULI_RUNTIME_PROJECT` survives in CI only as an optional fixture filter; production
acceptance never depends on it.

**Honest states instead of fake ones.** A failed deployment yields `BLOCKED` with its error
category, a redacted message and a timestamp. A missing executor yields
`runtime-executor-unavailable`. A native project with no device yields
`android-runtime-unavailable` — an APK build is not runtime evidence. Every per-requirement
row now carries the endpoint, the request, the response, the database evidence, the journey
step, the runtime timestamp and the deployment URL, so a PASS is auditable rather than
asserted.

**The harness learned the difference.** `scripts/accept-runtime.mjs` no longer defaults a
founder key (a committed credential is a committed production secret), refuses a `--deployed`
URL that is MAULI's own or belongs to another project (exit 4), probes the deployment before
running, and refuses to record a run that did not go over the wire. The engine's own
self-test now serves the generated Worker over a real HTTP server and drives the full
acceptance through the network path, so "deployed-http" is demonstrated, not asserted.

`tests/generated-deployment-identity.test.js` pins the verdict for the A–L matrix: backend+D1,
backend+auth, external API, realtime, browser-only, executor unavailable, deployment failure,
wrong URL, wrong project, missing critical evidence, repair→redeploy→retest, and a full green
delivery — plus the delivery guard refusing the same project the moment one link is removed.

## 6. Upgradeability

New agents, departments, tools, workflows, model providers, execution runtimes, and UI clients should be addable through interfaces/contracts rather than invasive changes to the core.
