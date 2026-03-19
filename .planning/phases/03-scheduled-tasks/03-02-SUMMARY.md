---
phase: 03-scheduled-tasks
plan: 02
subsystem: scheduler
tags: [scheduler, tools, bitbucket, pr-monitor, soul]
dependency_graph:
  requires: ["03-01"]
  provides: ["scheduler-tools", "pr-monitor"]
  affects: ["src/index.ts (tool registration)", "scheduler wiring"]
tech_stack:
  added: []
  patterns: ["Tool interface pattern", "SQLite upsert for idempotent state tracking"]
key_files:
  created:
    - src/scheduler/scheduler-tools.ts
    - src/scheduler/pr-monitor.ts
  modified:
    - src/tools/bitbucket-api.ts
    - soul.md
decisions:
  - "pr_states updated BEFORE sendMessage to prevent duplicate notifications on crash/restart"
  - "PR monitor wrapped in try/catch at top level — failures are logged but never propagate to scheduler"
  - "Nickname extracted from email (split @ [0]) as heuristic for author/reviewer matching"
metrics:
  duration: "~2min"
  completed: "2026-03-18"
  tasks_completed: 2
  files_modified: 4
---

# Phase 3 Plan 2: Scheduler Agent Tools and PR Monitor Summary

4 agent-facing scheduler tools with natural language cron support and a BitbucketPR change-detection monitor using pr_states upsert-before-notify pattern.

## What Was Built

### Task 1: scheduler-tools.ts + soul.md
Created `src/scheduler/scheduler-tools.ts` exporting 4 Tool objects that bridge agent natural language to the scheduler-manager API:

- `create_scheduled_task` — accepts name, type (reminder|task), cron_expression (cron or ISO datetime for one-shots), prompt, timezone. Calls `createTask` and returns next run time.
- `list_scheduled_tasks` — no parameters. Lists all user tasks with id, name, type, status, cron_expression, next_run, run history.
- `delete_scheduled_task` — takes task_id. Calls `deleteTask`.
- `manage_scheduled_task` — takes task_id + action (pause|resume). Calls `pauseTask` or `resumeTask`.

Updated `soul.md` with:
- New `## Scheduled Tasks` section (before Response Style) with cron extraction examples, tool names, and delete confirmation rule
- Expanded `## Knowledge` section with scheduling, briefing, and PR monitoring capabilities

### Task 2: BitbucketClient.getPRActivity + pr-monitor.ts
Extended `src/tools/bitbucket-api.ts`:
- Added `BitbucketActivityItem` interface with `update?`, `approval?`, `comment?` optional fields
- Added `getPRActivity(prId, workspace?, repoSlug?)` method to `BitbucketClient`

Created `src/scheduler/pr-monitor.ts` exporting `checkPRChanges(db, sendMessage, userId)`:
- Filters PRs to those where the user is author or reviewer (nickname heuristic)
- On first PR sighting: stores baseline row, no notification
- On updated_on change: fetches activity, **upserts pr_states BEFORE calling sendMessage** (prevents duplicates), builds human-readable notification with detected changes
- Detects: new commits by author, state changes (OPEN→MERGED etc.), direct @mentions in comments, approvals
- Also checks MERGED PRs to catch state changes for previously-tracked PRs
- Full try/catch at top level — errors logged but never thrown

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/scheduler/scheduler-tools.ts
- FOUND: src/scheduler/pr-monitor.ts
- FOUND: src/tools/bitbucket-api.ts (modified)
- FOUND: soul.md (modified)
- FOUND: commit 94752d8 (Task 1)
- FOUND: commit 633036f (Task 2)
- `npm run typecheck` passed after both tasks
