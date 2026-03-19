---
phase: 02-security-shell-execution
plan: 01
subsystem: security
tags: [sqlite, better-sqlite3, security, command-classification, approval-gate, crypto]

# Dependency graph
requires:
  - phase: 01-web-access
    provides: Project foundation, tool patterns, db migration system

provides:
  - Three-tier command classifier (blocked/risky/safe) at src/security/command-classifier.ts
  - Async approval gate with SQLite persistence at src/security/approval-gate.ts
  - SQLite migration v4: pending_approvals table with status/expires_at indexes

affects:
  - 02-02 (wires these modules into execute_command tool and Telegram callback handler)

# Tech tracking
tech-stack:
  added: [node:crypto (randomUUID)]
  patterns:
    - Three-tier command classification with fail-closed default for unknown commands
    - SQLite-first approval persistence (write before awaiting Promise)
    - In-memory resolver Map for async pause/resume without blocking event loop
    - Module-level resolvers Map survives multiple gate instantiations

key-files:
  created:
    - src/security/command-classifier.ts
    - src/security/approval-gate.ts
  modified:
    - src/memory/db.ts

key-decisions:
  - "classifyCommand uses fail-closed default: unknown commands return 'risky', not 'safe'"
  - "Script files (.sh, .py, .ts) always classified risky regardless of safe-list membership"
  - "Dangerous flags (-exec, --delete, --write, -i) escalate safe commands to risky"
  - "Approval gate writes to SQLite synchronously BEFORE creating Promise (SEC-03 requirement)"
  - "resolvers Map is module-level, not instance-level, to survive multiple gate calls"
  - "recoverPendingOnStartup marks stale rows expired and notifies user (not re-sends with new buttons)"

patterns-established:
  - "Pattern: Security modules in src/security/ directory, separate from tools/"
  - "Pattern: SQLite-first async gate — db.prepare().run() before Promise constructor"
  - "Pattern: Promise resolver stored in Map, resolved by callback handler or timeout"

requirements-completed: [SEC-01, SEC-02, SEC-03]

# Metrics
duration: 3min
completed: 2026-03-18
---

# Phase 2 Plan 01: Security Foundation Summary

**Three-tier command classifier (blocked/risky/safe with fail-closed default) and async approval gate persisting to SQLite before awaiting user response, with 5-minute auto-expire and startup recovery**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-18T19:10:40Z
- **Completed:** 2026-03-18T19:13:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/security/command-classifier.ts` with 8 blocked patterns, 30-command safe set, and fail-closed default
- Created `src/security/approval-gate.ts` with SQLite-first persistence, 5-minute auto-expire, and startup recovery
- Added SQLite migration v4 creating `pending_approvals` table with two indexes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create command classifier module** - `bc41cb8` (feat)
2. **Task 2: Create approval gate with SQLite migration** - `448bc8f` (feat)

**Plan metadata:** (docs commit — below)

## Files Created/Modified

- `src/security/command-classifier.ts` - Three-tier classifier with BLOCKED_PATTERNS, SAFE_COMMANDS, SCRIPT_EXTENSIONS, and getBlockReason helper
- `src/security/approval-gate.ts` - Async approval gate: createApprovalGate factory, resolvers Map, 5-min timeout, recoverPendingOnStartup
- `src/memory/db.ts` - Migration v4: pending_approvals table (id, user_id, command, args, cwd, reason, status, created_at, expires_at) + two indexes

## Decisions Made

- classifyCommand checks scripts before the safe-list (scripts bypass safe-list by design)
- getBlockReason returns human-readable strings paired with each BLOCKED_PATTERNS entry
- Approval gate `resolvers` Map is module-level so it is shared if multiple gates are created
- `recoverPendingOnStartup` marks rows expired and notifies — does not re-create live Promises (those would have no associated tool call waiting)
- `timeoutHandle.unref()` added so the 5-minute timeout does not keep the process alive unnecessarily

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Security foundation complete: Plan 02 can now import `classifyCommand`, `getBlockReason`, and `createApprovalGate`
- Plan 02 wire-up: integrate classifier into execute_command tool, wire approval gate via Telegram callback_query handler, register tool in index.ts
- No blockers

---
*Phase: 02-security-shell-execution*
*Completed: 2026-03-18*
