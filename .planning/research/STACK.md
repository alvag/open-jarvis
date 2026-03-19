# Stack Research

**Domain:** Personal AI agent — Node.js/TypeScript capability expansion
**Researched:** 2026-03-18 (v1.0) | Updated: 2026-03-19 (v1.1 MCP additions)
**Confidence:** HIGH (v1.0 section) | HIGH (v1.1 section — verified via official SDK docs, npm registry, MCP spec)

---

# v1.1: MCP Client Integration + Tool Manifest (NEW)

## What Already Exists — Do Not Re-Evaluate

| Already in Production | Version | Role |
|-----------------------|---------|------|
| Node.js + TypeScript ESM (`"type": "module"`) | locked | Runtime |
| grammy | ^1.35.0 | Telegram channel |
| better-sqlite3 | ^12.6.2 | Memory + persistence |
| croner | ^10.0.1 | Scheduler |
| Tavily + Firecrawl | ^0.7.2 / ^4.16.0 | Web tools |
| `ToolRegistry` + `Tool` interface | custom | Tool registry — extend, not replace |

The `ToolRegistry` holds a `Map<string, Tool>`. Each `Tool` has `definition: ToolDefinition` (name, description, parameters as JSON Schema) and an async `execute()` method. MCP tools are adapted to this same interface — the agent loop needs zero changes.

---

## New Core Dependency

### `@modelcontextprotocol/sdk`

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@modelcontextprotocol/sdk` | `^1.11.0` | MCP client — connect to MCP servers, discover tools, call tools | The only official TypeScript/Node.js MCP client SDK, authored and maintained by Anthropic. v1.x is stable and production-endorsed. **Do not use v2 (pre-alpha)** — anticipated stable release Q2 2026; v1.x will receive security backports for at least 6 months after v2 ships. |
| `zod` | `^3.25.0` | Schema validation — peer dependency required by MCP SDK | The SDK internally imports `zod/v4` but declares the peer dep as `^3.25.0 \|\| ^4.0.0`. Either works. The project currently has no zod — add `zod@^3.25.0` to satisfy the peer dep without adopting v4 churn. |

**Version note:** Latest confirmed stable as of research date is `1.11.0`+. The npm registry reports active 1.x maintenance with no breaking changes in recent releases (v1.25.x, v1.26.x, v1.27.x were all bug-fix / security releases). Install with `npm install @modelcontextprotocol/sdk@latest` to get the current 1.x patch.

---

## Optional Dependency: YAML Manifest Parser

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yaml` | `^2.7.0` | Parse `tools.yaml` manifest config file | Add if the manifest file uses YAML format. ESM-native, TypeScript types built-in (no `@types/` needed). Skip entirely if using JSON — Node.js `JSON.parse` handles that with zero dependencies. |

**Decision:** Use YAML. The tool manifest is a human-edited config file. YAML supports inline comments (`# disabled: true`) which are critical for documenting disabled tools and environment variable references. The `yaml` package (v2.x) is the ecosystem standard for ESM TypeScript projects.

---

## Transport Options

Three transport classes ship in `@modelcontextprotocol/sdk`. For v1.1, implement in priority order:

| Transport Class | Import Path | Use Case | Status |
|-----------------|-------------|----------|--------|
| `StdioClientTransport` | `@modelcontextprotocol/sdk/client/stdio.js` | Spawn local MCP servers as subprocesses (filesystem, git, shell wrappers, etc.) | Stable — **implement first** |
| `StreamableHTTPClientTransport` | `@modelcontextprotocol/sdk/client/streamableHttp.js` | Connect to remote HTTP MCP servers | Stable — current MCP spec standard (2025-03-26) |
| `SSEClientTransport` | `@modelcontextprotocol/sdk/client/sse.js` | Connect to legacy HTTP+SSE servers (pre-2025-03-26 spec) | Deprecated for new servers but needed for backwards compatibility |

**For Jarvis v1.1:** `StdioClientTransport` covers the primary use case — local MCP servers running on macOS. Add `StreamableHTTPClientTransport` with SSE fallback as a second pass for any remote servers in the manifest.

**Backwards-compatible HTTP pattern** (handles both modern and legacy remote servers):
```typescript
try {
  const transport = new StreamableHTTPClientTransport(serverUrl);
  await client.connect(transport);
} catch {
  // Fall back to legacy SSE transport
  const transport = new SSEClientTransport(serverUrl);
  await client.connect(transport);
}
```

---

## Integration with Existing `ToolRegistry`

The MCP SDK's `client.listTools()` returns tools with shape `{ name, description, inputSchema }`. This maps directly onto the existing `ToolDefinition` interface. No changes to `ToolRegistry` or the agent loop are needed.

A thin adapter class bridges MCP tools into the registry:

```typescript
// Conceptual pattern — not prescriptive implementation
import type { Tool, ToolDefinition, ToolResult } from "../tool-types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

class McpToolAdapter implements Tool {
  definition: ToolDefinition; // mapped from MCP tool.name/description/inputSchema
  private client: Client;

  execute(args: Record<string, unknown>): Promise<ToolResult> {
    return this.client.callTool({
      name: this.definition.name,
      arguments: args,
    }).then(result => ({ success: true, data: result.content }))
      .catch(err => ({ success: false, data: null, error: err.message }));
  }
}
```

One `McpToolAdapter` per MCP tool, registered via `registry.register(adapter)`. The LLM sees a flat, unified list of tools with no knowledge of which are custom vs MCP-sourced.

---

## Tool Manifest Configuration Structure

The manifest file (`tools.yaml`) declares which built-in tools are active and which MCP servers to connect to at startup. This follows the de-facto standard convention used by Claude Desktop, VS Code, LibreChat, and Roo Code:

```yaml
# tools.yaml — Jarvis tool manifest
# Controls which built-in tools are active and which MCP servers to connect to.

builtIn:
  enabled:
    - get-current-time
    - save-memory
    - search-memories
    - web-search
    - web-scrape
    - execute-command
    - schedule-task
    - gws-calendar
    - gws-gmail
    - gws-drive
    - gws-sheets
    - bitbucket-prs

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/max/Documents"]
    env: {}

  # github:
  #   type: stdio
  #   command: npx
  #   args: ["-y", "@modelcontextprotocol/server-github"]
  #   env:
  #     GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"

  # remote-example:
  #   type: streamable-http
  #   url: "https://mcp.example.com/mcp"
  #   disabled: true
```

**Manifest fields per server:**

| Field | Required | Values | Purpose |
|-------|----------|--------|---------|
| `type` | Yes | `stdio`, `streamable-http`, `sse` | Selects transport class |
| `command` | For `stdio` | string | Executable to spawn |
| `args` | For `stdio` | string[] | Arguments to `command` |
| `env` | No | object | Extra env vars for subprocess |
| `url` | For `streamable-http`/`sse` | string | Server endpoint |
| `disabled` | No | boolean | Skip server at startup without removing config |
| `timeout` | No | number (ms) | Per-request timeout override (default: 30000) |

This structure is intentionally compatible with `claude_desktop_config.json` — MCP servers configured for Claude Desktop can be copy-pasted into the Jarvis manifest.

---

## Installation

```bash
# Required: MCP client SDK + zod peer dependency
npm install @modelcontextprotocol/sdk zod

# Optional: YAML manifest support (skip if using JSON config)
npm install yaml
```

No new dev dependencies needed — `@modelcontextprotocol/sdk` ships TypeScript declarations.

---

## What NOT to Add (v1.1 Scope)

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@modelcontextprotocol/sdk` v2 | Pre-alpha, breaking API changes, no production endorsement. v2 changes import paths and auth API. | `^1.11.0` — stable, maintained, production-endorsed |
| `@automatalabs/mcp-client-manager` | Third-party wrapper over the SDK; low adoption; hides lifecycle control you need (startup ordering, per-server reconnect). | Write a thin `McpClientManager` class in-project using the SDK `Client` directly |
| Any HTTP server framework (Fastify, Hono, Express) | Not needed to *consume* remote MCP servers — `StreamableHTTPClientTransport` handles outbound HTTP. | Just the transport class from the SDK |
| Zod as a direct app dependency for manifest validation | The peer dep from the MCP SDK already satisfies this. Adding zod schemas for the manifest config is over-engineering for a human-controlled personal agent config. | TypeScript interface + type assertion at config load boundary |
| `js-yaml` | Requires `@types/js-yaml` separately; older API surface. | `yaml@^2.7.0` — ESM-native, types built-in, active maintenance |

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@modelcontextprotocol/sdk` v1.x | v2 pre-alpha | Only after stable v2 release (anticipated Q2 2026) |
| `yaml` package | JSON-only manifest (no dep) | If comments in the config are not needed — eliminates the dependency entirely |
| Custom `McpClientManager` (in-project) | `@automatalabs/mcp-client-manager` | If you want zero custom management code and accept reduced lifecycle control |
| `StdioClientTransport` for local servers | Docker-based MCP server isolation | If security model requires subprocess isolation — out of scope for personal Mac agent |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@modelcontextprotocol/sdk@^1.11.0` | Node.js `>=18` | Project runs Node.js 22 — fully compatible |
| `@modelcontextprotocol/sdk@^1.11.0` | `"type": "module"` (ESM) | SDK is ESM-first; project already has `"type": "module"` — no shim needed. Import with `.js` extension: `import { Client } from "@modelcontextprotocol/sdk/client/index.js"` |
| `@modelcontextprotocol/sdk@^1.11.0` | `zod@^3.25.0` or `zod@^4.0.0` | SDK's peer dep allows both; `zod@^3.25.0` is the safer floor for a new install |
| `yaml@^2.7.0` | ESM, Node.js 14+ | ESM-native, no compatibility issues |

---

## Sources

- [npmjs.com/@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — latest stable 1.x, peer dependency requirements — HIGH confidence
- [github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md) — `Client` API, `StdioClientTransport`, `StreamableHTTPClientTransport`, `SSEClientTransport`, tool listing and calling — HIGH confidence
- [github.com/modelcontextprotocol/typescript-sdk/releases](https://github.com/modelcontextprotocol/typescript-sdk/releases) — v1.x stable, v2 pre-alpha status — HIGH confidence
- [modelcontextprotocol.io/specification/2025-03-26/basic/transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) — official spec: stdio + Streamable HTTP standard; SSE deprecated — HIGH confidence
- [npmjs.com/package/yaml](https://www.npmjs.com/package/yaml) — v2.x ESM-native — MEDIUM confidence
- [librechat.ai MCP server config structure](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers) — manifest field conventions — MEDIUM confidence (third-party implementation of de-facto standard)

---

# v1.0: Web, Shell, Scheduling, Supervisor (EXISTING — Do Not Modify)

> This section documents the v1.0 stack decisions. Already shipped. Included for historical record.

## Context

Four capability domains added in v1.0:
1. Web search
2. Web scraping
3. Code/shell execution with security
4. Task scheduling
5. Supervisor enhancements

---

## Recommended Stack

### Web Search

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@tavily/core` | `^0.7.2` | Search API optimized for LLM agents | Purpose-built for agent use: returns ranked snippets, relevance scores, and citations in formats agents consume directly. Has official JS/TS SDK with types. Free tier: 1,000 queries/month. Used in LangChain ecosystem. |
| `brave-search` (REST via fetch) | N/A (REST) | Fallback / secondary search source | Completely independent index with low SEO spam. $5/1,000 queries with $5 free monthly credit. No official Node SDK — call via native `fetch` with API key header. Use as fallback if Tavily quota exhausted. |

**Decision: Tavily as primary.** Tavily is the only search API explicitly designed for LLM agent workflows — it returns summaries, not raw HTML dumps. Brave is a solid fallback for cost control.

**Confidence:** MEDIUM — Tavily version from npm search result (20 days old). Brave pricing confirmed from official announcement.

### Web Scraping

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `cheerio` | `^1.2.0` | HTML parsing and content extraction | Stable 1.0 release (Oct 2024), jQuery-like API, no browser runtime required. For static pages — correct 90% of the time for URLs an agent visits. TypeScript typings included. |
| `axios` | `^1.8.x` | HTTP client for fetching pages | Already a standard transitive dependency in many projects; handles redirects, timeouts, custom headers. Use over native `fetch` here because you need timeout control and explicit error handling in tool context. |

**What NOT to use for scraping:**
- Playwright/Puppeteer — JavaScript-rendered pages are a corner case for an agent reading articles/docs. Full browser adds 200+ MB of Chromium to the install and 2-3 second cold start per scrape. Defer until a specific use case demands it.

**Confidence:** HIGH — Cheerio 1.2.0 confirmed from npm search result (2 months ago).

### Code / Shell Execution

This is the highest-risk capability. The project explicitly rules out Docker/containers, so security must be enforced in-process.

**Chosen approach: `child_process.execFile` with a structured allow-list, timeout, and maxBuffer cap.**

No sandbox library is recommended for the shell command use case. Here is why:

| Option | Status | Verdict |
|--------|--------|---------|
| `vm2` | Resurrected in Oct 2025 (v3.10.0) after 2023 abandonment, but CVE-2026-22709 (CVSS 9.8) disclosed Jan 2026 — new critical escape | DO NOT USE |
| `node:vm` | Built-in, but NOT a sandbox — documented by Node.js team as unsuitable for untrusted code | DO NOT USE |
| `isolated-vm` | v6.0.2 (Oct 2025), uses V8 isolates. Best-in-class for running untrusted JS in a JS context | USE ONLY if agent generates JS to execute |
| `child_process.execFile` | Built-in, shell-bypass, configurable timeout/maxBuffer | USE for shell commands with allow-list |

**For shell commands (primary use case):**

Use `child_process.execFile` (not `exec`, not `spawn` with `shell: true`). `execFile` does not invoke a shell — it passes arguments directly to the OS, eliminating shell injection. Combine with:
- An explicit **allow-list** of permitted executables (not a blacklist — blacklists fail)
- `timeout` option (e.g., 10,000 ms)
- `maxBuffer` cap (e.g., 5 MB)
- A per-tool permission manifest checked before execution
- Human approval via Telegram for any tool flagged as high-risk

**Confidence:** HIGH — vm2 CVE confirmed via HackerNews/Endor Labs Jan 2026. isolated-vm v6.0.2 confirmed from GitHub releases page. `execFile` recommendation from official Node.js security guidance.

### Task Scheduling

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `croner` | `^10.0.1` | In-process cron scheduler | Zero dependencies. TypeScript-native. Supports full cron syntax including seconds and year fields, timezone targeting, pause/resume/stop, and async handlers. Used by PM2, ZWave JS, Uptime Kuma. v10.0.0 added OCPS 1.4 compliance and DST fixes. Works in-process — no external process or database needed. |

**Why not alternatives:**
- `node-cron`: No timezone support, no pause/resume, no browser/Deno compat, last meaningful update was years ago.
- `toad-scheduler`: Good for simple intervals but requires croner anyway for cron syntax.
- `node-schedule`: More stars but larger surface area.
- Agenda/Bull: Require Redis or MongoDB — unnecessary infrastructure for a single-process personal agent.

### Supervisor Enhancements

All implemented without new dependencies using Node.js built-ins:

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `child_process` (built-in) | Node.js 22 | Spawn bot subprocess, detect hang via IPC heartbeat | Already used by supervisor |
| `node:fs/promises` + `child_process.execSync` | Built-in | Detect git changes for auto-update | Poll `git rev-parse HEAD` every 60s |
| SIGTERM handler (built-in) | Node.js 22 | Graceful shutdown | Complete in-flight calls, flush SQLite WAL, close grammy |

---

## Installation (v1.0)

```bash
# Web search + scraping
npm install @tavily/core axios cheerio

# Task scheduling
npm install croner
```

---

## Version Compatibility (v1.0)

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `croner@10.0.1` | Node.js 18, 20, 22 | Zero dependencies, ESM + CJS dual export |
| `@tavily/core@0.7.2` | Node.js >= 18 | ESM only (matches project `"type": "module"`) |
| `cheerio@1.2.0` | Node.js 18+ | ESM + CJS, TypeScript bundled |
| `axios@1.8.x` | Node.js 18+ | Dual CJS/ESM, TypeScript bundled |

---

## v1.0 Sources

- Tavily npm: https://www.npmjs.com/package/@tavily/core — version 0.7.2 (MEDIUM confidence)
- Cheerio: https://cheerio.js.org/blog/cheerio-1.0 — 1.0 release details (HIGH confidence)
- isolated-vm GitHub releases: https://github.com/laverdet/isolated-vm/releases — v6.0.2 October 2025 (HIGH confidence)
- vm2 CVE-2026-22709: https://www.endorlabs.com/learn/cve-2026-22709-critical-sandbox-escape-in-vm2-enables-arbitrary-code-execution (HIGH confidence)
- croner v10.0.0/10.0.1: https://www.npmjs.com/package/croner (HIGH confidence)
- Node.js execFile security: https://securecodingpractices.com/prevent-command-injection-node-js-child-process-safer-execution-with-execfile/ (HIGH confidence)

---
*Stack research for: Jarvis personal AI agent capability expansion*
*v1.0 researched: 2026-03-18 | v1.1 MCP additions researched: 2026-03-19*
