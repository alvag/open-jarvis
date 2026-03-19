---
phase: 04-supervisor-improvements
plan: "02"
subsystem: infra
tags: [supervisor, ipc, heartbeat, graceful-shutdown, in-flight, index]

requires:
  - phase: 04-supervisor-improvements
    plan: "01"
    provides: "IPC spawn channel (stdio ipc) and heartbeat watchdog in supervisor.ts"

provides:
  - "IPC heartbeat emitter: process.send({ type: 'heartbeat', ts }) every 10s, guarded for direct execution"
  - "In-flight agent run counter with graceful shutdown: waits up to 15s for active runAgent calls"
  - "Correct shutdown sequence: clear heartbeat -> notify Telegram -> stop scheduler -> wait in-flight -> stop polling -> close DB -> exit"

affects: [src/index.ts]

tech-stack:
  added: []
  patterns:
    - "if (process.send) guard: heartbeat emitter only fires when spawned with IPC channel (supervisor path)"
    - "In-flight counter with inFlightDone callback: try/finally pattern in telegram.start() handler tracks active runAgent calls"
    - "shutdownRequested idempotency flag: prevents double-shutdown when both SIGINT and SIGTERM arrive quickly"
    - "clearInterval(heartbeatInterval) as first shutdown step: prevents 'channel closed' IPC errors (Pitfall 1)"
    - "getPendingRestart() ?? 0 for exit code: shutdown uses pending restart code (e.g. EXIT_RESTART, EXIT_UPDATE) if one was scheduled"

key-files:
  created: []
  modified:
    - src/index.ts

key-decisions:
  - "heartbeatInterval cleared as FIRST step in shutdown() — avoids process.send() on closed IPC channel after supervisor sends SIGTERM"
  - "shutdownRequested double-shutdown guard — SIGTERM can arrive while another SIGTERM handler is already in progress"
  - "getPendingRestart() used for exit code — preserves restart-server tool's scheduled restarts (EXIT_RESTART, EXIT_UPDATE) through graceful shutdown"
  - "import getPendingRestart from restart-signal.ts added to index.ts — was previously only used inside telegram.ts"

patterns-established:
  - "In-flight tracking via counter + callback: inFlightCount++/-- in try/finally, inFlightDone() called when shutdownRequested && count===0"
  - "15s graceful shutdown: Promise.race between inFlightDone promise and 15s timeout"
  - "Heartbeat IPC: process.send guard pattern for optional IPC channel"

requirements-completed: [SUP-01, SUP-02]

duration: ~2min
completed: 2026-03-19
---

# Phase 04 Plan 02: Bot-Side IPC Heartbeat and Graceful Shutdown Summary

**index.ts extended with IPC heartbeat emitter (10s interval, guarded for non-IPC runs) and 15-second graceful shutdown tracking in-flight agent calls via try/finally counter**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-19T00:25:17Z
- **Completed:** 2026-03-19T00:27:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- IPC heartbeat emitter added: `process.send!({ type: "heartbeat", ts: Date.now() })` fires every 10s, guarded with `if (process.send)` so direct `npm run dev` execution is unaffected (SUP-02)
- In-flight agent counter (`inFlightCount`) added via try/finally in `telegram.start()` handler — counts active `runAgent` calls
- Graceful shutdown rewritten: 3s timeout replaced with 15s `Promise.race` that waits for in-flight runs to complete before force-proceeding (SUP-01)
- Shutdown sequence follows correct order per RESEARCH.md: clear heartbeat interval → notify Telegram ("Jarvis reiniciando...") → stop scheduler → wait in-flight (up to 15s) → stop Telegram polling → close DB → exit
- `getPendingRestart() ?? 0` used for exit code so `/restart` and `/update` commands still work correctly through graceful shutdown path
- `shutdownRequested` idempotency flag prevents double-shutdown if SIGINT and SIGTERM both arrive

## Task Commits

Each task was committed atomically:

1. **Task 1: Add IPC heartbeat emitter to index.ts** - `046f5ad` (feat)
2. **Task 2: Rewrite graceful shutdown with in-flight counter and 15s timeout** - `a878e18` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/index.ts` - Added heartbeat emitter, in-flight counter wrapper, rewritten shutdown handler, imported getPendingRestart

## Decisions Made

- `heartbeatInterval` cleared as the first step in `shutdown()` — prevents `Error: channel closed` when supervisor sends SIGTERM and the IPC channel closes before the 10s interval fires (Pitfall 1 from RESEARCH.md)
- `shutdownRequested` double-shutdown guard added — SIGINT/SIGTERM can both arrive in rapid succession during supervisor-initiated restarts
- `getPendingRestart() ?? 0` used for process.exit code — was previously only called inside telegram.ts; now used in index.ts shutdown to preserve restart tool exit code semantics
- Import for `getPendingRestart` added to index.ts from `./restart-signal.js` — existing usage in telegram.ts was separate

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — typecheck and build both passed on first attempt with 0 errors.

## Self-Check: PASSED

- src/index.ts contains `let heartbeatInterval: ReturnType<typeof setInterval> | null = null`: FOUND
- src/index.ts contains `if (process.send)` guard: FOUND
- src/index.ts contains `process.send!({ type: "heartbeat", ts: Date.now() })`: FOUND
- src/index.ts contains `10_000` heartbeat interval: FOUND
- src/index.ts contains `let inFlightCount = 0`: FOUND
- src/index.ts contains `let shutdownRequested = false`: FOUND
- src/index.ts contains `let inFlightDone: () => void = () => {}`: FOUND
- src/index.ts contains `inFlightCount++` in telegram.start handler: FOUND
- src/index.ts contains `inFlightCount--` in finally block: FOUND
- src/index.ts contains `if (shutdownRequested && inFlightCount === 0)` calling inFlightDone(): FOUND
- src/index.ts contains `setTimeout(resolve, 15_000)` in shutdown: FOUND
- src/index.ts contains `clearInterval(heartbeatInterval)` in shutdown: FOUND
- src/index.ts contains `telegram.broadcast("Jarvis reiniciando...")` in shutdown: FOUND
- src/index.ts contains `stopScheduler()` in shutdown: FOUND
- src/index.ts contains `getPendingRestart() ?? 0` in shutdown: FOUND
- src/index.ts does NOT contain `setTimeout(resolve, 3000)` (old timeout removed): CONFIRMED
- npm run typecheck: PASSED (0 errors)
- npm run build: PASSED (0 errors)
- Commit 046f5ad: FOUND
- Commit a878e18: FOUND

---
*Phase: 04-supervisor-improvements*
*Completed: 2026-03-19*
