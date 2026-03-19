---
phase: 06-mcp-client-layer
plan: 02
subsystem: mcp
tags: [mcp, tool-adapter, tool-registry, namespace, startup, shutdown]

requires:
  - phase: 06-01
    provides: McpClient class with connect/disconnect/listTools/callTool/isAlive

provides:
  - src/mcp/mcp-tool-adapter.ts — adaptMcpTools factory converting MCP tool defs to Tool objects
  - src/index.ts updated — MCP connection loop, tool registration, and graceful shutdown wiring

affects:
  - Phase 07 (security hardening) — tool naming scheme and collision rules established here

tech-stack:
  added: []
  patterns:
    - "serverName__toolName double-underscore namespace prefix for MCP tools"
    - "isAlive dead-server guard before callTool — ToolResult error never throws"
    - "Promise.race with setTimeout for per-server connection timeout"
    - "Promise.allSettled for graceful multi-client shutdown"
    - "try/catch around ToolRegistry.register() for collision detection (built-in priority)"

key-files:
  created: [src/mcp/mcp-tool-adapter.ts]
  modified: [src/index.ts]

key-decisions:
  - "callTool uses ORIGINAL (unprefixed) tool name — MCP server has no awareness of the registry namespace"
  - "SDK callTool() returns content as unknown type — cast to McpCallToolResult via as unknown to access content array"
  - "MCP connection loop placed between loadToolManifest and LLM init — tools must be registered before agent starts"
  - "MCP disconnect in shutdown step 3b (after stopScheduler, before in-flight wait) — no new agent runs can call MCP tools after scheduler stops"

patterns-established:
  - "MCP tool adapter pattern: factory function, not class — clean separation from McpClient lifecycle"
  - "isError content extraction: filter type=text, join text fields, fallback to generic message"
  - "Success result normalization: first text content item -> data; fallback to full content array"

requirements-completed: [MCP-03, MCP-04, MCP-05, MCP-06, SEC-03]

duration: ~3min
completed: 2026-03-19
---

# Phase 06 Plan 02: MCP Tool Adapter & Index Wiring Summary

**MCP tools from any configured server auto-registered in ToolRegistry via `serverName__toolName` namespace, with 10s connection timeout, collision protection, dead-server guard, and Promise.allSettled shutdown.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-19T12:58:49Z
- **Completed:** 2026-03-19T13:01:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `adaptMcpTools` factory converts any number of MCP tool definitions into `Tool` objects compatible with the existing `ToolRegistry` — zero changes needed in agent loop
- Full connection loop in `index.ts`: per-server 10s timeout via `Promise.race`, tool discovery via `listTools()`, registration with collision catch, failed servers logged and skipped
- Graceful shutdown disconnects all MCP clients via `Promise.allSettled` (step 3b, after scheduler stop, before in-flight wait)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement McpToolAdapter factory** - `cf87653` (feat)
2. **Task 2: Wire MCP into index.ts** - `ffa7ebd` (feat)

## Files Created/Modified

- `src/mcp/mcp-tool-adapter.ts` — `adaptMcpTools(tools, client, serverName)` factory; namespace prefixing, dead-server guard, isError handling, result normalization, catch block
- `src/index.ts` — Added McpClient/adaptMcpTools imports; replaced placeholder MCP config log with full connection loop; added step 3b MCP disconnect in shutdown

## Decisions Made

- **callTool uses original (unprefixed) name** — the MCP server has no awareness of the `serverName__toolName` prefix added for ToolRegistry; sending prefixed name would cause unknown-tool errors
- **SDK content typed as unknown** — `callTool()` in `@modelcontextprotocol/sdk` types `content` as `unknown` for protocol flexibility; added local `McpCallToolResult` type and cast `as unknown as McpCallToolResult` to access content array safely
- **MCP connection loop before LLM init** — tools must be fully registered before the first agent call; placing after `loadToolManifest` maintains built-in > manifest > MCP priority order
- **shutdown step 3b placement** — after `stopScheduler()` (no new scheduled runs can start) but before in-flight wait; ensures MCP clients stay alive until after existing agent runs complete (via the in-flight drain)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cast SDK callTool() content type from unknown**

- **Found during:** Task 1 (implementing execute function)
- **Issue:** `@modelcontextprotocol/sdk` types `callTool()` return value's `content` field as `unknown`; accessing `.filter()`, `.find()`, `.map()` on it caused TS18046 and TS7006 errors
- **Fix:** Added local `McpContentItem` and `McpCallToolResult` type aliases; cast result `as unknown as McpCallToolResult` — safe because MCP spec guarantees the shape
- **Files modified:** `src/mcp/mcp-tool-adapter.ts`
- **Verification:** `npm run typecheck` exits 0
- **Committed in:** `cf87653` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — type system mismatch in SDK)
**Impact on plan:** Cast is safe and necessary; MCP spec guarantees content array shape. No scope creep.

## Issues Encountered

None beyond the SDK type cast described above.

## Next Phase Readiness

- MCP tools are fully integrated with the agent loop — indistinguishable from built-ins
- Phase 07 (security hardening) can reference the `serverName__toolName` naming scheme as an established pattern
- No blocking issues; tool count warning (≤30 budget) deferred to Phase 07 as planned

---
*Phase: 06-mcp-client-layer*
*Completed: 2026-03-19*

## Self-Check: PASSED

- `src/mcp/mcp-tool-adapter.ts` — FOUND (118 lines, above 50-line minimum)
- `src/index.ts` — FOUND (contains McpClient, adaptMcpTools, mcpClients, CONNECT_TIMEOUT_MS, Promise.race, Promise.allSettled)
- `.planning/phases/06-mcp-client-layer/06-02-SUMMARY.md` — FOUND
- Commit `cf87653` — FOUND
- Commit `ffa7ebd` — FOUND
- `npm run typecheck` — PASSED (no errors)
- `npm run build` — PASSED (no errors)
