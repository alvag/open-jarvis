---
phase: 06-mcp-client-layer
plan: 01
subsystem: mcp
tags: [mcp, sdk, transport, lifecycle, stdio, http]
dependency_graph:
  requires: [src/tools/mcp-config-loader.ts, src/logger.ts]
  provides: [src/mcp/mcp-client.ts]
  affects: [src/mcp/mcp-tool-adapter.ts (Plan 02), src/index.ts (Plan 02)]
tech_stack:
  added: ["@modelcontextprotocol/sdk@^1.27.1"]
  patterns: ["class lifecycle wrapper", "dual transport (stdio + StreamableHTTP)", "crash detection via transport callbacks"]
key_files:
  created: [src/mcp/mcp-client.ts]
  modified: [package.json, package-lock.json]
decisions:
  - "onclose callback checks isAlive before logging to suppress spurious warnings on clean disconnect"
  - "disconnect() sets isAlive=false before client.close() to prevent spurious onclose warning"
  - "Connection timeout (10s) is NOT in McpClient — applied externally via Promise.race in index.ts"
  - "process.env merged first in stdio env to ensure PATH/NODE_PATH available for npx-based servers"
metrics:
  duration: "~2 minutes"
  completed_date: "2026-03-19"
  tasks_completed: 2
  files_created: 1
  files_modified: 2
---

# Phase 06 Plan 01: McpClient Lifecycle Wrapper Summary

**One-liner:** McpClient class wrapping @modelcontextprotocol/sdk Client with dual stdio/StreamableHTTP transport, isAlive state, and crash detection via onclose/onerror callbacks.

## What Was Built

`src/mcp/mcp-client.ts` — a single exported class `McpClient` that encapsulates all transport-level complexity for MCP server connections. The adapter layer (Plan 02) can focus purely on tool conversion and registry wiring.

### Class Surface

| Member | Type | Description |
|--------|------|-------------|
| `name` | `readonly string` | Server name from config |
| `isAlive` | `get boolean` | Connection state: false → true (connect) → false (disconnect/crash) |
| `connect()` | `async void` | Wires callbacks, connects transport, sets isAlive=true |
| `disconnect()` | `async void` | Sets isAlive=false first, then calls client.close() |
| `listTools()` | `async` | Delegates to SDK client.listTools() |
| `callTool(name, args)` | `async` | Delegates to SDK client.callTool() |

### Transport Strategy

- **stdio**: `StdioClientTransport` with `{ ...process.env, ...config.env }` merge (ensures PATH/NODE_PATH for npx-based servers), `stderr: "pipe"` for log capture
- **StreamableHTTP**: `StreamableHTTPClientTransport` with URL + requestInit headers

### Crash Detection

- `transport.onclose` wired BEFORE `connect()` — SDK calls `transport.start()` synchronously inside `connect()`
- `onclose` checks `_isAlive` before logging warning — suppresses spurious log on clean shutdown
- `disconnect()` sets `_isAlive = false` before `client.close()` — ensures onclose callback is a no-op during intentional shutdown

## Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install SDK and create src/mcp/ | 953becf | package.json, package-lock.json |
| 2 | Implement McpClient class | dab5acf | src/mcp/mcp-client.ts |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/mcp/mcp-client.ts` — FOUND (113 lines, above 70-line minimum)
- `package.json` contains `@modelcontextprotocol/sdk` — FOUND
- Commit 953becf — FOUND
- Commit dab5acf — FOUND
- `npm run typecheck` — PASSED (no errors)
- No deferred features (auto-reconnect, allowedTools, list_changed) imported — CONFIRMED
