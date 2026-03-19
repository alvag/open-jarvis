---
phase: 2
slug: security-shell-execution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None installed — manual verification via Telegram + `npm run typecheck` |
| **Config file** | none — no test framework |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run typecheck` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run typecheck`
- **Before `/gsd:verify-work`:** Typecheck must pass
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | SEC-01 | typecheck + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | SEC-02 | typecheck + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | SEC-03 | typecheck + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | EXEC-01 | typecheck + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | EXEC-02 | typecheck + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework — verification is via typecheck and manual Telegram testing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Destructive command blocked | SEC-01 | Requires Telegram interaction | Send "run rm -rf /" to bot, verify it blocks with explanation |
| Risky command shows approval keyboard | SEC-02 | Requires Telegram inline keyboard | Send "run npm install foo", verify approval buttons appear |
| Pending approval survives restart | SEC-03 | Requires process restart during pending state | Trigger risky command, restart bot, verify re-sent approval |
| Shell command output in Telegram | EXEC-01 | Requires full agent loop | Ask "run ls", verify output in code block |
| Script execution by path | EXEC-02 | Requires script file + agent loop | Ask to run a .sh script, verify output returned |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
