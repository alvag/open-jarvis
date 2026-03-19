---
phase: 5
slug: tool-manifest
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — no test framework in project (typecheck + startup smoke) |
| **Config file** | tsconfig.json (typecheck only) |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run typecheck && npm run build` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run typecheck && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | MNFST-01 | typecheck + smoke | `npm run typecheck` | N/A | ⬜ pending |
| 05-01-02 | 01 | 1 | MNFST-02 | typecheck + smoke | `npm run typecheck` | N/A | ⬜ pending |
| 05-01-03 | 01 | 1 | MNFST-03 | typecheck + smoke | `npm run typecheck` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework to install — project relies on TypeScript typecheck and build verification.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Manifest loads at startup | MNFST-01 | Requires running Jarvis process | Create tool_manifest.json + mcp_config.json with sample entries, run `npm run dev`, check startup logs |
| ${VAR} substitution works | MNFST-02 | Requires env vars set at runtime | Set TEST_VAR=hello in .env, reference ${TEST_VAR} in mcp_config.json env field, verify log shows substituted value |
| enabled: false skips server | MNFST-03 | Requires running process | Add server with enabled: false, verify no connection attempt in logs |
| Missing manifest = graceful | CONTEXT | Requires startup without files | Remove both manifest files, verify Jarvis starts with built-in tools only |
| Malformed JSON = error log | CONTEXT | Requires bad input file | Write invalid JSON to tool_manifest.json, verify error log and continued startup |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
