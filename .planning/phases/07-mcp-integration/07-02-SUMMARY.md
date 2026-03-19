---
phase: 07-mcp-integration
plan: 02
subsystem: mcp
tags: [mcp, security, tool-count, trust-framing, wiring, typescript]

# Dependency graph
requires:
  - phase: 07-01
    provides: McpManager class with connectAll/disconnectAll
  - phase: 06-mcp-client-adapter
    provides: McpClient and adaptMcpTools
provides:
  - Full MCP lifecycle wiring in index.ts via McpManager
  - SEC-02 trust warning in system prompt when MCP tools active
  - SEC-05 per-source tool count logging with >30 warning
affects: [index.ts startup flow, system prompt content, agent context]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Optional field on AgentContext allows backward-compatible flag propagation
    - hasMcpTools derived from actual registered count (not config count)
    - Trust warning conditionally injected into system prompt via hasMcpTools flag

key-files:
  created: []
  modified:
    - src/types.ts
    - src/agent/context-builder.ts
    - src/agent/agent.ts
    - src/index.ts

key-decisions:
  - "hasMcpTools derived from mcpSummary.toolsRegistered > 0 (not config count) — only warns LLM when tools actually registered"
  - "External Tools Notice inserted after Current Context, before memories — ensures LLM sees it before tool results"
  - "builtInCount snapshot taken before manifest load to ensure accurate three-way split"

patterns-established:
  - "AgentContext optional flags propagate security state from wiring layer to system prompt without signature changes to scheduler"

requirements-completed: [SEC-02, SEC-05]

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 07 Plan 02: MCP Wiring and Trust Framing Summary

**McpManager wired into index.ts replacing inline MCP loop, SEC-02 External Tools Notice in system prompt, SEC-05 per-source tool count logging with >30 warning**

## Performance

- **Duration:** 5 min
- **Completed:** 2026-03-19
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `hasMcpTools?: boolean` to AgentContext interface (optional — scheduler call sites unaffected)
- Added 5th param `hasMcpTools: boolean = false` to `buildSystemPrompt` with conditional "External Tools Notice" section (SEC-02)
- Updated agent.ts to pass `context.hasMcpTools ?? false` to buildSystemPrompt
- Replaced 47-line inline MCP connection loop in index.ts with `new McpManager(configs) + connectAll(registry)` (3 lines)
- Added three-way tool count snapshot: builtInCount, manifestCount, mcpSummary.toolsRegistered
- Logs `Tools registered: X built-in, Y manifest, Z MCP = N total` at startup (SEC-05)
- Warns if total > 30 tools (SEC-05)
- Passes `hasMcpTools` flag in every Telegram-initiated runAgent call
- Replaced `mcpClients.map(c => c.disconnect())` with `mcpManager.disconnectAll()` in shutdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Add hasMcpTools to AgentContext and wire through agent + context-builder** - `96668d6` (feat)
2. **Task 2: Replace inline MCP loop with McpManager and add tool count logging in index.ts** - `b5d75f8` (feat)

## Files Created/Modified

- `src/types.ts` - Added `hasMcpTools?: boolean` to AgentContext
- `src/agent/context-builder.ts` - Added hasMcpTools param and External Tools Notice section
- `src/agent/agent.ts` - Pass context.hasMcpTools ?? false to buildSystemPrompt
- `src/index.ts` - McpManager wiring, builtInCount/manifestCount snapshots, tool count logging, hasMcpTools in runAgent call

## Decisions Made

- `hasMcpTools` derived from `mcpSummary.toolsRegistered > 0` rather than config server count — only warns LLM when MCP tools are actually registered and reachable
- External Tools Notice placed after Current Context block and before memories section for natural reading order
- builtInCount snapshot taken after all built-in tools registered but before manifest load, ensuring accurate three-way split

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Phase 7 Complete

All three security requirements are now active:
- **SEC-01** (Plan 01): Tool description truncation at 500 chars in mcp-tool-adapter.ts
- **SEC-02** (Plan 02): External Tools Notice in system prompt when MCP tools active
- **SEC-05** (Plan 02): Per-source tool count logging with >30 warning

---
*Phase: 07-mcp-integration*
*Completed: 2026-03-19*

## Self-Check: PASSED

- src/types.ts: FOUND
- src/agent/context-builder.ts: FOUND
- src/agent/agent.ts: FOUND
- src/index.ts: FOUND
- .planning/phases/07-mcp-integration/07-02-SUMMARY.md: FOUND
- Commit 96668d6: FOUND
- Commit b5d75f8: FOUND
