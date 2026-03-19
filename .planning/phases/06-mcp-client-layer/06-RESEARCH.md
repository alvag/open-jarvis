# Phase 06: MCP Client Layer - Research

**Researched:** 2026-03-19
**Domain:** MCP TypeScript SDK — client lifecycle, stdio/HTTP transports, tool adapter
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Connection lifecycle:**
- Eager connection: all enabled servers connect at startup before accepting Telegram messages
- Failed connection at startup: log warning and continue (resilient, consistent with Phase 5)
- Connection timeout: 10 seconds per server — if no connect, skip with warning
- Shutdown: integrate MCP disconnect between `stopScheduler()` and `telegram.stop()` in index.ts, within the existing 15s shutdown timeout

**Tool adaptation:**
- Namespace prefix: `{serverName}__{toolName}` (double underscore separator)
- Schema: pass raw MCP `inputSchema` to LLM as-is — no normalization
- Collisions: error at startup, skip the MCP tool — log clearly with both names involved
- `callTool()` result mapping: extract text from first content item as `data`, map `isError: true` to `success: false`

**Runtime error handling:**
- Tool fails mid-session: return `ToolResult { success: false, error: "MCP server 'name' error: description" }`
- Child process crashes: mark server as dead, all its tools return error until Jarvis restart (no auto-reconnect in v1.1)
- Crash notification: log only, no Telegram notification
- stderr of child: capture and log with category `"mcp:{serverName}"`

**SDK and transport:**
- SDK: `@modelcontextprotocol/sdk` (official)
- Child process env: inherit `process.env` + env from config (already resolved by `mcp-config-loader`)
- Pattern: class `McpClient` encapsulating SDK `Client`, transport, state (connected/dead), and methods: `connect/disconnect/listTools/callTool`
- Location: `src/mcp/` directory — `mcp-client.ts`, `mcp-tool-adapter.ts`

### Claude's Discretion
- Internal implementation of McpClient (event handler wiring, stderr buffering)
- Exact structure of McpToolAdapter (how it wraps execute() to route to callTool)
- Edge cases in schema handling (tools with no parameters, etc.)
- Exact order of operations in connect() (create transport → connect → listTools)

### Deferred Ideas (OUT OF SCOPE)
- Auto-reconnect when a server crashes (v2 MCPX-05)
- Telegram notification when a server crashes (v2)
- `allowedTools` filter per server (v2 MCPX-02)
- `tools/list_changed` notification handling (v2 MCPX-03)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Connect to local MCP servers via stdio transport (spawn child process) | StdioClientTransport fully documented — constructor, env merge, close() |
| MCP-02 | Connect to remote MCP servers via StreamableHTTP transport | StreamableHTTPClientTransport documented — URL + requestInit for headers |
| MCP-03 | Discover tools via listTools() | listTools() return type fully documented — tools[].name, description, inputSchema |
| MCP-04 | Register tools with `{serverName}__{toolName}` namespace prefix | Simple string prefix — no SDK involvement, pure JS |
| MCP-05 | Adapt MCP tools to Tool interface and register in ToolRegistry | McpToolAdapter pattern documented — wraps callTool() in Tool.execute() |
| MCP-06 | Execute MCP tools via callTool() with result normalization | callTool() return type documented — content array + isError flag |
| MCP-07 | Failed server connections at startup log warning and continue | Promise.race timeout + try-catch pattern documented |
| MCP-08 | Runtime disconnections return clear error to LLM (not crash) | transport.onclose callback + dead-server guard in execute() |
| MCP-09 | All connections closed gracefully at shutdown | client.close() documented — triggers SIGTERM then SIGKILL with 2s timeouts |
| SEC-03 | Tool name collision validation prevents MCP tools shadowing custom tools | ToolRegistry.register() already throws on duplicate — catch and skip |
| SEC-04 | Stdio child process crashes isolated, don't propagate to agent loop | transport.onerror + onclose handlers + try-catch in execute() |
</phase_requirements>

---

## Summary

The MCP TypeScript SDK (`@modelcontextprotocol/sdk@1.27.1`) is a production-ready library used by Claude Desktop, Cursor, and similar tools. It provides `Client`, `StdioClientTransport`, and `StreamableHTTPClientTransport` as the three core building blocks needed for this phase. The SDK is well-typed (full `.d.ts` files inspected directly), handles the protocol completely, and does not require implementing any MCP wire format.

The two critical patterns to understand are: (1) env inheritance for stdio — when `env` is provided, the SDK merges it on top of `getDefaultEnvironment()` (only safe vars like PATH/HOME), so passing `process.env` explicitly is the right approach for full environment inheritance; (2) crash detection — the transport exposes `onclose` and `onerror` callbacks that fire when the child process exits, allowing the McpClient to mark itself as dead and return structured errors on all subsequent tool calls.

The `ToolRegistry` already throws on duplicate names (verified from source), so SEC-03 is satisfied by wrapping that throw in a catch and logging — no additional code needed. The `tool-types.ts` `JsonSchema` type has stricter typing than MCP's `inputSchema` (which allows any `Record<string, object>` for properties), so the adapter must cast `inputSchema` via `as unknown as JsonSchema`.

**Primary recommendation:** Implement `McpClient` as a thin lifecycle wrapper around SDK `Client` + transport, with `isAlive` state. Implement `McpToolAdapter` as a factory that creates `Tool` objects from SDK tool definitions. Wire both into `index.ts` after manifest tools are loaded.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | Official MCP protocol implementation — Client, transports, types | Official SDK by MCP authors; used by Claude Desktop and Cursor; actively maintained |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cross-spawn` | (bundled in SDK) | Child process spawning — already a dependency of SDK | SDK uses it internally; no direct usage needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@modelcontextprotocol/sdk` | Hand-rolled JSON-RPC over child_process | SDK handles protocol negotiation, capability exchange, message framing — weeks of work vs. npm install |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk
```

**Version verification:**
```
$ npm view @modelcontextprotocol/sdk version
1.27.1   (verified 2026-03-19)
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── mcp/                     # New directory for Phase 6
│   ├── mcp-client.ts        # McpClient class — wraps SDK Client + transport
│   └── mcp-tool-adapter.ts  # McpToolAdapter — creates Tool[] from McpClient
├── tools/
│   ├── mcp-config-loader.ts # Already exists (Phase 5)
│   └── ...
└── index.ts                 # Wiring: mcpConfigs → McpClient → register tools
```

### Pattern 1: McpClient Lifecycle

**What:** A class wrapping SDK `Client` + transport with `isAlive` state tracking and explicit lifecycle methods.

**When to use:** One `McpClient` instance per configured MCP server.

```typescript
// Source: inspected /tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../tools/mcp-config-loader.js";

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport | StreamableHTTPClientTransport;
  private _isAlive = false;
  readonly name: string;

  constructor(config: McpServerConfig) {
    this.name = config.name;
    this.client = new Client({ name: "jarvis", version: "1.0.0" });

    if (config.type === "stdio") {
      this.transport = new StdioClientTransport({
        command: config.command!,
        args: config.args ?? [],
        // Merge: getDefaultEnvironment() (PATH/HOME/etc) + full process.env + server-specific env
        // SDK merges: { ...getDefaultEnvironment(), ...params.env }
        // To pass ALL env vars, override with full process.env:
        env: { ...process.env, ...config.env } as Record<string, string>,
        stderr: "pipe", // Capture for logging
      });

      // Capture stderr for debugging
      this.transport.stderr?.on("data", (chunk: Buffer) => {
        log("debug", `mcp:${this.name}`, chunk.toString().trimEnd());
      });
    } else {
      this.transport = new StreamableHTTPClientTransport(
        new URL(config.url!),
        {
          requestInit: {
            headers: config.headers ?? {},
          },
        }
      );
    }
  }

  async connect(): Promise<void> {
    // Transport callbacks must be wired BEFORE connect() — SDK calls start() internally
    this.transport.onclose = () => {
      this._isAlive = false;
      log("warn", `mcp:${this.name}`, "Server disconnected");
    };
    this.transport.onerror = (err) => {
      log("error", `mcp:${this.name}`, "Transport error", { error: err.message });
    };

    await this.client.connect(this.transport);
    this._isAlive = true;
  }

  get isAlive(): boolean {
    return this._isAlive;
  }

  async listTools() {
    return this.client.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({ name, arguments: args });
  }

  async disconnect(): Promise<void> {
    this._isAlive = false;
    await this.client.close();
  }
}
```

### Pattern 2: McpToolAdapter — Tool Factory

**What:** Creates `Tool` objects conforming to the project `Tool` interface from MCP tool definitions.

**When to use:** Called after `listTools()` to produce ToolRegistry-compatible objects.

```typescript
// Source: inspected client/index.d.ts and tool-types.ts
import type { Tool, ToolResult } from "../tools/tool-types.js";
import type { McpClient } from "./mcp-client.js";

type McpTool = Awaited<ReturnType<McpClient["listTools"]>>["tools"][number];

export function adaptMcpTool(mcpTool: McpTool, client: McpClient, serverName: string): Tool {
  const prefixedName = `${serverName}__${mcpTool.name}`;

  return {
    definition: {
      name: prefixedName,
      description: mcpTool.description ?? `MCP tool ${mcpTool.name} from ${serverName}`,
      // inputSchema is `{ type: "object", properties?: Record<string, object>, required?: string[] }`
      // Our JsonSchema requires properties to be Record<string, {type, description, enum?}>
      // Cast is required — MCP schemas can be richer but are compatible for LLM consumption
      parameters: mcpTool.inputSchema as unknown as import("../tools/tool-types.js").JsonSchema,
    },

    async execute(args, _context): Promise<ToolResult> {
      if (!client.isAlive) {
        return {
          success: false,
          data: null,
          error: `MCP server '${serverName}' is not available (disconnected)`,
        };
      }

      try {
        const result = await client.callTool(mcpTool.name, args);

        // Result shape (from SDK): { content: Array<{type, text}|...>, isError?: boolean }
        if (result.isError) {
          const errText = result.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join(" ") || "Tool reported error";
          return { success: false, data: null, error: `MCP server '${serverName}' error: ${errText}` };
        }

        // Extract text from first text content item as primary data
        const textItem = result.content.find(
          (c): c is { type: "text"; text: string } => c.type === "text"
        );
        return { success: true, data: textItem?.text ?? result.content };
      } catch (err) {
        return {
          success: false,
          data: null,
          error: `MCP server '${serverName}' error: ${(err as Error).message}`,
        };
      }
    },
  };
}
```

### Pattern 3: Startup Wiring with Timeout

**What:** Connect all enabled servers at startup with 10-second per-server timeout; log warning and continue on failure.

**When to use:** In `index.ts` after manifest tools are loaded, before Telegram starts.

```typescript
// In index.ts — after loadToolManifest(), before telegram.start()
const mcpServerConfigs = loadMcpConfig();
const mcpClients: McpClient[] = [];

for (const config of mcpServerConfigs) {
  const client = new McpClient(config);
  try {
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), 10_000)
      ),
    ]);

    // Discover and register tools
    const { tools } = await client.listTools();
    let registered = 0;

    for (const mcpTool of tools) {
      const adapted = adaptMcpTool(mcpTool, client, config.name);
      try {
        toolRegistry.register(adapted);
        registered++;
      } catch (err) {
        // ToolRegistry throws on duplicate — SEC-03
        log("error", "startup", `MCP tool name collision: ${adapted.definition.name}`, {
          server: config.name,
          error: (err as Error).message,
        });
      }
    }

    mcpClients.push(client);
    log("info", "startup", `MCP server connected: ${config.name}`, {
      tools: registered,
    });
  } catch (err) {
    log("warn", "startup", `MCP server failed to connect: ${config.name} — skipping`, {
      error: (err as Error).message,
    });
    // Don't push — server is not connected
  }
}
```

### Pattern 4: Shutdown Integration

**What:** Close all MCP connections during shutdown, between scheduler stop and Telegram stop.

```typescript
// In shutdown() function in index.ts
// After: stopScheduler()
// Before: await telegram.stop()

// Disconnect MCP servers
await Promise.allSettled(mcpClients.map((c) => c.disconnect()));
log("info", "shutdown", "MCP connections closed");
```

### Anti-Patterns to Avoid
- **Passing `env: config.env` only without merging:** The SDK's `getDefaultEnvironment()` provides only 6 safe vars (HOME, PATH, SHELL, etc.). MCP servers (especially npx-based) need the full parent env including Node.js-specific vars. Always merge: `{ ...process.env, ...config.env }`.
- **Wiring `onclose`/`onerror` after `client.connect()`:** The SDK calls `transport.start()` synchronously inside `connect()`. Wire callbacks before calling `connect()` to avoid missing early events.
- **Implementing pagination for listTools:** For Phase 6 (single server), pagination is unnecessary. The SDK supports it via `nextCursor` but MCP servers rarely return more than 50 tools.
- **Storing McpClient instances outside of index.ts scope:** Keep `mcpClients` array in `main()` scope for proper shutdown access — same pattern as `telegram` and `db`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol over stdio | Custom JSON-RPC framing | `StdioClientTransport` | Message framing (newline-delimited JSON), error recovery, and capability negotiation are subtle |
| HTTP streaming (SSE) client | Custom fetch + EventSource | `StreamableHTTPClientTransport` | SSE reconnection, session ID management, protocol version negotiation already handled |
| Process lifecycle | `child_process.spawn` + custom SIGTERM logic | `StdioClientTransport.close()` | SDK already does: stdin close → SIGTERM (2s) → SIGKILL (2s) |
| Connection timeout | Manual AbortController | `Promise.race([connect(), timeout])` | Simple Promise.race is sufficient; SDK doesn't have built-in connect timeout |

**Key insight:** The SDK handles the full MCP protocol. The only custom code needed is: (1) the `McpClient` state machine (connected/dead) and (2) the `ToolResult` normalization from MCP content arrays.

---

## Common Pitfalls

### Pitfall 1: Environment Variable Inheritance Trap
**What goes wrong:** Passing only `config.env` (the server-specific vars) wipes out PATH, HOME, NODE_PATH — `npx` fails with ENOENT.
**Why it happens:** `getDefaultEnvironment()` returns only 6 safe vars. When you supply `env`, it's merged ON TOP of those 6 vars, not on top of `process.env`.
**How to avoid:** Always spread `process.env` first: `env: { ...process.env, ...config.env }`. (Verified: was a bug in early SDK versions, now fixed via merge — but `process.env` spread ensures full inheritance.)
**Warning signs:** Child process exits immediately with code 1; stderr shows "command not found" or "MODULE_NOT_FOUND".

### Pitfall 2: TypeScript Type Mismatch — `inputSchema` vs `JsonSchema`
**What goes wrong:** Compiler error when assigning MCP `inputSchema` to `ToolDefinition.parameters: JsonSchema`.
**Why it happens:** Project `JsonSchema` type constrains `properties` to `Record<string, {type, description, enum?}>`. MCP `inputSchema.properties` is `Record<string, object>` (looser). The shapes are compatible at runtime but differ in TypeScript.
**How to avoid:** Cast via `as unknown as JsonSchema`. Verified: MCP servers in practice return valid JSON Schema — the cast is safe.
**Warning signs:** `Type 'Record<string, object>' is not assignable to type 'Record<string, {type: string; ...}>'` compiler error.

### Pitfall 3: `onclose` Fires on Clean Disconnect Too
**What goes wrong:** Setting `isAlive = false` in `onclose` then getting confusing "server is not available" errors after intentional shutdown.
**Why it happens:** `onclose` fires both on crash AND on clean `client.close()`. This is expected behavior — the transport always calls `onclose` when the connection ends.
**How to avoid:** Set `isAlive = false` before calling `disconnect()` so the onclose handler is a no-op. Or check if shutdown is in progress before logging warnings.
**Warning signs:** "Server disconnected" warning in logs during normal shutdown sequence.

### Pitfall 4: `callTool` Throws vs Returns `isError`
**What goes wrong:** Not handling both error surfaces — treating a thrown exception the same as a successful `isError: true` result, or vice versa.
**Why it happens:** Two distinct failure modes: (1) the MCP server ran the tool but it failed → `result.isError = true` with error in `content`; (2) the network/protocol layer failed → SDK throws an exception. Both must be caught.
**How to avoid:** Wrap `callTool()` in try-catch AND check `result.isError` inside the try block. (Pattern shown in McpToolAdapter code example above.)
**Warning signs:** Unhandled rejection from `callTool()` crashes the agent loop.

### Pitfall 5: Tools with No Parameters
**What goes wrong:** MCP tools with no parameters may return `inputSchema: { type: "object" }` without a `properties` field. Passing this to the LLM is fine, but the project `JsonSchema` type requires `properties`.
**Why it happens:** `JsonSchema.properties` is `Record<string, ...>` (required field in the type). Some MCP tools have no parameters.
**How to avoid:** When building `ToolDefinition.parameters`, ensure `properties` exists: `parameters: { ...mcpTool.inputSchema, properties: mcpTool.inputSchema.properties ?? {} } as unknown as JsonSchema`.
**Warning signs:** `Cannot read properties of undefined (reading 'type')` at runtime; TypeScript strict mode catches missing `properties`.

---

## Code Examples

### Import Paths (ES Modules)
```typescript
// Source: verified from /tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
```

### StdioClientTransport Full Constructor
```typescript
// Source: inspected /tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.d.ts
new StdioClientTransport({
  command: string,          // executable (e.g. "npx", "node", "python")
  args?: string[],          // command arguments
  env?: Record<string, string>, // merged with getDefaultEnvironment() — pass process.env for full inheritance
  stderr?: IOType | Stream | number, // "pipe" to capture, "inherit" (default) to forward to parent
  cwd?: string,             // working directory
})

// Access captured stderr:
transport.stderr?.on("data", (chunk) => { /* chunk is Buffer */ });
```

### StreamableHTTPClientTransport with Custom Headers
```typescript
// Source: inspected /tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts
new StreamableHTTPClientTransport(
  new URL(config.url!),
  {
    requestInit: {
      headers: {
        "Authorization": config.headers?.Authorization ?? "",
        ...config.headers,
      },
    },
    // reconnectionOptions — default is fine for Phase 6
  }
)
```

### callTool Result Shape
```typescript
// Source: inspected /tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts
type CallToolResult = {
  content: Array<
    | { type: "text"; text: string; annotations?: ...; _meta?: ... }
    | { type: "image"; data: string; mimeType: string; ... }
    | { type: "audio"; data: string; mimeType: string; ... }
    | { type: "resource"; resource: ...; ... }
    | { type: "resource_link"; uri: string; name: string; ... }
  >;
  isError?: boolean;      // true = tool ran but reported failure
  structuredContent?: Record<string, unknown>;  // typed output (future)
  _meta?: ...;
};
```

### listTools Result — Tool Shape
```typescript
// Source: inspected /tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts
type McpToolDef = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
    [x: string]: unknown;
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  _meta?: Record<string, unknown>;
};
```

### Connection Timeout Pattern
```typescript
// Standard Promise.race — no SDK-specific timeout mechanism exists
const CONNECT_TIMEOUT_MS = 10_000;

await Promise.race([
  client.connect(),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS}ms`)),
      CONNECT_TIMEOUT_MS
    )
  ),
]);
```

### Crash Detection (onclose wired before connect)
```typescript
// IMPORTANT: wire callbacks BEFORE connect() — SDK calls transport.start() inside connect()
transport.onclose = () => {
  this._isAlive = false;
  log("warn", `mcp:${name}`, "Server disconnected or crashed");
};

transport.onerror = (err) => {
  log("error", `mcp:${name}`, "Transport error", { error: err.message });
};

await client.connect(transport); // triggers transport.start() internally
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSE transport | StreamableHTTP transport | MCP spec 2025-03-26 | SSE is now deprecated; StreamableHTTP replaces it for HTTP servers |
| Manual env merge required | SDK merges automatically | SDK ~1.6.0 (PR #394) | `env` in StdioServerParameters now merges with `getDefaultEnvironment()`, not replaces it |

**Deprecated/outdated:**
- `SSEClientTransport`: Deprecated in MCP spec 2025-03-26. `StreamableHTTPClientTransport` is the replacement for all HTTP-based servers.

---

## Open Questions

1. **JsonSchema type widening needed?**
   - What we know: Project `JsonSchema.properties` is `Record<string, {type, description, enum?}>`, MCP `inputSchema.properties` is `Record<string, object>`
   - What's unclear: Whether `tool-types.ts` should be widened or if `as unknown as JsonSchema` cast is acceptable long-term
   - Recommendation: Use cast for now (Phase 6), file a task for Phase 7 to widen `JsonSchema` or create `McpJsonSchema` type

2. **`process.env` vs `getDefaultEnvironment()` for env inheritance**
   - What we know: SDK merges `{ ...getDefaultEnvironment(), ...params.env }`. For full inheritance, passing `env: { ...process.env, ...config.env }` is cleaner than relying on `getDefaultEnvironment()`
   - What's unclear: Whether exposing all of `process.env` to MCP child processes is a security concern
   - Recommendation: Use `{ ...process.env, ...config.env }` — consistent with how Claude Desktop works; `config.env` values are already validated by mcp-config-loader

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected in project (no jest.config, no vitest.config, no test/ directory) |
| Config file | None — see Wave 0 |
| Quick run command | `npm run typecheck` (type checking as proxy for correctness) |
| Full suite command | `npm run typecheck && npm run build` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | stdio transport connects and listTools | manual-only | Run Jarvis with a test stdio MCP server in mcp_config.json | N/A |
| MCP-02 | HTTP transport connects and listTools | manual-only | Run Jarvis with a StreamableHTTP server URL | N/A |
| MCP-03 | listTools() returns tools | manual-only | Check Jarvis startup logs for "MCP server connected" with tool count | N/A |
| MCP-04 | Names have `__` prefix in registry | type-check | `npm run typecheck` — names computed at runtime | N/A |
| MCP-05 | MCP tools appear in agent context | manual-only | Ask Jarvis to use an MCP tool; verify agent calls it | N/A |
| MCP-06 | callTool result normalized to ToolResult | type-check | `npm run typecheck` | N/A |
| MCP-07 | Failed server skipped at startup | manual-only | Configure invalid server in mcp_config.json; verify Jarvis still starts | N/A |
| MCP-08 | Runtime crash returns error to LLM | manual-only | Kill MCP child process mid-session; verify LLM gets error not crash | N/A |
| MCP-09 | Graceful shutdown closes connections | manual-only | SIGTERM Jarvis; verify no zombie processes | N/A |
| SEC-03 | Name collision logged and skipped | type-check + manual | `npm run typecheck`; add duplicate MCP tool name at startup | N/A |
| SEC-04 | Child crash isolated from agent loop | manual-only | Kill child process during tool execution; verify agent loop continues | N/A |

### Sampling Rate
- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run typecheck && npm run build`
- **Phase gate:** Full suite green + manual smoke test (stdio + HTTP connection) before `/gsd:verify-work`

### Wave 0 Gaps
- No test framework exists in the project — manual integration testing is the primary verification mechanism
- `npm run typecheck` serves as the automated correctness gate for type safety
- Manual smoke test plan: configure `mcp_config.json` with a known-good test server (e.g., `@modelcontextprotocol/server-filesystem`) for stdio, verify startup logs show connected + tool count

*(No test files to create — project uses manual testing + typecheck as established pattern)*

---

## Sources

### Primary (HIGH confidence)
- Inspected directly from npm registry: `/tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.d.ts` — StdioClientTransport types, StdioServerParameters, stderr handling
- Inspected directly from npm registry: `/tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts` — StreamableHTTPClientTransport, options type
- Inspected directly from npm registry: `/tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` — Client class, callTool return type, listTools return type
- Inspected directly from npm registry: `/tmp/mcp-inspect/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` — env merge behavior, process lifecycle (SIGTERM/SIGKILL), onclose/onerror wiring
- [Official client docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md) — callTool pagination, connect/disconnect, progress tracking

### Secondary (MEDIUM confidence)
- [MCP Tools concept doc](https://modelcontextprotocol.info/docs/concepts/tools/) — CallToolResult semantics, isError field, content array structure
- [DeepWiki StreamableHTTP](https://deepwiki.com/modelcontextprotocol/typescript-sdk/4.2-streamable-http-client-transport) — reconnection options, auth flow, error types

### Tertiary (LOW confidence)
- [GitHub issue #196](https://github.com/modelcontextprotocol/typescript-sdk/issues/196) — Historical env inheritance bug (resolved in ~1.6.0, documented as fixed)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — version verified from npm registry, types inspected directly
- Architecture: HIGH — patterns derived from inspected .d.ts and .js source files
- Pitfalls: HIGH — env issue confirmed from GitHub issue + source code inspection; type mismatch derived from inspecting both type files

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (SDK stable, not fast-moving for client primitives)
