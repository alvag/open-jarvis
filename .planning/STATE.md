---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: MCP Tools & Tool Manifest
status: unknown
stopped_at: Completed 07-02-PLAN.md
last_updated: "2026-03-19T14:28:34.884Z"
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 5
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Jarvis debe ser un asistente personal confiable que ejecuta tareas de forma autónoma sin comprometer la seguridad del sistema donde corre.
**Current focus:** Phase 07 — mcp-integration

## Current Position

Phase: 07 (mcp-integration) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (v1.1)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

## Accumulated Context

| Phase 05-tool-manifest P01 | 4min | 3 tasks | 7 files |
| Phase 06 P01 | 2min | 2 tasks | 3 files |
| Phase 06 P02 | 3min | 2 tasks | 2 files |
| Phase 07-mcp-integration P01 | 8min | 2 tasks | 2 files |
| Phase 07-mcp-integration P02 | 5min | 2 tasks | 4 files |

### Decisions

Recent decisions affecting v1.1 work:

- Build order: manifest → client+adapter → manager+wiring (each phase independently testable)
- HTTP transport (StreamableHTTP) included in v1.1 scope alongside stdio
- Security hardening embedded in the phase that creates the surface area (not retrofitted)
- No auto-reconnect in v1.1; crashed MCP server requires Jarvis restart (acceptable for personal use)
- Tool count limit: ≤30 active tools; log warning at startup if exceeded
- JSON manifest only (no YAML); eliminates dependency, compatible with claude_desktop_config.json format
- [Phase 05-tool-manifest]: Built-in tools have collision priority: manifest tool skipped if name already registered in ToolRegistry
- [Phase 05-tool-manifest]: MCP servers only parsed in Phase 5; actual connections deferred to Phase 6
- [Phase 05-tool-manifest]: ${VAR} substitution applies only to env/headers fields in mcp_config.json, not command/args
- [Phase 06]: onclose callback checks isAlive before logging to suppress spurious warnings on clean disconnect
- [Phase 06]: Connection timeout applied externally via Promise.race in index.ts, not inside McpClient
- [Phase 06]: process.env merged first in stdio env to ensure full PATH/NODE_PATH inheritance for npx-based servers
- [Phase 06]: callTool uses ORIGINAL (unprefixed) tool name — MCP server has no awareness of registry namespace prefix
- [Phase 06]: MCP connection loop placed between loadToolManifest and LLM init to maintain built-in > manifest > MCP tool priority order
- [Phase 06]: MCP disconnect in shutdown step 3b (after stopScheduler, before in-flight wait)
- [Phase 07-01]: Connection timeout (CONNECT_TIMEOUT_MS = 10_000) applied inside McpManager.connectOne() via Promise.race — not externally in index.ts
- [Phase 07-01]: connectAll() returns McpStartupSummary without logging — index.ts owns the consolidated startup log
- [Phase 07-mcp-integration]: hasMcpTools derived from mcpSummary.toolsRegistered > 0 (not config count) — only warns LLM when tools actually registered
- [Phase 07-mcp-integration]: External Tools Notice placed after Current Context block, before memories section for natural reading order

### Pending Todos

None.

### Blockers/Concerns

- Phase 7: System prompt wording for MCP tool poisoning defense should be validated empirically against real MCP servers during implementation
- Phase 7: Monitor tool count budget in early sessions; if OpenRouter has lower per-request function-calling limits, accelerate `allowedTools` filtering from v2 to v1.1

## Session Continuity

Last session: 2026-03-19T14:25:24.502Z
Stopped at: Completed 07-02-PLAN.md
Resume file: None
