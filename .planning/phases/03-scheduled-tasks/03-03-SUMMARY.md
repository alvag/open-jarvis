---
phase: 03-scheduled-tasks
plan: 03
subsystem: scheduler
tags: [croner, sqlite, telegram, cron, scheduled-tasks, pr-monitor, briefing]

# Dependency graph
requires:
  - phase: 03-scheduled-tasks
    plan: 01
    provides: "Scheduler engine (startScheduler, createTask, stopAll, listTasks) and DB schema"
  - phase: 03-scheduled-tasks
    plan: 02
    provides: "4 scheduler tools (create, list, delete, manage) and PR monitor (checkPRChanges)"
provides:
  - "Fully wired scheduled task system in index.ts — tools registered, engine started, built-in tasks seeded"
  - "Morning briefing auto-seeded on first startup with calendar/gmail/bitbucket/web tools"
  - "PR monitor auto-seeded on first startup (when Bitbucket enabled)"
  - "pr-monitor executeTask case calls checkPRChanges directly (no agent loop)"
  - "Graceful shutdown calls stopScheduler() before db.close()"
  - "Scheduler env vars documented in .env.example"
affects: [phase-04-supervisor, index.ts, scheduler]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "seedBuiltInTasks: idempotent seeding pattern — only creates if not found in DB"
    - "Dynamic import for pr-monitor in executeTask to avoid circular dependency"
    - "Scheduler initialized after all tools registered and telegram started (correct ordering)"

key-files:
  created: []
  modified:
    - src/index.ts
    - src/scheduler/scheduler-manager.ts
    - .env.example

key-decisions:
  - "PR monitor uses direct checkPRChanges call (not agent loop) — mechanical check, no LLM reasoning needed"
  - "seedBuiltInTasks declared as function inside main, called immediately after startScheduler"
  - "Scheduler initialized at step 7, after tool registration (step 3) and telegram.start() (step 5)"

patterns-established:
  - "Built-in task seeding: check listTasks().find(t => t.type === ...) before createTask"
  - "Shutdown order: stopScheduler() -> telegram.stop() -> db.close()"

requirements-completed: [SCHED-01, SCHED-02, SCHED-03, SCHED-04]

# Metrics
duration: ~5min
completed: 2026-03-18
---

# Phase 3 Plan 03: Integration — Wire Scheduler in index.ts Summary

**Scheduler fully wired in index.ts: 4 tools registered, engine initialized, morning briefing and PR monitor auto-seeded, graceful shutdown integrated**

## Performance

- **Duration:** ~5 min (code) + human verification
- **Started:** 2026-03-18T23:30:49Z
- **Completed:** 2026-03-18T23:45:00Z
- **Tasks:** 2 of 2 (including human-verify checkpoint)
- **Files modified:** 3

## Accomplishments
- Registered all 4 scheduler tools in tool registry (create, list, delete, manage)
- Initialized scheduler with `SchedulerDeps` after all tools and telegram are ready
- Added idempotent `seedBuiltInTasks` — creates morning briefing and PR monitor on first startup only
- Added `pr-monitor` case in `executeTask` using dynamic import to call `checkPRChanges` directly
- Updated graceful shutdown to call `stopScheduler()` before `db.close()`
- Documented all 5 scheduler env vars in `.env.example`

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire scheduler in index.ts** - `3913b80` (feat)

2. **Task 2: End-to-end verification of scheduled tasks in live Telegram** - `N/A` (human-verify checkpoint — no code changes, all 7 test cases passed)

**Plan metadata:** (docs commit — see final state update)

## Files Created/Modified
- `src/index.ts` — Added scheduler imports, tool registration, scheduler init, seedBuiltInTasks, updated shutdown
- `src/scheduler/scheduler-manager.ts` — Added `pr-monitor` case in `executeTask` (dynamic import of `checkPRChanges`)
- `.env.example` — Added `# --- Scheduler ---` section with 5 env var docs

## Decisions Made
- PR monitor uses `checkPRChanges` directly instead of agent loop — it's a mechanical check, LLM reasoning not needed
- Dynamic import of `pr-monitor.js` in `executeTask` to prevent circular dependency at module load time
- Scheduler initialized at step 7 (after tools registered at step 3 and telegram started at step 5)

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None — typecheck passed on first attempt.

## User Setup Required
None — no external service configuration required beyond what was already documented.

## End-to-End Verification Results

Task 2 human-verify checkpoint passed. All 7 test cases confirmed in live Telegram:

- **Test 1 (SCHED-01):** Recurring task created with cron expression, notification received at scheduled time
- **Test 2 (SCHED-02):** One-shot reminder fired once and did not repeat
- **Test 3 (SCHED-01):** List/pause/resume/delete all work through natural language commands
- **Test 4 (SCHED-03):** Morning Briefing task visible in task list with correct configured time
- **Test 5 (SCHED-04):** PR Monitor task visible in task list with 15-min interval, logs show "PR check complete"
- **Test 6:** Failed task sends error notification to user via Telegram
- **Test 7:** All tasks survive bot restart with same IDs and settings

## Next Phase Readiness
- Phase 3 integration complete — all 7 verification tests passed
- All 4 scheduler requirements (SCHED-01 through SCHED-04) verified end-to-end in live Telegram
- Phase 4 (Supervisor) can begin

## Self-Check: PASSED
All files present. Commit 3913b80 verified in git log.

---
*Phase: 03-scheduled-tasks*
*Completed: 2026-03-18*
