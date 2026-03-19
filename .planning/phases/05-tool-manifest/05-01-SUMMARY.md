---
phase: 05-tool-manifest
plan: 01
subsystem: tools
tags: [tool-manifest, mcp, json-config, child-process, security-gate, approval-gate]

# Dependency graph
requires:
  - phase: 04-scheduler
    provides: "approval gate pattern (execute-command.ts fire-and-forget) reused by manifest tools"
provides:
  - "manifest-loader.ts: reads tool_manifest.json, builds Tool objects from script entries, registers in ToolRegistry"
  - "mcp-config-loader.ts: reads mcp_config.json, validates server entries, substitutes ${VAR} in env/headers"
  - "loadToolManifest() wired into index.ts startup after all built-in registrations"
  - "loadMcpConfig() wired into index.ts startup, result stored for Phase 6 connection"
  - "tool_manifest.json and mcp_config.json excluded via .gitignore"
  - "Example files (tool_manifest.json.example, mcp_config.json.example) document schema"
affects: [06-mcp-client, 07-mcp-security]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "JSON config loaders with graceful degradation (missing file = info log + continue)"
    - "Child process execution with stdin JSON args and stdout JSON ToolResult"
    - "Approval gate wiring via module-level setters (same as execute-command.ts)"
    - "${VAR} regex substitution for env/headers fields in mcp_config.json"

key-files:
  created:
    - src/tools/manifest-loader.ts
    - src/tools/mcp-config-loader.ts
    - tool_manifest.json.example
    - mcp_config.json.example
  modified:
    - src/index.ts
    - .gitignore
    - .env.example

key-decisions:
  - "Built-in tools have collision priority: manifest tool is skipped if name already registered"
  - "Scripts (.py, .sh, .ts) always classified as risky by command-classifier, always require approval"
  - "McpServerConfig stored but not connected in Phase 5 — actual MCP connections in Phase 6"
  - "Interpreter resolution by extension: .py→python3, .sh→/bin/bash, .ts→tsx, other→direct execute"
  - "${VAR} substitution applies only to env and headers fields, not command/args (security boundary)"
  - "Any undefined ${VAR} skips the entire MCP server (fail-closed per missing secrets)"

patterns-established:
  - "loadToolManifest(registry): call after all built-in registrations to give built-ins collision priority"
  - "loadMcpConfig(): returns McpServerConfig[] for Phase 6 to connect; Phase 5 only parses"
  - "Manifest tool execute(): classifyCommand on handler_path, risky path uses fire-and-forget approval (matches execute-command.ts pattern exactly)"
  - "substituteEnvVars(value, serverName): returns string | null (null = skip server)"

requirements-completed: [MNFST-01, MNFST-02, MNFST-03]

# Metrics
duration: 4min
completed: 2026-03-19
---

# Phase 05 Plan 01: Tool Manifest Summary

**JSON config loaders for local script tools (tool_manifest.json) and MCP server declarations (mcp_config.json) with child process execution, ${VAR} substitution, and full security gate integration**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-19T11:12:56Z
- **Completed:** 2026-03-19T11:16:40Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- `manifest-loader.ts`: reads `tool_manifest.json`, builds Tool objects from script entries, spawns child processes with stdin/stdout JSON protocol, applies 3-layer security gate (blocked → risky approval → safe execute)
- `mcp-config-loader.ts`: reads `mcp_config.json`, validates stdio and streamable-http server entries, substitutes `${VAR}` tokens in env/headers using regex, returns `McpServerConfig[]` for Phase 6
- Both loaders wired into `src/index.ts` startup after all built-in registrations; approval gate wired to same Telegram gate as `execute_command`
- `.gitignore` excludes actual config files; `.env.example` documents `MANIFEST_PATH`/`MCP_CONFIG_PATH` overrides

## Task Commits

Each task was committed atomically:

1. **Task 1: Create manifest-loader.ts for local script tools** - `6ebcd28` (feat)
2. **Task 2: Create mcp-config-loader.ts with ${VAR} substitution** - `09bde09` (feat)
3. **Task 3: Wire loaders into index.ts and update config files** - `14ec8e9` (feat)

**Plan metadata:** (docs commit follows this summary)

## Files Created/Modified
- `src/tools/manifest-loader.ts` - Loads tool_manifest.json; ManifestEntry → Tool objects with child process execution and approval gate
- `src/tools/mcp-config-loader.ts` - Loads mcp_config.json; McpServerConfig with ${VAR} substitution in env/headers
- `tool_manifest.json.example` - Example manifest with .py and .sh tool entries
- `mcp_config.json.example` - Example with stdio (filesystem, github with ${VAR} env), and disabled streamable-http server
- `src/index.ts` - Added loadToolManifest, loadMcpConfig calls and manifest approval gate wiring
- `.gitignore` - Added tool_manifest.json and mcp_config.json
- `.env.example` - Added MANIFEST_PATH and MCP_CONFIG_PATH documentation

## Decisions Made
- Built-in tools have collision priority: if manifest tool name matches registered built-in, manifest tool is skipped with error log (same collision error thrown by ToolRegistry.register())
- Scripts always classified as risky by command-classifier (SCRIPT_EXTENSIONS includes .py/.sh/.ts), so manifest tools that are scripts always go through approval gate
- McpServerConfig is loaded and stored but not connected in Phase 5 — actual MCP server connections happen in Phase 6
- Any undefined `${VAR}` in env or headers causes the entire MCP server to be skipped (fail-closed)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Users create their own `tool_manifest.json` and `mcp_config.json` files based on the `.example` files.

## Next Phase Readiness
- Phase 6 (MCP client): `loadMcpConfig()` is wired and returns `McpServerConfig[]` ready for connection logic
- Manifest tools are fully functional at startup when `tool_manifest.json` exists
- Security gate integration is complete — manifest tools use same approval gate as `execute_command`

## Self-Check: PASSED

All created files verified on disk. All task commits verified in git log.

---
*Phase: 05-tool-manifest*
*Completed: 2026-03-19*
