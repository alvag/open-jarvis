# Feature Research

**Domain:** MCP client integration — declarative tool manifest, hybrid tool approach for personal AI agent
**Researched:** 2026-03-19
**Confidence:** HIGH (MCP SDK official docs, spec v2025-06-18, community patterns verified)

## Context

This is a v1.1 milestone research file. It covers ONLY the new features being added to the already-shipped v1.0 Jarvis agent. The existing tool registry uses a `Map<string, Tool>` with `{ definition: ToolDefinition, execute() }` — any MCP integration must fit into or extend this pattern without breaking existing tools.

---

## Feature Landscape

### Table Stakes (Users Expect These)

For an MCP client milestone, these are the minimum features without which "MCP support" would be meaningless.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Connect to MCP servers via stdio | Stdio is the universal transport for local MCP servers; all standard servers (filesystem, git, etc.) use it | MEDIUM | `StdioClientTransport` from `@modelcontextprotocol/sdk` spawns the server as a subprocess. Command + args + env in config. 1:1 client-to-server, so multiple servers need multiple client instances. |
| Discover tools from connected servers | Without tool discovery, the agent can't use MCP tools. `listTools()` must run at startup and results must be injected into the OpenRouter tool definitions. | LOW | `client.listTools()` returns paginated results: `{ tools, nextCursor }`. Each tool has `name`, `description`, `inputSchema`. Cache result; only re-fetch when server sends `tools/list_changed` notification. |
| Execute MCP tools from the agent loop | When the LLM picks an MCP tool, it must invoke via `client.callTool({ name, arguments })` and convert the result to `ToolResult` format the agent loop expects | MEDIUM | MCP `callTool` returns `{ content: ContentItem[], isError: boolean }`. Must be normalized to `{ success, data, error }` matching `ToolResult`. Text content is the common case; handle `isError` as `success: false`. |
| Declarative tool manifest file | Users expect to add/remove MCP servers without touching TypeScript. A JSON/YAML file that lists servers with command, args, env, and enabled flag is the de facto pattern (Claude Desktop, Continue, VS Code all use this) | LOW | JSON is simpler than YAML for Node.js (no extra dependency). Schema: `{ servers: { [name]: { command, args, env, enabled, allowedTools? } } }`. Load on startup; parse with `zod` for type safety (already a peer dep of MCP SDK). |
| Enable/disable servers without code changes | The `enabled: false` field must cause the server to be skipped at startup — no connection, no tool registration | LOW | Filter `Object.entries(manifest.servers).filter(([, s]) => s.enabled !== false)` before connecting. When disabled, server tools simply don't appear in the registry. |
| Namespace prefixing for tool names | Tool name collisions are a documented, well-known problem across MCP servers. A server called `filesystem` and another called `github` could both expose a `search` tool | MEDIUM | Prefix convention: `{serverName}__{toolName}` (double-underscore separator). The agent loop passes this prefixed name to the LLM. On execution, strip prefix to get actual tool name, look up the right client by server name. Cursor uses `mcp_{server}_{tool}`. Double-underscore avoids confusion with single-underscore in tool names. |
| Graceful shutdown of MCP connections | MCP clients hold child processes (stdio) or HTTP sessions open. On SIGTERM, all must be closed before process.exit() | LOW | Call `await client.close()` for each connected MCP client in the existing shutdown sequence, after `stopScheduler()` and before `db.close()`. |

### Differentiators (Competitive Advantage)

Features that make this MCP integration better than the minimum.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-server `allowedTools` filter in manifest | Expose only the tools from a server that are actually useful. Reduces LLM context window bloat (MCP servers often expose 20+ tools, most irrelevant) | LOW | Manifest field: `allowedTools: ["read_file", "write_file"]`. After `listTools()`, filter the result before registering. Only the listed tools are namespaced and added to the registry. If `allowedTools` is absent, all tools are exposed. |
| Tool list caching with invalidation | Calling `listTools()` on every agent invocation adds latency. Cache per-server tool lists in memory after initial connection | LOW | Store `Map<serverName, ToolDefinition[]>` in the MCP manager. Re-fetch only when server emits `notifications/tools/list_changed`. For stdio servers that don't emit this, cache is permanent for the process lifetime. |
| Lazy-start stdio servers (on-demand connection) | Stdio servers that are rarely used shouldn't hold processes open at all times. Connect on first tool use, keep alive for the session | HIGH | Requires deferred connection logic: manifest parsed at startup, but `client.connect()` deferred until first tool call for that server. Increases first-call latency but reduces idle process count. Likely over-engineered for a personal agent with 3-5 MCP servers. Defer to v2. |
| Per-server environment variable injection | MCP servers often need API keys (e.g., a GitHub MCP server needs GITHUB_TOKEN). These should come from `.env`, not be hardcoded in the manifest | LOW | Manifest env values support `${VAR_NAME}` substitution resolved from `process.env` at load time. Simple regex replace: `value.replace(/\$\{([^}]+)\}/g, (_, k) => process.env[k] ?? '')`. Prevents secrets in version-controlled manifest files. |
| Startup connectivity check with failure tolerance | A mis-configured MCP server should not crash Jarvis. A failed connection should log a warning and continue | LOW | Wrap each `client.connect()` in try/catch. On failure: log error with server name, skip registration, continue. Jarvis comes up healthy with remaining servers. Alert user via Telegram broadcast if any servers failed to connect. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| HTTP/SSE transport for MCP servers | Remote MCP servers are sometimes on HTTP | For a personal Mac agent, all useful MCP servers run locally via stdio. HTTP transport adds OAuth, network configuration, and session management complexity. SSE is also deprecated as of protocol version 2024-11-05. | Start with stdio only. Add StreamableHTTP transport in v2 when there is a concrete server that requires it. The SDK supports it; adding it later is low risk. |
| MCP server auto-discovery | Some systems auto-discover available servers | No standard discovery mechanism exists in MCP spec. Auto-discovery would require scanning PATH or registries — fragile and platform-dependent. | Explicit manifest file. User adds servers they want. Explicit > implicit for a security-sensitive agent. |
| Separate MCP tool namespace in LLM context | Presenting custom tools and MCP tools separately to the LLM | The LLM should not need to reason about tool provenance. Separate namespacing in the system prompt adds cognitive overhead and may bias the LLM away from MCP tools | Single flat tool list. Namespace prefixes handle collision; the LLM sees one unified list. |
| Dynamic manifest reload without restart | Hot-reload the manifest when the file changes | MCP connections are stateful (child processes, TCP sessions). Hot-reloading requires tearing down and re-establishing connections, which is complex and error-prone. The agent already supports `/restart` for restarts. | Use `/restart` after editing the manifest. Fast restart (< 3s via supervisor) makes hot-reload unnecessary. |
| MCP server sandboxing | Run MCP server processes in a sandbox | MCP servers run as trusted processes on the user's machine, invoked with explicit manifest commands. Sandboxing them adds container/namespace complexity. The user controls which servers are in the manifest. | Verify the manifest is not world-writable. Trust model: user wrote the manifest, user trusts the server. Same model as npm scripts. |
| Migrate custom tools to MCP servers | Convert all built-in tools (Gmail, Calendar, etc.) to MCP servers | Existing custom tools work, have deep integration (approval gate, Telegram context, ToolContext), and access internal state (SQLite, sessions). Migrating them to MCP would lose this integration and add a server-per-tool overhead. | Keep custom tools as custom tools. MCP is for external/third-party capabilities. This is the hybrid approach. |

---

## Feature Dependencies

```
[Tool Manifest File]
    └──enables──> [MCP Server Connections]
    └──enables──> [Enable/Disable Servers]
    └──enables──> [allowedTools filter]
    └──enables──> [env var injection]

[MCP Server Connections]
    └──requires──> [@modelcontextprotocol/sdk installed]
    └──requires──> [MCP Manager module]
    └──produces──> [Tool Discovery]
    └──produces──> [Tool Execution]

[Tool Discovery (listTools)]
    └──requires──> [MCP Server Connections]
    └──produces──> [Namespaced tool definitions]
    └──feeds into──> [Existing ToolRegistry.register()]
    └──requires──> [Namespace prefix logic]

[Namespace Prefix Logic]
    └──requires──> [Tool Discovery]
    └──enables──> [Tool Execution routing]
    └──prevents──> [Tool name collisions]

[MCP Tool Execution]
    └──requires──> [Tool Discovery] (must know which server owns which tool)
    └──requires──> [callTool() adapter]
    └──requires──> [ToolResult normalization] (MCP content[] → {success, data, error})
    └──fits into──> [Existing ToolRegistry.execute()]

[Hybrid Tool Registry]
    └──requires──> [Tool Discovery] (MCP tools registered alongside custom tools)
    └──requires──> [MCP Tool Execution] (execute() delegates to MCP client or custom handler)
    └──preserves──> [All existing custom tools] (no changes to custom tools)
    └──transparent to──> [Agent loop] (agent loop calls toolRegistry.execute() without knowing tool type)

[Graceful Shutdown MCP]
    └──requires──> [MCP Server Connections]
    └──extends──> [Existing shutdown() sequence in index.ts]
```

### Dependency Notes

- **Tool Discovery feeds into existing ToolRegistry:** The design goal is that MCP tools are registered into the same `ToolRegistry` as custom tools. The `execute()` method of the MCP tool wrapper calls `client.callTool()`. The agent loop doesn't need to know tool type.
- **Namespace Prefix Logic is a hard prerequisite:** Without it, any two servers with overlapping tool names will cause a `Tool already registered` error in ToolRegistry. This must be implemented before any tool can be registered from MCP.
- **ToolResult normalization is a one-way adapter:** MCP returns `content[]` with typed items; the existing agent loop expects `{ success, data, error }`. A thin adapter converts `isError` to `success: false` and concatenates text content items into the `data` field as a string.
- **Hybrid approach is transparent to the agent loop:** `runAgent()` in `agent.ts` calls `toolRegistry.execute(name, args, context)`. It does not need to change. MCP tools appear identical to custom tools from its perspective.

---

## MVP Definition

### Launch With (v1.1 — this milestone)

Minimum viable MCP integration. Adds external server capability without touching the agent loop.

- [ ] `@modelcontextprotocol/sdk` installed as a dependency
- [ ] Tool manifest file (`tools.json` or `manifest.json`) — JSON format, loaded from `data/` or project root
- [ ] Manifest schema: `{ servers: { [name]: { command, args?, env?, enabled?, allowedTools? } } }`
- [ ] MCP Manager module — connects to enabled servers, caches tool lists, exposes execute method
- [ ] Namespace prefix logic — `{serverName}__{toolName}` convention
- [ ] MCP tool wrapper that implements `Tool` interface and delegates to `client.callTool()`
- [ ] ToolResult normalization (MCP content[] → existing ToolResult format)
- [ ] MCP connections closed in existing graceful shutdown sequence
- [ ] Failed MCP connections logged + skipped (don't crash Jarvis)
- [ ] Env var interpolation in manifest values (`${TOKEN}` syntax)

### Add After Validation (v1.1.x)

Features to add once the core MCP pipeline is working in daily use.

- [ ] `allowedTools` filter per server — trigger: a connected server exposes too many irrelevant tools
- [ ] Tool list invalidation via `tools/list_changed` notification — trigger: a connected server starts emitting these notifications
- [ ] Startup Telegram notification listing which MCP servers connected vs failed — trigger: user asks "why isn't the GitHub tool showing up"

### Future Consideration (v2+)

- [ ] StreamableHTTP transport — defer until a concrete remote server is needed
- [ ] Lazy/on-demand stdio server connections — defer; premature optimization for personal use
- [ ] MCP resources and prompts (not just tools) — MCP spec has three primitives; tools is sufficient for v1.1
- [ ] Per-tool security approval gate for MCP tools — MCP tools bypass the existing HITL gate; adding this requires knowing tool semantics upfront

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Tool manifest file (JSON) | HIGH | LOW | P1 |
| MCP Manager + server connections (stdio) | HIGH | MEDIUM | P1 |
| Tool discovery (listTools + caching) | HIGH | LOW | P1 |
| Namespace prefix logic | HIGH | LOW | P1 (required for collision-free registration) |
| MCP tool wrapper (Tool interface adapter) | HIGH | LOW | P1 |
| ToolResult normalization | HIGH | LOW | P1 |
| Env var interpolation in manifest | MEDIUM | LOW | P1 (security best practice) |
| Graceful shutdown for MCP clients | MEDIUM | LOW | P1 |
| allowedTools filter | MEDIUM | LOW | P2 |
| tools/list_changed invalidation | LOW | MEDIUM | P2 |
| Startup failure tolerance + Telegram alert | MEDIUM | LOW | P2 |
| StreamableHTTP transport | LOW | MEDIUM | P3 |
| Lazy connection (on-demand stdio) | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.1 launch
- P2: Should have, add when core is working
- P3: Nice to have, future consideration

---

## Existing Registry Integration

The integration must thread through the existing `ToolRegistry` without modifying the agent loop or custom tools.

| Existing Component | How MCP Integrates |
|-------------------|--------------------|
| `ToolRegistry.register(tool)` | MCP tools are wrapped in a `Tool`-compatible object and registered here. Each MCP tool has its own `execute()` that calls the right client. |
| `ToolRegistry.execute(name, args, context)` | No change needed. The registry looks up the tool by (namespaced) name and calls its `execute()`. The wrapper handles the MCP round-trip internally. |
| `ToolRegistry.getDefinitions()` | Returns all definitions including MCP tools. OpenRouter sees the full unified list. No changes needed. |
| `src/index.ts` startup sequence | MCP Manager initialized before tool registration. After connecting all servers, registered tools appear alongside custom tools. |
| `shutdown()` in `src/index.ts` | Existing shutdown adds `await mcpManager.closeAll()` before `db.close()`. |
| `ToolContext` (`userId`, `sessionId`) | MCP tools receive ToolContext but cannot use it (MCP protocol has no concept of session context). The wrapper accepts the context parameter for interface compliance but does not forward it to the MCP server. |

### What Does NOT Change

- `agent.ts` — no modifications needed; it calls `toolRegistry.execute()` the same way
- `openrouter.ts` — tool definitions are passed from `toolRegistry.getDefinitions()`; MCP tools appear identical in schema
- All existing custom tools — no changes; they remain registered the same way
- Security approval gate — unchanged; MCP tools do NOT go through the HITL gate in v1.1 (documented limitation; revisit in v2)

---

## Sources

- [MCP TypeScript SDK — Official Docs](https://ts.sdk.modelcontextprotocol.io/) — Client API, transport types, listTools/callTool
- [MCP Spec v2025-06-18 — Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) — Tool result content format, isError semantics, tool definition schema
- [MCP Client Development Guide](https://github.com/cyanheads/model-context-protocol-resources/blob/main/guides/mcp-client-development-guide.md) — Connection lifecycle, error recovery, multi-server patterns
- [MCP TypeScript SDK — GitHub](https://github.com/modelcontextprotocol/typescript-sdk) — StdioClientTransport, StreamableHTTPClientTransport, Client class
- [Building MCP Clients — Node.js Tutorial](https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/) — listTools, callTool patterns
- [MCP Agent Configuration Reference](https://docs.mcp-agent.com/reference/configuration) — allowedTools, env, server config schema patterns
- [Fixing MCP Tool Name Collisions](https://www.letsdodevops.com/p/fixing-mcp-tool-name-collisions-when) — Namespace prefix conventions and wrapper pattern
- [Tool-space interference in MCP era — Microsoft Research](https://www.microsoft.com/en-us/research/blog/tool-space-interference-in-the-mcp-era-designing-for-agent-compatibility-at-scale/) — Collision analysis, 775 collisions found across servers
- [MCP Tool Caching — CodeSignal](https://codesignal.com/learn/courses/efficient-mcp-agent-integration-in-typescript/lessons/tool-caching-for-agents) — cacheToolsList pattern, invalidation
- [Why MCP Deprecated SSE](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) — SSE deprecated, Streamable HTTP is current standard

---
*Feature research for: MCP client integration, tool manifest, hybrid tool approach (Jarvis v1.1)*
*Researched: 2026-03-19*
