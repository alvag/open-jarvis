# Architecture Research

**Domain:** Personal AI agent — MCP client integration, tool manifest, hybrid tool approach
**Researched:** 2026-03-19
**Confidence:** HIGH (direct codebase inspection + verified against @modelcontextprotocol/sdk v1.27.1 official docs)

---

## Context

This document covers only the v1.1 milestone additions: MCP client support, tool manifest, and the hybrid tool approach. It builds on the existing v1.0 architecture documented in the prior ARCHITECTURE.md research. Existing components (channels, agent loop, LLM layer, memory, security, scheduler) are not re-architected here — only integration points and new components are described.

---

## System Overview

### Where MCP Client Sits in the Layer Stack

MCP client is a **peer to built-in tools at the tools layer**, not a separate layer. It connects to external processes (MCP servers) and adapts their tools into the same `Tool` interface the registry already uses. The tool manifest sits at the **initialization layer** in `index.ts`, governing which tools (built-in and MCP) are registered before the agent starts.

```
┌────────────────────────────────────────────────────────────────────┐
│                        SUPERVISOR PROCESS                           │
│  src/supervisor.ts — crash recovery, hang detection, auto-update   │
├────────────────────────────────────────────────────────────────────┤
│                          BOT PROCESS                                │
├──────────────────────────────────┬─────────────────────────────────┤
│         CHANNEL LAYER            │       SCHEDULER LAYER            │
│  src/channels/telegram.ts        │  src/scheduler/                  │
│                                  │  (unchanged — runs runAgent())   │
│         ↓                        │         ↓                        │
├──────────────────────────────────┴─────────────────────────────────┤
│                          AGENT LAYER                                │
│  src/agent/agent.ts — LLM ↔ tool loop (unchanged interface)        │
│  src/agent/context-builder.ts — system prompt assembly             │
├──────────────────────────────────┬─────────────────────────────────┤
│       SECURITY LAYER             │         LLM LAYER                │
│  src/security/                   │  src/llm/                        │
│  (unchanged)                     │  (unchanged)                     │
├──────────────────────────────────┴─────────────────────────────────┤
│                          TOOLS LAYER                                │
│  src/tools/tool-manifest.ts   ← NEW: declares what to load         │
│  src/tools/tool-registry.ts   ← UNCHANGED: register + execute      │
│                                                                     │
│  src/tools/built-in/          ← UNCHANGED: existing custom tools   │
│    get-current-time, save-memory, web-search, execute-command...   │
│                                                                     │
│  src/mcp/                     ← NEW: MCP client subsystem          │
│    mcp-client.ts              ← connects to one MCP server         │
│    mcp-manager.ts             ← manages all MCP clients            │
│    mcp-tool-adapter.ts        ← wraps MCP tools as Tool interface  │
├────────────────────────────────────────────────────────────────────┤
│                          MEMORY LAYER                               │
│  src/memory/db.ts — SQLite WAL + FTS5 (unchanged)                  │
└────────────────────────────────────────────────────────────────────┘
│                       EXTERNAL PROCESSES                            │
│  [MCP Server A: stdio]  [MCP Server B: stdio]  [MCP Server C: ...]  │
│  Each is a separate child process managed by mcp-manager.ts        │
└────────────────────────────────────────────────────────────────────┘
```

**Critical constraint:** `agent.ts` and `tool-registry.ts` do not change. The agent loop calls `toolRegistry.getDefinitions()` and `toolRegistry.execute()` exactly as before — MCP tools are registered into the same registry as built-in tools. The agent never knows whether a tool is custom or MCP-sourced.

---

## New Components Required

| Component | File | What It Does | Depends On |
|-----------|------|-------------|-----------|
| Tool manifest | `src/tools/tool-manifest.ts` | Declares which custom tools and MCP servers to load, with enabled flags | Nothing (pure config) |
| MCP client | `src/mcp/mcp-client.ts` | Wraps `@modelcontextprotocol/sdk` Client + StdioClientTransport for one server | `@modelcontextprotocol/sdk` |
| MCP manager | `src/mcp/mcp-manager.ts` | Starts all enabled MCP servers, collects their tools, owns lifecycle | `mcp-client.ts` |
| MCP tool adapter | `src/mcp/mcp-tool-adapter.ts` | Converts an MCP tool definition + callTool into a `Tool` object | `tool-types.ts`, `mcp-client.ts` |

### Modified Components

| Component | File | Change |
|-----------|------|--------|
| `index.ts` | `src/index.ts` | Add manifest loading + MCP manager startup; register adapted tools into existing registry |
| `config.ts` | `src/config.ts` | Add `MCP_MANIFEST_PATH` env var (optional, default `./tools.manifest.json`) |
| Graceful shutdown | `src/index.ts` shutdown block | Add `mcpManager.disconnectAll()` before `db.close()` |

---

## Tool Manifest Design

### File Format

```jsonc
// tools.manifest.json
{
  "customTools": {
    "get_current_time": { "enabled": true },
    "save_memory": { "enabled": true },
    "search_memories": { "enabled": true },
    "web_search": { "enabled": true },
    "web_scrape": { "enabled": true },
    "execute_command": { "enabled": true },
    "google_drive": { "enabled": false },
    "google_gmail": { "enabled": false },
    "google_calendar": { "enabled": false },
    "google_sheets": { "enabled": false },
    "bitbucket_prs": { "enabled": false }
  },
  "mcpServers": [
    {
      "name": "filesystem",
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    {
      "name": "github",
      "enabled": false,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  ]
}
```

**Design decisions:**
- JSON (not YAML) — already parse-able with `JSON.parse`, no new dependency
- `enabled` flag per custom tool mirrors existing env-var feature flags in `index.ts` but consolidated
- `enabled` flag per MCP server allows disabling without removing the config entry
- `transport` defaults to `"stdio"` — only supported value for v1.1 (Streamable HTTP is out of scope)
- `env` in MCP server config supports `${VAR}` substitution from `process.env` at load time
- Custom tool section is optional — if absent, all custom tools follow existing env-var pattern

### Manifest TypeScript Interface

```typescript
// src/tools/tool-manifest.ts
export interface ToolManifest {
  customTools?: Record<string, { enabled: boolean }>;
  mcpServers?: McpServerConfig[];
}

export interface McpServerConfig {
  name: string;
  enabled: boolean;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;  // supports ${VAR} substitution
}

export function loadManifest(path: string): ToolManifest {
  // Read JSON file; return empty manifest if file doesn't exist
  // Substitute ${VAR} in env values from process.env
}
```

**No YAML dependency.** JSON is sufficient and avoids adding `js-yaml` to the project.

---

## MCP Client Architecture

### MCP SDK API Surface (verified against v1.27.1)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Create client
const client = new Client({ name: "jarvis", version: "1.0.0" });

// Connect to a stdio MCP server (spawns the server process)
const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  env: { ...process.env, SOME_KEY: "value" }
});
await client.connect(transport);

// List tools (returns Tool[] with name, description, inputSchema)
const { tools } = await client.listTools();
// tools[0]: { name: string, description: string, inputSchema: JsonSchema }

// Call a tool
const result = await client.callTool({ name: "read_file", arguments: { path: "/tmp/test.txt" } });
// result.content: Array<{ type: "text", text: string } | { type: "image", ... }>

// Disconnect
await transport.close();
```

**Key schema mapping:** MCP tools use `inputSchema` (not `parameters`). The adapter maps `inputSchema` → `parameters` when creating `ToolDefinition` objects for the registry.

**MCP `callTool` result format:** Returns `content` array where each item has a `type`. The most common type is `"text"` with a `text` field. The adapter flattens this into a `ToolResult` string for the LLM.

### `mcp-client.ts` — Single Server Client

```typescript
// src/mcp/mcp-client.ts
export class McpClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor(private config: McpServerConfig) {}

  async connect(): Promise<void>
  async listTools(): Promise<McpToolDefinition[]>
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>
  async disconnect(): Promise<void>
  isConnected(): boolean
}
```

**No reconnect logic in v1.1.** If a server dies, the next `callTool` fails with a clear error. The LLM receives the error as a tool result and responds accordingly. Auto-reconnect adds complexity (re-initialize protocol handshake) and edge cases that are not worth solving for personal use. See PITFALLS.md for the SSE reconnect bug context — stdio is simpler but still requires a fresh `connect()` to re-initialize.

### `mcp-manager.ts` — Multi-Server Lifecycle

```typescript
// src/mcp/mcp-manager.ts
export class McpManager {
  private clients = new Map<string, McpClient>();

  // Called once at startup: connect all enabled servers, collect tools
  async startAll(servers: McpServerConfig[]): Promise<McpToolDefinition[]>

  // Execute a tool on the appropriate server (routes by serverName prefix)
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult>

  // Called at shutdown: disconnect all servers
  async disconnectAll(): Promise<void>
}
```

**Tool name namespacing:** MCP tool names are registered as `{serverName}__{toolName}` (double underscore separator) to prevent name collisions between servers and with built-in tools. The adapter strips the prefix when routing to the right `McpClient`.

Example: a filesystem server tool `read_file` becomes `filesystem__read_file` in the registry. The LLM sees this name in the tool definition and uses it. The adapter splits on `__` to route the call.

### `mcp-tool-adapter.ts` — Interface Bridge

```typescript
// src/mcp/mcp-tool-adapter.ts

// Converts an MCP tool + client reference into a Tool object
// that tool-registry.ts can register
export function adaptMcpTool(
  serverName: string,
  mcpTool: McpToolDefinition,
  manager: McpManager
): Tool {
  return {
    definition: {
      name: `${serverName}__${mcpTool.name}`,
      description: mcpTool.description ?? mcpTool.name,
      parameters: mcpTool.inputSchema as JsonSchema,  // MCP inputSchema matches ToolDefinition.parameters shape
    },
    async execute(args, _context) {
      return manager.callTool(serverName, mcpTool.name, args);
    }
  };
}
```

**Schema compatibility:** The existing `JsonSchema` type in `tool-types.ts` uses `type: "object"` with `properties`. MCP `inputSchema` follows the same JSON Schema object structure. The cast is safe for standard MCP servers; exotic schema types (arrays of top-level params) would need explicit handling but are uncommon in practice.

---

## Initialization Flow (index.ts changes)

```
main() starts
    ↓
1. initDatabase(), loadSoul() — unchanged
    ↓
2. loadManifest(config.paths.manifest)  ← NEW
    ↓
3. new ToolRegistry()                   ← unchanged
    ↓
4. Register built-in tools              ← driven by manifest.customTools OR
   (manifest present: use manifest)       existing env-var flags if no manifest
   (no manifest: existing behavior)
    ↓
5. new McpManager()                     ← NEW
   await mcpManager.startAll(manifest.mcpServers.filter(s => s.enabled))
    ↓ for each MCP server:
   McpClient.connect() → StdioClientTransport spawns server process
   client.listTools() → get tool list
   adaptMcpTool() for each → create Tool object
   toolRegistry.register(adaptedTool)  ← same registry, same interface
    ↓
6. new OpenRouterProvider()             ← unchanged
7. new TelegramChannel()                ← unchanged
8. startScheduler()                     ← unchanged (now has MCP tools too)
    ↓
Graceful shutdown adds: mcpManager.disconnectAll()
```

**Startup order:** MCP servers must connect before the Telegram channel starts. If a server fails to connect, log a warning and continue — Jarvis starts without that server's tools rather than refusing to start entirely. This is the correct behavior for personal use: a server being down should not prevent Jarvis from running.

---

## Recommended Project Structure (additions only)

```
src/
├── index.ts                    # Modified: manifest loading, MCP manager init
├── config.ts                   # Modified: add MCP_MANIFEST_PATH
│
├── mcp/                        # NEW module
│   ├── mcp-client.ts           # Single server client (wraps @modelcontextprotocol/sdk)
│   ├── mcp-manager.ts          # Multi-server lifecycle manager
│   └── mcp-tool-adapter.ts     # Converts MCP tool → Tool interface
│
└── tools/
    ├── tool-manifest.ts        # NEW: manifest schema, loader, env substitution
    ├── tool-types.ts           # UNCHANGED
    ├── tool-registry.ts        # UNCHANGED
    └── built-in/               # UNCHANGED: existing tools
        └── ...
```

```
# New config file at project root
tools.manifest.json             # User-managed tool configuration
```

---

## Architectural Patterns

### Pattern 1: Registry-Transparent MCP Integration

**What:** MCP tools register into the same `ToolRegistry` as built-in tools via the `Tool` interface adapter. The agent loop, the LLM call, and `getDefinitions()` all see a flat list of tools with no type distinction.

**When to use:** This is the only correct approach given the existing architecture. Any design that requires `agent.ts` or `tool-registry.ts` to know about MCP breaks the single-responsibility boundaries of those modules.

**Trade-offs:** All tools look identical to the agent — correct for behavior. Debugging is slightly harder (a failed MCP tool call looks like a failed built-in tool call). Mitigate with structured logging in the adapter that includes `serverName`.

### Pattern 2: Manifest as Single Source of Truth for Tool Loading

**What:** `tools.manifest.json` declares everything that gets registered at startup. Built-in tools with `enabled: false` are skipped. MCP servers that are disabled are not connected. The manifest replaces the scattered `if (config.google.enabled.drive)` blocks in `index.ts`.

**When to use:** Once the manifest file exists. Backward compatibility: if no manifest file is present, existing env-var behavior is unchanged.

**Trade-offs:** Adds one more file to manage. Benefit: enables/disables tools without restarting and without changing env vars. Configuration is explicit and auditable in one place.

**Example:**
```typescript
// index.ts — after manifest is loaded
const manifest = loadManifest(config.paths.manifest);

// Custom tools driven by manifest
if (manifest.customTools?.google_drive?.enabled ?? config.google.enabled.drive) {
  toolRegistry.register(gwsDriveTool);
}
```

### Pattern 3: Namespace-Prefixed MCP Tool Names

**What:** All MCP tools are registered as `{serverName}__{toolName}`. The double underscore is unlikely to appear in either part naturally.

**When to use:** Always, for all MCP tools.

**Trade-offs:** Makes tool names longer in LLM prompts. But prevents collisions (two MCP servers could both expose a `read_file` tool) and makes it immediately clear in logs which server a tool belongs to.

**Example:**
```
filesystem__read_file
filesystem__write_file
github__search_repositories
github__create_issue
```

### Pattern 4: Fail-Open MCP Server Connection

**What:** If an MCP server fails to connect at startup, log the error and continue. Jarvis starts without that server's tools. If a `callTool` on a disconnected server is attempted at runtime, the adapter returns `{ success: false, error: "MCP server 'X' is not connected" }` — the LLM receives this as a tool result and can inform the user.

**When to use:** Always. Failing hard on MCP server unavailability would make Jarvis unreliable if an external server is temporarily down.

**Trade-offs:** The LLM may attempt to call a tool from an unavailable server and get an error. This is better than Jarvis not starting at all.

### Pattern 5: Stdio-Only Transport for v1.1

**What:** Only `StdioClientTransport` is supported. Streamable HTTP (the new remote transport) is deferred.

**When to use:** All MCP server configs in v1.1.

**Rationale:** Stdio is the correct transport for local MCP servers on macOS. It spawns the server as a child process, communicates over stdin/stdout, and cleans up automatically when the client disconnects. Streamable HTTP adds auth, network config, and session management complexity that is out of scope for this milestone. The standalone SSE transport is deprecated as of MCP spec v2025-03-26 and should not be implemented.

---

## Data Flow

### MCP Tool Call Flow (at runtime)

```
Agent loop calls toolRegistry.execute("filesystem__read_file", {path: "/tmp/x"}, ctx)
    ↓
ToolRegistry looks up tool by name
    ↓
Finds the adapted McpTool object (execute function is the adapter closure)
    ↓
adapter.execute(args, ctx) is called
    ↓
McpManager.callTool("filesystem", "read_file", args)
    ↓
McpClient for "filesystem" calls client.callTool({ name: "read_file", arguments: args })
    ↓
@modelcontextprotocol/sdk sends JSON-RPC to the MCP server process via stdin
    ↓
MCP server process reads from stdin, executes, writes result to stdout
    ↓
SDK receives JSON-RPC response, returns result.content array
    ↓
Adapter flattens content array → ToolResult { success: true, data: "file contents..." }
    ↓
ToolRegistry returns ToolResult to agent loop
    ↓
Agent loop adds tool result to messages, loops back to LLM
```

### Startup Initialization Flow

```
loadManifest() reads tools.manifest.json
    ↓
McpManager.startAll() iterates enabled MCP servers
    ↓
  for each server:
  McpClient.connect()
      ↓
  StdioClientTransport spawns server process (e.g., npx -y @mcp/server-filesystem)
      ↓
  SDK performs initialize handshake over stdin/stdout
      ↓
  client.listTools() → [{ name, description, inputSchema }, ...]
      ↓
  adaptMcpTool() wraps each into Tool interface
      ↓
  toolRegistry.register(adaptedTool)
    ↓
All tools (built-in + MCP) now in registry
    ↓
Telegram channel starts → agent is ready
```

### Graceful Shutdown Flow (MCP addition)

```
SIGTERM / SIGINT received
    ↓
[existing: stop heartbeat, broadcast, stop scheduler, drain in-flight agents]
    ↓
mcpManager.disconnectAll()          ← NEW: before db.close()
    ↓
  for each McpClient:
  transport.close()                 ← sends SIGTERM to MCP server child process
    ↓
db.close()
    ↓
process.exit()
```

---

## Integration Points

### Agent Loop (`agent.ts`) — No Changes

`runAgent()` signature is unchanged. It calls `toolRegistry.getDefinitions()` and `toolRegistry.execute()` — both unchanged. MCP tools are invisible to the agent loop.

### Tool Registry (`tool-registry.ts`) — No Changes

`ToolRegistry` is unchanged. MCP tools satisfy the `Tool` interface and register via the existing `register()` method. Name collision protection already exists (throws if a tool name is already registered) — the `__` namespace prefix prevents MCP tools from colliding with built-in tools.

### `index.ts` — Three Additions

1. Load manifest (before tool registration)
2. Start MCP manager + register adapted tools (after built-in tool registration)
3. Disconnect MCP manager in shutdown block (before `db.close()`)

### Scheduler (`scheduler-manager.ts`) — No Changes

The scheduler passes the same `toolRegistry` to `runAgent()`. Because MCP tools are in the registry by the time the scheduler starts, scheduled tasks can use MCP tools without any scheduler changes.

### Security Layer (`security/`) — No Changes

MCP tools do not have `riskLevel` set by default (they come from third-party servers). The adapter can optionally read a `riskLevel` from the manifest config in a future version. For v1.1, MCP tools are treated as low-risk (no approval gate). This is acceptable because the user explicitly enabled them in the manifest.

---

## Build Order

Dependencies determine which components must be built first:

```
1. tool-manifest.ts (ToolManifest interface + loadManifest())
   — No dependencies. Pure file I/O + type definitions.
   — Required by: index.ts changes, McpManager

2. mcp-client.ts (McpClient wrapping SDK Client + StdioClientTransport)
   — Depends on: @modelcontextprotocol/sdk (npm install)
   — Required by: mcp-manager.ts

3. mcp-tool-adapter.ts (adaptMcpTool function)
   — Depends on: tool-types.ts (existing, unchanged), McpManager type
   — Required by: mcp-manager.ts

4. mcp-manager.ts (McpManager: startAll, callTool, disconnectAll)
   — Depends on: mcp-client.ts, mcp-tool-adapter.ts, tool-manifest.ts
   — Required by: index.ts

5. index.ts changes (manifest loading + MCP startup + shutdown)
   — Depends on: all of the above
   — This is the integration point; build last
```

Suggested implementation order within the milestone:
- **Phase 1:** `npm install @modelcontextprotocol/sdk zod` + implement `tool-manifest.ts` (schema + loader) + add `MCP_MANIFEST_PATH` to config + create `tools.manifest.json` template
- **Phase 2:** Implement `mcp-client.ts` + `mcp-tool-adapter.ts` (adapter is simple, tightly coupled to client)
- **Phase 3:** Implement `mcp-manager.ts` (ties client + adapter together)
- **Phase 4:** Wire into `index.ts` (manifest-driven custom tool loading + MCP manager startup + shutdown)
- **Phase 5:** Integration test: connect a real MCP server (e.g., `@modelcontextprotocol/server-filesystem`), verify tool appears in registry, verify agent can call it

---

## Anti-Patterns

### Anti-Pattern 1: Making agent.ts MCP-Aware

**What people do:** Add a separate code path in the agent loop for MCP tool calls — checking if a tool is MCP vs. built-in, then routing to a different executor.

**Why it's wrong:** Destroys the single-responsibility of `agent.ts`. Tightly couples the agent loop to MCP implementation details. Makes the agent loop harder to test and maintain. The existing `Tool` interface exists precisely to abstract this distinction away.

**Do this instead:** Adapt MCP tools to the `Tool` interface at registration time. The agent loop calls `toolRegistry.execute()` and never needs to know the tool's origin.

### Anti-Pattern 2: Global McpClient Singletons

**What people do:** Create a module-level `McpClient` singleton per server, imported directly by tool files (similar to how `setMemoryManager` is used in some built-in tools).

**Why it's wrong:** Tool files should not know about MCP infrastructure. The adapter pattern (closure over McpManager reference) is cleaner — the tool's `execute` function carries the right McpManager reference without needing to know how it was created.

**Do this instead:** `adaptMcpTool()` creates the `Tool` object with a closure over the `McpManager` instance. The manager is initialized in `index.ts` and passed to `adaptMcpTool()` — no global state.

### Anti-Pattern 3: Registering MCP Tool Names Without Namespace Prefix

**What people do:** Register the MCP tool name directly (e.g., `read_file`) without the server prefix.

**Why it's wrong:** Two MCP servers can expose tools with the same name. A future MCP server might also collide with a built-in tool name. The `ToolRegistry` will throw on duplicate registration — causing a startup failure that is hard to debug.

**Do this instead:** Always prefix with `{serverName}__`. The double underscore is a reliable separator that is unlikely to appear in tool names from any MCP server.

### Anti-Pattern 4: Synchronous MCP Tool Connection at Startup

**What people do:** Call `client.connect()` synchronously or without error handling — crashing startup if any MCP server is unavailable.

**Why it's wrong:** An MCP server might be temporarily unavailable (server binary not installed, network issue for HTTP transport, etc.). Crashing Jarvis because a third-party server is down defeats the purpose of a reliable personal agent.

**Do this instead:** Wrap each `McpClient.connect()` in a try/catch. Log the error and continue. The agent starts without that server's tools — which is preferable to not starting at all.

### Anti-Pattern 5: Persistent MCP Client Reconnect Loops

**What people do:** Implement automatic reconnection on disconnect — trying to re-connect the SDK Client to the same transport object after the server process dies.

**Why it's wrong:** The MCP SDK (v1.x) does not support re-initializing a `Client` that has already connected and disconnected. A disconnected client requires a completely fresh `Client` + `StdioClientTransport` pair and a new `initialize` handshake. There is a known SDK issue (GitHub issue #510) where reconnect without re-initialize causes silent protocol failures. Reconnect logic that does not handle this correctly causes worse failures than the original disconnect.

**Do this instead:** On disconnect (detected via error on `callTool`), mark the client as disconnected. Return a clear error to the LLM on any subsequent tool call. Let the user restart Jarvis if a server needs to be re-connected (acceptable for personal use). Do not attempt automatic reconnection in v1.1.

---

## Scaling Considerations

This is a single-user personal agent on macOS. Scaling is not a concern. The considerations below are informational only.

| Concern | Current Scale | If Scope Changes |
|---------|---------------|-----------------|
| MCP server process count | 1-5 servers is fine (each is a lightweight node process) | >10 concurrent servers would warrant pooling or lazy-connect |
| Tool name collision | `__` prefix resolves this at scale | No change needed |
| Stdio throughput | Adequate for LLM tool call rates (1-5 per agent run) | Switch to Streamable HTTP for high-frequency or remote servers |
| MCP server startup latency | stdio servers start in <500ms typically | Lazy-connect (connect only when tool is first called) if startup time grows |

---

## Sources

- Direct codebase inspection: `/Users/max/Personal/repos/open-jarvis/src/` (HIGH confidence)
- `@modelcontextprotocol/sdk` v1.27.1 (current as of 2026-03-19): confirmed via `npm info @modelcontextprotocol/sdk version` (HIGH confidence)
- [MCP TypeScript SDK docs — client usage](https://modelcontextprotocol.info/docs/tutorials/building-a-client-node/) — Client constructor, StdioClientTransport, listTools, callTool patterns (HIGH confidence)
- [MCP SDK client.md — listTools/callTool signatures](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md) (HIGH confidence — official SDK repo)
- [MCP Transports — SSE deprecation, Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports) (HIGH confidence — official spec)
- [SSEClientTransport reconnect bug — GitHub issue #510](https://github.com/modelcontextprotocol/typescript-sdk/issues/510) — informs no-reconnect decision (MEDIUM confidence — specific to SSE, but pattern applies to stdio too)
- [Why MCP deprecated SSE for Streamable HTTP](https://blog.fka.dev/blog/2025-06-06-why-mcp-deprecated-sse-and-go-with-streamable-http/) (MEDIUM confidence — community analysis, aligns with official spec)

---
*Architecture research for: Jarvis v1.1 — MCP client integration, tool manifest, hybrid tool approach*
*Researched: 2026-03-19*
