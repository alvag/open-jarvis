---
phase: 07-mcp-integration
plan: 01
subsystem: mcp
tags: [mcp, tool-adapter, security, parallel-connect, typescript]

# Dependency graph
requires:
  - phase: 06-mcp-client-adapter
    provides: McpClient and adaptMcpTools built in phase 06
provides:
  - McpManager class with parallel connectAll/disconnectAll via Promise.allSettled
  - Description truncation at 500 chars in adaptMcpTools (SEC-01)
affects: [07-02-wiring, future MCP-related phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Promise.allSettled for parallel fault-tolerant MCP server connections
    - Promise.race for per-server connection timeout
    - Module-level constant (MAX_DESC_LEN) for security policy

key-files:
  created:
    - src/mcp/mcp-manager.ts
  modified:
    - src/mcp/mcp-tool-adapter.ts

key-decisions:
  - "Connection timeout (CONNECT_TIMEOUT_MS = 10_000) applied inside McpManager.connectOne() via Promise.race — not externally in index.ts"
  - "Tool name collision warnings logged at 'warn' level with category 'mcp' (not 'startup') inside McpManager"
  - "connectAll() returns McpStartupSummary without logging — index.ts owns the consolidated startup log"

patterns-established:
  - "McpManager encapsulates the MCP lifecycle so index.ts stays thin"
  - "Description truncation: MAX_DESC_LEN constant + truncateDescription() helper in mcp-tool-adapter.ts"

requirements-completed: [SEC-01]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 07 Plan 01: McpManager and Description Truncation Summary

**McpManager orchestrator with parallel Promise.allSettled connect/disconnect, plus 500-char tool description truncation for SEC-01 tool-poisoning defense**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-19T14:10:00Z
- **Completed:** 2026-03-19T14:18:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added `truncateDescription()` helper and `MAX_DESC_LEN = 500` constant to mcp-tool-adapter.ts, satisfying SEC-01
- Created McpManager class with `connectAll(registry)` running all servers in parallel via Promise.allSettled
- McpManager.connectOne() applies 10-second timeout per server via Promise.race, catches tool name collisions
- McpManager.disconnectAll() cleanly closes all active clients via Promise.allSettled

## Task Commits

Each task was committed atomically:

1. **Task 1: Add description truncation to mcp-tool-adapter.ts** - `47bf11c` (feat)
2. **Task 2: Create McpManager class in src/mcp/mcp-manager.ts** - `4fb975f` (feat)

**Plan metadata:** (docs commit pending)

## Files Created/Modified
- `src/mcp/mcp-tool-adapter.ts` - Added MAX_DESC_LEN constant and truncateDescription() helper; replaced inline description assignment
- `src/mcp/mcp-manager.ts` - New file: McpManager class with connectAll/disconnectAll, McpStartupSummary interface

## Decisions Made
- Connection timeout moved inside McpManager.connectOne() (was previously only in index.ts inline loop) — McpManager should own its lifecycle
- Tool collision warnings use category "mcp" (not "startup") since McpManager is the new authority for MCP operations
- connectAll() intentionally returns summary without logging — caller (index.ts in Plan 02) owns consolidated startup log

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- McpManager and McpStartupSummary ready for import in Plan 02
- index.ts inline MCP loop can be replaced with `const mcpManager = new McpManager(configs); await mcpManager.connectAll(toolRegistry)` in Plan 02
- Concern: Monitor tool count budget in early sessions; if OpenRouter has lower per-request function-calling limits, accelerate allowedTools filtering

---
*Phase: 07-mcp-integration*
*Completed: 2026-03-19*

## Self-Check: PASSED

- src/mcp/mcp-manager.ts: FOUND
- src/mcp/mcp-tool-adapter.ts: FOUND
- .planning/phases/07-mcp-integration/07-01-SUMMARY.md: FOUND
- Commit 47bf11c: FOUND
- Commit 4fb975f: FOUND
