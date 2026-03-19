---
phase: 7
slug: mcp-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — project uses typecheck + manual integration testing |
| **Config file** | tsconfig.json |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run typecheck && npm run build` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run typecheck && npm run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | SEC-01 | type-check | `npm run typecheck` | N/A | ⬜ pending |
| 07-01-02 | 01 | 1 | SEC-05 | type-check | `npm run typecheck` | N/A | ⬜ pending |
| 07-02-01 | 02 | 1 | SEC-02 | type-check + manual | `npm run typecheck` | N/A | ⬜ pending |
| 07-02-02 | 02 | 1 | SEC-05 | manual | Check startup log output | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. `npm run typecheck` enforces TypeScript contracts. New `McpStartupSummary` type and `buildSystemPrompt` signature change will be caught by typecheck at task commit.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| System prompt includes MCP trust warning when hasMcpTools=true | SEC-02 | Requires running Jarvis with MCP server | Start Jarvis with ≥1 MCP server; inspect logs or ask Jarvis to describe its instructions |
| Startup log shows per-source tool counts | SEC-05 | Requires running Jarvis with MCP server | Check startup log output for "Tools registered: X built-in, Y manifest, Z MCP = N total" |
| MCP descriptions capped at 500 chars | SEC-01 | Requires MCP server with long descriptions | Connect to MCP server with >500 char tool description; verify truncation in tool definitions |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
