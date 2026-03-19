---
phase: 03-scheduled-tasks
plan: "01"
subsystem: scheduler
tags: [scheduler, croner, sqlite, migration, types, engine]
dependency_graph:
  requires: []
  provides: [scheduler-engine, scheduled-tasks-table, pr-states-table, scheduler-config]
  affects: [src/memory/db.ts, src/config.ts]
tech_stack:
  added: [croner@^10.0.1]
  patterns: [sequential-task-queue, prepared-statements, module-level-state, retry-with-backoff]
key_files:
  created:
    - src/scheduler/types.ts
    - src/scheduler/scheduler-manager.ts
    - src/scheduler/scheduler.test.ts
    - src/scheduler/briefing.test.ts
    - src/scheduler/pr-monitor.test.ts
  modified:
    - src/memory/db.ts
    - src/config.ts
    - package.json
decisions:
  - "croner protect:true flag used to prevent concurrent execution of same job at cron level"
  - "Sequential task queue (isExecuting guard) provides cross-task serialization"
  - "Dual execution paths: reminder sends direct message, all other types invoke runAgent"
  - "One-shot detection via job.nextRun() === null after successful run"
  - "Retry-after pattern: first failure schedules 5min retry; second failure clears retry_after"
  - "Module-level stmts object created once in startScheduler, avoids re-preparing per-call"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-03-18"
  tasks_completed: 3
  files_created: 5
  files_modified: 3
---

# Phase 3 Plan 01: Scheduler Engine Foundation Summary

**One-liner:** Croner-based scheduler engine with SQLite persistence (migration v5), dual execution paths (reminder vs agent-loop), sequential task queue, and retry-with-backoff error handling.

## What Was Built

### Task 0 — Wave 0 Test Stubs
Three test files using Node.js `node:test` built-in runner with `test.todo` stubs covering all behavioral contracts: scheduler CRUD, one-shot reminders, execution paths, error handling, lifecycle, morning briefing, and PR monitor change detection. 26 tests, all green.

### Task 1 — Foundation Layer
- **croner installed** (v10.0.1) — cron job scheduler with timezone support, protect mode, and pause/resume
- **src/scheduler/types.ts** — `ScheduledTaskRow`, `SchedulerDeps`, `TaskType`, `TaskStatus` types
- **SQLite migration v5** — `scheduled_tasks` table with status, retry fields, indexes on user_id and status; `pr_states` table for PR monitor baseline tracking
- **Config block** — scheduler section in config.ts with timezone (auto-detected), briefingTime, briefingEnabled, prPollIntervalMinutes, prMonitorEnabled

### Task 2 — Scheduler Engine
Full `scheduler-manager.ts` implementing:
- `startScheduler(deps)` — initializes prepared statements, loads active tasks, registers croner jobs
- `registerJob(task)` — creates Cron with `protect:true` and timezone support
- `enqueueExecution` / `processQueue` — sequential execution queue preventing task interleaving
- `executeTask` — re-reads from DB for fresh status, dual execution path (reminder = direct sendMessage, task/briefing/pr-monitor = runAgent with synthetic context)
- `handleTaskError` — first failure: sets retry_after + 5min setTimeout retry; second failure: clears retry_after, notifies user
- One-shot task detection: `job.nextRun() === null` after run → status = "completed", job stopped
- `createTask`, `deleteTask`, `pauseTask`, `resumeTask`, `listTasks`, `getNextRun`, `stopAll` — full CRUD and lifecycle management

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files verified:
- FOUND: src/scheduler/types.ts
- FOUND: src/scheduler/scheduler-manager.ts
- FOUND: src/scheduler/scheduler.test.ts
- FOUND: src/scheduler/briefing.test.ts
- FOUND: src/scheduler/pr-monitor.test.ts

Commits verified:
- be52772: test(03-01): add Wave 0 scheduler test stubs
- fbbdcd3: feat(03-01): install croner, add scheduler types, migration v5, config block
- 6693e0e: feat(03-01): implement scheduler-manager engine

Verification:
- `npm run typecheck` — PASSED (no errors)
- `npx tsx --test src/scheduler/*.test.ts` — PASSED (26 todo stubs, 0 failures)
- croner in package.json — CONFIRMED
- user_version = 5 in db.ts — CONFIRMED
- scheduler: block in config.ts — CONFIRMED
