---
phase: 3
slug: scheduled-tasks
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-18
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner via tsx |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx tsx --test src/scheduler/*.test.ts` |
| **Full suite command** | `npx tsx --test src/scheduler/*.test.ts` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx --test src/scheduler/*.test.ts`
- **After every plan wave:** Run `npx tsx --test src/scheduler/*.test.ts`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-00 | 01 | 1 | ALL | wave-0 | `npx tsx --test src/scheduler/*.test.ts` | Created by Task 0 | ⬜ pending |
| 03-01-01 | 01 | 1 | SCHED-01 | unit | `npx tsx --test src/scheduler/*.test.ts` | ✅ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | SCHED-02 | unit | `npx tsx --test src/scheduler/*.test.ts` | ✅ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | SCHED-03 | integration | `npx tsx --test src/scheduler/*.test.ts` | ✅ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | SCHED-04 | integration | `npx tsx --test src/scheduler/*.test.ts` | ✅ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/scheduler/scheduler.test.ts` — stubs for SCHED-01, SCHED-02 (created by Plan 01, Task 0)
- [x] `src/scheduler/briefing.test.ts` — stubs for SCHED-03 (created by Plan 01, Task 0)
- [x] `src/scheduler/pr-monitor.test.ts` — stubs for SCHED-04 (created by Plan 01, Task 0)

*Wave 0 is covered by Plan 01 Task 0 which creates all three test stub files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Morning briefing arrives at configured time | SCHED-03 | Requires real Calendar/Gmail/Bitbucket/Tavily APIs and Telegram delivery | Set briefing time to 2 min from now, verify Telegram message received with all 4 sections |
| PR change notification arrives in Telegram | SCHED-04 | Requires real Bitbucket API with actual PR activity | Create a comment/commit on a monitored PR, wait for polling interval, verify notification |
| Reminder survives bot restart | SCHED-01 | Requires actual process restart | Create reminder, restart bot, verify reminder fires after restart |
| Recurring task persists across restarts | SCHED-02 | Requires actual process restart | Create recurring task, restart bot, verify it fires on next scheduled time |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
