---
phase: 6
slug: mcp-client-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-19
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None (project uses typecheck + manual testing) |
| **Config file** | tsconfig.json |
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
| 06-01-01 | 01 | 1 | MCP-01 | type-check + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | MCP-02 | type-check + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | MCP-07 | type-check + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | MCP-08, SEC-04 | type-check + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | MCP-09 | type-check + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | MCP-03, MCP-04 | type-check | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | MCP-05 | type-check | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 1 | MCP-06 | type-check | `npm run typecheck` | ❌ W0 | ⬜ pending |
| 06-02-04 | 02 | 1 | SEC-03 | type-check + manual | `npm run typecheck` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `@modelcontextprotocol/sdk` installed as dependency
- [ ] `src/mcp/` directory created
- [ ] `npm run typecheck` passes before any implementation

*Existing infrastructure covers automated verification (typecheck + build). No test framework to install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| stdio transport connects and lists tools | MCP-01 | Requires real MCP server process | Configure `@modelcontextprotocol/server-filesystem` in mcp_config.json; verify startup logs show connection + tool count |
| HTTP transport connects and lists tools | MCP-02 | Requires real HTTP MCP server | Configure a StreamableHTTP server URL; verify startup logs show connection |
| MCP tools callable by agent | MCP-05 | Requires real LLM + Telegram session | Ask Jarvis to use an MCP tool; verify result returned |
| Failed server skipped at startup | MCP-07 | Requires invalid server config | Configure invalid command in mcp_config.json; verify Jarvis starts normally |
| Runtime crash returns error | MCP-08, SEC-04 | Requires killing child process | Kill MCP child process mid-session; verify LLM gets ToolResult error |
| Graceful shutdown closes all | MCP-09 | Requires process management | SIGTERM Jarvis; verify no zombie child processes remain |
| Name collision detected | SEC-03 | Requires duplicate name scenario | Add MCP server with tool named same as built-in; verify startup error log |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
