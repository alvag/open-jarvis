---
phase: 04
slug: supervisor-improvements
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test framework in project |
| **Config file** | none |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run typecheck && npm run build` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run typecheck && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green + manual Telegram verification
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | SUP-04 | typecheck | `npm run typecheck` | N/A | ⬜ pending |
| 04-01-02 | 01 | 1 | SUP-02 | typecheck | `npm run typecheck` | N/A | ⬜ pending |
| 04-01-03 | 01 | 1 | SUP-01 | typecheck | `npm run typecheck` | N/A | ⬜ pending |
| 04-02-01 | 02 | 2 | SUP-03 | typecheck | `npm run typecheck` | N/A | ⬜ pending |
| 04-02-02 | 02 | 2 | SUP-01 | typecheck | `npm run typecheck` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No test framework to scaffold. Typecheck is the only automated gate.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Graceful shutdown completes in-flight ops within 15s | SUP-01 | Requires live Telegram interaction and real agent run in progress | 1. Send a message to trigger agent run 2. Send SIGTERM during run 3. Verify bot finishes response before exiting 4. Check supervisor.log for shutdown entry |
| Hang detection kills and restarts bot after 30s | SUP-02 | Requires process inspection and intentional process hang | 1. Start bot normally 2. Simulate hang (kill heartbeat interval) 3. Wait 30s 4. Verify supervisor kills and restarts 5. Check Telegram notification received |
| Auto-update on new git commit | SUP-03 | Requires pushing to remote and waiting for polling cycle | 1. Push a commit to current branch 2. Wait up to 5 minutes 3. Verify supervisor detects change and restarts 4. Check supervisor.log for auto-update entry |
| Lifecycle events in supervisor.log | SUP-04 | Requires running supervisor through various lifecycle scenarios | 1. Start supervisor — check "start" entry 2. Kill bot — check "crash" entry 3. Trigger update — check "auto-update" entries 4. Verify timestamps and reasons present |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
