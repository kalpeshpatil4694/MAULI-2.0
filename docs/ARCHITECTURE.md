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

## 5. Upgradeability

New agents, departments, tools, workflows, model providers, execution runtimes, and UI clients should be addable through interfaces/contracts rather than invasive changes to the core.
