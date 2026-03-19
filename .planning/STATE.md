---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: MCP Tools & Tool Manifest
status: unknown
stopped_at: Completed 05-tool-manifest-01-PLAN.md
last_updated: "2026-03-19T11:21:51.347Z"
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-19)

**Core value:** Jarvis debe ser un asistente personal confiable que ejecuta tareas de forma autónoma sin comprometer la seguridad del sistema donde corre.
**Current focus:** Phase 05 — tool-manifest

## Current Position

Phase: 05 (tool-manifest) — EXECUTING
Plan: 1 of 1

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

### Pending Todos

None.

### Blockers/Concerns

- Phase 7: System prompt wording for MCP tool poisoning defense should be validated empirically against real MCP servers during implementation
- Phase 7: Monitor tool count budget in early sessions; if OpenRouter has lower per-request function-calling limits, accelerate `allowedTools` filtering from v2 to v1.1

## Session Continuity

Last session: 2026-03-19T11:18:03.809Z
Stopped at: Completed 05-tool-manifest-01-PLAN.md
Resume file: None
