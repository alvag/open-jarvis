---
phase: 02-security-shell-execution
plan: "02"
subsystem: shell-execution
tags: [execute_command, approval-gate, telegram-callbacks, security, graceful-shutdown]
dependency_graph:
  requires: [02-01]
  provides: [execute_command-tool, telegram-approval-flow, startup-recovery, graceful-shutdown]
  affects: [index.ts, telegram.ts, soul.md]
tech_stack:
  added: []
  patterns: [module-level-setter-DI, execFile-shell-false, inline-keyboard-callbacks, Promise.race-timeout]
key_files:
  created:
    - src/tools/built-in/execute-command.ts
  modified:
    - src/channels/telegram.ts
    - src/index.ts
    - soul.md
decisions:
  - "execFile shell:false with separate args array — no shell injection possible even if metacharacter check were bypassed"
  - "sendApprovalFn module-level setter decouples execute-command.ts from Telegram; any channel can inject the send function"
  - "recoverPendingOnStartup called after broadcast so Telegram connection is established before sending expired notifications"
  - "SIGINT/SIGTERM handlers use void arrow wrapper to satisfy TypeScript no-misused-promises; shutdown itself is async"
metrics:
  duration: "~3min"
  completed: "2026-03-18"
  tasks_completed: 2
  files_modified: 4
---

# Phase 2 Plan 02: Shell Execution Wiring Summary

**One-liner:** execute_command tool with execFile/shell:false, three-layer security pipeline, Telegram approve/deny inline keyboard, SQLite-backed approval gate, and 3s bounded graceful shutdown.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create execute_command tool | 5a8b8ed | src/tools/built-in/execute-command.ts |
| 2 | Wire Telegram callback, index.ts, graceful shutdown, soul.md | f99c4dd | src/channels/telegram.ts, src/index.ts, soul.md |

## What Was Built

### execute_command Tool (`src/tools/built-in/execute-command.ts`)

Full security pipeline in execute order:

1. Shell metacharacter check — rejects `|`, `;`, `&`, `$`, `()`, `{}`, `[]`, `<>` in command or args
2. Script path check — `.sh`/`.py`/`.ts` must be absolute paths
3. `classifyCommand()` — returns `"blocked"` / `"risky"` / `"safe"`
4. Blocked → immediate error with `getBlockReason()` explanation
5. Risky → `approvalGateRef.request()` awaits user Telegram response (or 5-min timeout)
6. Denied → error message to agent
7. Execute with `execFileAsync(shell: false, timeout: 30_000)` — scripts use correct interpreter
8. Output truncated at 4096 chars; timeout/kill handled; exit code surfaced

Exported: `default executeCommandTool`, `setApprovalGate()`, `setSendApproval()`

### Telegram Callback Handler (`src/channels/telegram.ts`)

- `setApprovalGate()` — injects gate instance at startup
- `sendApprovalMessage()` — sends Markdown message with InlineKeyboard (Aprobar / Denegar)
- `sendMessage()` — plain text for expired approval notifications
- `callback_query:data` handler — registered once in `start()`, resolves gate Promise, removes buttons via `editMessageReplyMarkup`

### index.ts Wiring

- `createApprovalGate(db)` creates the gate before `telegram.start()`
- `telegram.setApprovalGate(approvalGate)` and `setApprovalGate(approvalGate)` inject into both sides
- `setSendApproval()` bridges execute-command → telegram channel
- `recoverPendingOnStartup()` fires after broadcast, notifies users of expired approvals
- `executeCommandTool` always registered (security enforced inside the tool)

### Graceful Shutdown

```typescript
const shutdown = async () => {
  log("info", "shutdown", "Shutting down Jarvis...");
  await Promise.race([
    telegram.stop(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  db.close();
  process.exit(0);
};
```

Polling stops within 3 seconds regardless of Grammy's internal state.

### soul.md Rules

Four rules added to the Rules section: execute_command usage, no-pipes constraint, denial handling, and output summarization guidance. One knowledge bullet added.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `src/tools/built-in/execute-command.ts` exists
- [x] `setApprovalGate` and `setSendApproval` exported
- [x] `src/channels/telegram.ts` has `callback_query:data` handler, `sendApprovalMessage`, `sendMessage`
- [x] `src/index.ts` has `createApprovalGate`, `recoverPendingOnStartup`, `Promise.race` shutdown
- [x] `soul.md` has execute_command rules
- [x] Task 1 commit: 5a8b8ed
- [x] Task 2 commit: f99c4dd
- [x] `npm run typecheck` exits 0

## Self-Check: PASSED
