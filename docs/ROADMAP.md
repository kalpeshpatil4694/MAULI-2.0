# MAULI 2.0 Build Roadmap

This is a single-system build roadmap, not a user-facing batch process. Components will be implemented in dependency order while keeping the repository continuously runnable.

## Foundation

- Runtime/configuration contracts
- API response/error contracts
- IDs, timestamps, event model
- validation utilities
- logging and audit primitives

## Company Core

- Executive/SK contract
- company state
- projects
- tasks
- workflows
- approvals
- policies

## Agent Hive

- agent registry
- capabilities
- lifecycle/state machine
- mailbox
- message routing
- leases/heartbeats
- task assignment
- agent result contracts

## Memory

- memory types
- memory engine
- scopes: founder/company/project/task/agent
- importance and retention policy
- retrieval interfaces

## Execution

- tool registry
- permission scopes
- execution adapters
- sandbox boundary
- command/file/API tools
- Git integration
- execution telemetry

## Intelligence Loop

- command interpretation
- planning
- task decomposition
- agent selection
- execution loop
- verification
- retry/repair
- escalation

## Governance

- risk classification
- approval gates
- secrets isolation
- budgets
- rate limits
- circuit breakers
- audit trails

## Virtual Company

- command center
- company overview
- departments
- agent rooms/cards
- project/task views
- live activity
- approvals
- execution details
- dynamic agent/department creation

## Deployment and Hardening

- Cloudflare backend integration
- Vercel UI deployment
- environment configuration
- CI checks
- integration tests
- security tests
- failure/recovery tests
- documentation

## Success Criteria

A founder command must be able to become an observable project plan, be decomposed into tasks, assigned to capable agents, executed through controlled tools, verified, approved when necessary, and delivered with an auditable result. The Virtual Company must reflect the same underlying state rather than simulate activity.
