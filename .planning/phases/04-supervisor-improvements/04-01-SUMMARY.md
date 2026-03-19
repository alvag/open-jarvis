---
phase: 04-supervisor-improvements
plan: "01"
subsystem: infra
tags: [supervisor, ipc, heartbeat, watchdog, git-polling, auto-update, telegram, logging]

requires:
  - phase: 03-scheduled-tasks
    provides: "Fully functional Jarvis bot with scheduler and tool infrastructure"

provides:
  - "supLog() function writing all lifecycle events to data/supervisor.log with timestamp/level/category"
  - "IPC spawn channel (stdio ipc) enabling supervisor↔bot heartbeat"
  - "30-second heartbeat watchdog with SIGKILL on hang detection"
  - "Git polling every 5 minutes with pendingAutoUpdate flag flow"
  - "npm install trigger when package.json changes in git diff"
  - "Direct Telegram notifications for hang, crash, and auto-update events"

affects: [04-supervisor-improvements-plan-02, index.ts-heartbeat-emitter]

tech-stack:
  added: []
  patterns:
    - "supLog: standalone log function in supervisor.ts mirroring src/logger.ts format, avoids circular import"
    - "pendingAutoUpdate flag: distinguishes auto-update triggered exit from other exits in child.on('exit') handler"
    - "updateInProgress guard: prevents double-trigger when git poll fires while update already in progress"
    - "Heartbeat watchdog: cleared FIRST in child.on('exit') to prevent false-positive hang alerts on clean shutdown"
    - "pollForUpdates receives child as parameter: avoids module-level child variable, supports per-startBot child references"

key-files:
  created: []
  modified:
    - src/supervisor.ts

key-decisions:
  - "pollForUpdates takes child ChildProcess parameter instead of module-level variable — each startBot() creates a new child reference, parameter passing avoids stale closure bugs"
  - "Heartbeat watchdog cleared as FIRST LINE in child.on('exit') — ensures no false positive SIGKILL after clean/crash exit"
  - "updateInProgress flag set before SIGTERM, cleared after startBot() in auto-update path — prevents double git poll triggers"
  - "notifyTelegram called for crash (default case), hang detection (watchdog), and both auto-update events — supervisor has full Telegram reach without grammy"

patterns-established:
  - "Standalone supLog in supervisor.ts: same format as logger.ts but self-contained, no cross-module import"
  - "IPC heartbeat: child spawned with stdio ipc, parent listens for msg.type === 'heartbeat', watchdog resets each time"
  - "Auto-update path: pollForUpdates sets pendingAutoUpdate=true then sends SIGTERM, exit handler checks flag before switch(code)"

requirements-completed: [SUP-02, SUP-03, SUP-04]

duration: 5min
completed: 2026-03-19
---

# Phase 04 Plan 01: Supervisor Improvements Summary

**supervisor.ts rewritten with supLog file logging, IPC heartbeat watchdog with SIGKILL, 5-minute git polling auto-update, and direct Telegram notifications for hang/crash/update events**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-19T00:21:33Z
- **Completed:** 2026-03-19T00:26:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- supLog() function writing all lifecycle events to `data/supervisor.log` with same format as `src/logger.ts` (SUP-04)
- IPC spawn (`stdio: ["inherit","inherit","inherit","ipc"]`) with heartbeat watchdog resetting every 30s, SIGKILL on hang (SUP-02)
- Git polling every 5 minutes comparing local HEAD vs remote HEAD with `pendingAutoUpdate` flag driving the update flow in the exit handler (SUP-03)
- Direct Telegram notifications (raw fetch) for hang detection, crash, and auto-update events — no grammy dependency in supervisor
- All existing exit-code handling (EXIT_CLEAN, EXIT_RESTART, EXIT_UPDATE) and exponential backoff logic preserved

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite supervisor.ts with logging, IPC heartbeat watchdog, git auto-update, Telegram notifications** - `37d0cd8` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/supervisor.ts` - Complete rewrite: supLog, notifyTelegram, resetHeartbeatWatchdog, pollForUpdates, startBot with IPC

## Decisions Made

- `pollForUpdates` takes `child: ChildProcess` as parameter rather than referencing a module-level variable — each `startBot()` call creates a new child, parameter passing avoids stale closure issues
- Heartbeat watchdog is cleared as the FIRST LINE of `child.on("exit")` handler — prevents false-positive watchdog fire calling SIGKILL on an already-exited child
- `updateInProgress` flag is set before sending SIGTERM in `pollForUpdates`, cleared after `startBot()` returns in the auto-update path — prevents double-trigger if git poll interval fires during update
- `notifyTelegram` is called for crash events (default switch case), hang detection (watchdog timeout), and both auto-update phases (detected + applied) — full coverage without grammy

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — typecheck passed on first attempt with 0 errors.

## User Setup Required

None - no external service configuration required. Existing TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_IDS env vars are reused by notifyTelegram.

## Next Phase Readiness

- supervisor.ts is ready for Plan 02: bot-side heartbeat emitter (`process.send({ type: "heartbeat" })` every 10s in index.ts) and graceful shutdown sequence
- Plan 02 bot-side changes are the complement to this plan's IPC infrastructure

## Self-Check: PASSED

- src/supervisor.ts: FOUND
- 04-01-SUMMARY.md: FOUND
- Commit 37d0cd8: FOUND
- npm run typecheck: PASSED (0 errors)

---
*Phase: 04-supervisor-improvements*
*Completed: 2026-03-19*
