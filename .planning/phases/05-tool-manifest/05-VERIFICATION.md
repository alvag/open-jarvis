---
phase: 05-tool-manifest
verified: 2026-03-19T11:45:00Z
status: gaps_found
score: 5/6 must-haves verified
re_verification: false
gaps:
  - truth: "A tool_manifest.json file with script entries is parsed into Tool objects and registered in ToolRegistry"
    status: partial
    reason: "tool_manifest.json.example was created then intentionally deleted in commit 9e987ba. The tracked tool_manifest.json file exists but is an empty array []. The schema-documentation purpose of the example file is lost. The loader itself functions correctly."
    artifacts:
      - path: "tool_manifest.json.example"
        issue: "File deleted. Replaced by tracked tool_manifest.json (empty array). No example showing handler_path, parameters schema, or interpreter usage."
    missing:
      - "Either restore tool_manifest.json.example as a documentation artifact, or add schema documentation to the tracked tool_manifest.json as a comment-free example entry marked enabled: false"
---

# Phase 05: Tool Manifest Verification Report

**Phase Goal:** JSON config loaders for local-script tools and MCP server declarations, wired into startup.
**Verified:** 2026-03-19T11:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A tool_manifest.json file with script entries is parsed into Tool objects and registered in ToolRegistry | PARTIAL | Loader fully implemented and wired. tool_manifest.json.example deleted post-creation (commit 9e987ba). Tracked tool_manifest.json is empty []. |
| 2 | An mcp_config.json file with mcpServers entries is parsed into McpServerConfig objects | VERIFIED | mcp-config-loader.ts: 215 lines, exports loadMcpConfig + McpServerConfig. mcp_config.json.example valid with all 3 server patterns. |
| 3 | ${VAR} references in env and headers fields are replaced with process.env values at load time | VERIFIED | VAR_PATTERN = /\$\{([^}]+)\}/g in mcp-config-loader.ts:54. substituteEnvVars() handles partial substitution, returns null on missing vars. |
| 4 | Servers with enabled: false are skipped entirely | VERIFIED | manifest-loader.ts:275: `if (e.enabled === false) continue`. mcp-config-loader.ts:136: `if (entry.enabled === false) ... continue`. |
| 5 | Missing or malformed config files produce a log message and Jarvis starts without those tools | VERIFIED | Both loaders have existsSync guard + JSON.parse try/catch with log("info"/"error") then return/return []. Typecheck and build pass clean. |
| 6 | Manifest tool name collision with built-in tool logs error and skips the manifest tool | VERIFIED | manifest-loader.ts:308-316: try { registry.register(tool) } catch { log("error", ..., "collides with existing tool — skipping") } |

**Score:** 5/6 truths verified (Truth 1 partial due to missing example file)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/manifest-loader.ts` | Tool manifest loader for local script tools | VERIFIED | 320 lines. Exports: loadToolManifest, setManifestApprovalGate, setManifestSendApproval, setManifestSendResult. Implements ManifestEntry, buildManifestTool, spawnHandler, resolveInterpreter. |
| `src/tools/mcp-config-loader.ts` | MCP config loader with ${VAR} substitution | VERIFIED | 215 lines. Exports: loadMcpConfig, McpServerConfig. Implements substituteEnvVars with VAR_PATTERN regex. |
| `tool_manifest.json.example` | Example tool manifest with documented schema | MISSING | Created in commit 6ebcd28, deleted in commit 9e987ba. Intentional decision to track tool_manifest.json directly (now empty []). Schema documentation lost. |
| `mcp_config.json.example` | Example MCP config with stdio and HTTP server entries | VERIFIED | 24 lines. Contains: mcpServers key, filesystem (stdio), github (${GITHUB_TOKEN} env), remote-service (streamable-http, enabled: false). Valid JSON. |
| `src/index.ts` | Startup wiring calling both loaders after built-in registrations | VERIFIED | Lines 49-50: imports. Lines 133-141: loadToolManifest(toolRegistry) then loadMcpConfig(). Lines 169-175: manifest approval gate wiring. All appear after last toolRegistry.register() call on line 129. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/tools/manifest-loader.ts | src/tools/tool-registry.ts | registry.register(tool) with try/catch for collision | WIRED | Line 309: registry.register(tool) inside try block. Catch logs collision error. |
| src/tools/manifest-loader.ts | src/security/command-classifier.ts | classifyCommand() for security gate | WIRED | Line 31: static import. Line 103: classifyCommand(handlerPath, []). Line 106: getBlockReason(). |
| src/tools/mcp-config-loader.ts | process.env | VAR_PATTERN regex replacing ${VAR} tokens | WIRED | Line 54: VAR_PATTERN = /\$\{([^}]+)\}/g. Line 64: process.env[varName] lookup in substituteEnvVars. |
| src/index.ts | src/tools/manifest-loader.ts | loadToolManifest(toolRegistry) call after built-in registrations | WIRED | Line 133: loadToolManifest(toolRegistry) at startup, after all toolRegistry.register() calls (last at line 129). |
| src/index.ts | src/tools/mcp-config-loader.ts | loadMcpConfig() call storing result for Phase 6 | WIRED | Line 136: const mcpServerConfigs = loadMcpConfig(). Result used on line 139 for logging. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| MNFST-01 | 05-01-PLAN.md | User can declare MCP servers in a JSON manifest file with type, command, args, env, and enabled fields | SATISFIED | mcp-config-loader.ts validates all these fields. mcp_config.json.example demonstrates them. RawServerEntry interface covers all fields. |
| MNFST-02 | 05-01-PLAN.md | User can use ${VAR} syntax in manifest env fields to reference environment variables without exposing secrets | SATISFIED | substituteEnvVars() with VAR_PATTERN in mcp-config-loader.ts. Applied to both env (line 171) and headers (line 189). Undefined var = skip entire server (fail-closed). |
| MNFST-03 | 05-01-PLAN.md | Jarvis loads manifest at startup and only connects to servers marked enabled: true | SATISFIED | Both loadToolManifest and loadMcpConfig called from index.ts main(). enabled === false check in both loaders skips entries. |

No orphaned requirements — REQUIREMENTS.md traceability table maps MNFST-01, MNFST-02, MNFST-03 exclusively to Phase 5, and all three are claimed in the plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/tools/mcp-config-loader.ts | 108, 119, 129 | `return []` | Info | Legitimate graceful-degradation paths (file not found, parse failure, no mcpServers key). Not stubs. |

No blocker or warning anti-patterns found.

### Post-Phase Deviation: tool_manifest.json.example

After the three plan tasks were completed and committed, an additional commit (`9e987ba`) made an intentional decision:

- **Deleted:** `tool_manifest.json.example`
- **Created:** `tool_manifest.json` (tracked in git, currently `[]`)
- **Removed from .gitignore:** `tool_manifest.json`
- **Rationale (from commit message):** "tool_manifest.json contains internal tool declarations that will grow over time — it should be version controlled. Replaced .example with an empty tracked file."

This is a valid project decision. However it creates a gap: the example file was the only documentation of the schema (handler_path, parameters structure, interpreter rules). The tracked tool_manifest.json is currently empty with no entries to illustrate the format.

`.gitignore` does **not** contain `tool_manifest.json` (intentional post-phase decision). It does contain `mcp_config.json` (correct).

### Human Verification Required

None — all items are verifiable programmatically. The loader behavior (graceful degradation, approval gate firing, child process spawn) follows clear code paths that can be traced statically.

### Gaps Summary

One gap affects goal completeness:

The `tool_manifest.json.example` artifact was deleted post-phase. The plan's purpose for this file was schema documentation — showing users what a valid tool_manifest.json looks like with handler_path, parameters, and interpreter examples. With the file gone and the tracked tool_manifest.json empty, a new user has no in-repo reference for how to write manifest entries. The loader code itself has the schema documented in the file header comment (lines 1-24 of manifest-loader.ts), but there is no runnable example.

**Recommended fix:** Add a commented-out or `enabled: false` example entry to `tool_manifest.json` showing the complete schema, or restore `tool_manifest.json.example` alongside the tracked file.

All five other truths are fully verified. The core functionality — loading, parsing, VAR substitution, security gate, collision detection, startup wiring — is complete and correct. The typecheck and build pass clean.

---

_Verified: 2026-03-19T11:45:00Z_
_Verifier: Claude (gsd-verifier)_
