# Phase 5: Tool Manifest - Research

**Researched:** 2026-03-19
**Domain:** JSON config loading, child-process execution, env-var substitution, TypeScript module wiring
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Tool Manifest (`tool_manifest.json` — local scripts)**
- Archivo separado en la raiz del proyecto
- Coexiste con built-in tools de index.ts — no reemplaza, agrega
- Estructura: array de tools con `name`, `description`, `parameters` (JSON Schema), `handler_path`, `enabled` (default true)
- Handlers se ejecutan como child process segun extension: python3 para .py, bash para .sh, tsx para .ts
- Args se pasan como JSON en stdin, resultado se lee de stdout y se parsea a ToolResult
- Seguridad: pasa por el mismo gate de 3 capas (classifier + blacklist + approval) que execute_command
- Scripts heredan `process.env` completo — sin campo env propio ni sustitucion `${VAR}`
- Colisiones de nombre con built-in tools: error en log, se salta la tool del manifest (built-in tiene prioridad)

**MCP Config (`mcp_config.json` — external MCP servers)**
- Archivo separado en la raiz del proyecto
- Schema: superset de claude_desktop_config.json con key `mcpServers` (object keyed by name)
- Campos stdio: `command`, `args`, `env`, `enabled` (default true)
- Campos HTTP: `type="streamable-http"`, `url`, `headers`, `env`, `enabled` (default true)
- `type` default: "stdio" (omitir type = stdio, compatible con Claude Desktop)
- Sustitucion `${VAR}` aplica SOLO a campos `env` y `headers` (no command/args)
- Sustitucion parcial soportada: "Bearer ${TOKEN}" se expande correctamente
- Variable `${VAR}` no definida: error, se salta ese servidor (no bloquea startup completo)

**Comportamiento al arrancar**
- Archivo no existe: log info, arrancar sin esa fuente de tools
- JSON malformado: log error con posicion, arrancar sin esa fuente de tools
- Handler no encontrado (manifest): log error, saltar esa tool, continuar con las demas
- Var indefinida (MCP config): log error, saltar ese servidor, continuar con los demas
- Campos desconocidos en JSON: ignorar silenciosamente (forward-compatibility)
- Ambos archivos gitignored + .example files commiteados

### Claude's Discretion
- Implementacion interna del parser de `${VAR}` (regex simple suficiente)
- Estructura exacta de los modulos (`manifest-loader.ts`, `mcp-config-loader.ts`, o combinado)
- Validacion de schema (runtime checks vs libreria tipo zod)
- Formato exacto de los mensajes de log
- Path override via env var (`MANIFEST_PATH`, `MCP_CONFIG_PATH`)

### Deferred Ideas (OUT OF SCOPE)
- Migracion de built-in tools al manifest — posible en v2
- Per-tool trust levels / bypass de approval gate — deferido a v2 (MCPX-01)
- Dynamic import para handlers .ts/.js (mas rapido que child process) — evaluar en v2
- Hot-reload de manifest sin restart — deferido
- Env vars propias por tool en el manifest — agregar en v2
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MNFST-01 | User can declare MCP servers in a JSON manifest file with type, command, args, env, and enabled fields | `mcp_config.json` loader research: schema design, field validation, file-not-found resilience |
| MNFST-02 | User can use `${VAR}` syntax in manifest env fields to reference environment variables without exposing secrets | Env-var substitution pattern: regex replace against `process.env`, partial substitution, undefined-var error path |
| MNFST-03 | Jarvis loads manifest at startup and only connects to servers marked `enabled: true` | Startup wiring in `index.ts`, enabled-filtering in loader, graceful skip of disabled entries |
</phase_requirements>

---

## Summary

Phase 5 introduces two JSON configuration files that Jarvis reads at startup: `tool_manifest.json` for local script tools executed as child processes, and `mcp_config.json` for external MCP server declarations (connection happens in Phase 6-7). Both files are optional; their absence is a graceful non-event. This phase is purely about **loading, validating, and parsing** — no actual MCP connections are made here.

The domain is well-understood: Node.js `fs.readFileSync` + `JSON.parse`, a simple regex for `${VAR}` expansion, child-process stdio piping for script tools, and wiring into the existing `ToolRegistry`. No third-party parsing library is needed. The security model for script tool execution is a direct reuse of the existing three-tier classifier + approval gate already in `execute-command.ts`.

The key architectural insight is that both loaders return the same output type: `Tool[]` objects that `ToolRegistry.register()` can consume directly. Collision detection already exists in `ToolRegistry` (throws on duplicate name); the loaders catch that throw and log it instead of crashing.

**Primary recommendation:** Implement two single-file loaders (`manifest-loader.ts`, `mcp-config-loader.ts`) under `src/tools/`, each exporting a `loadXxx(path, registry)` function called from `index.ts` after all built-in registrations. Keep runtime type-checks manual (no zod — zero new dependencies).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | built-in | Read JSON files synchronously at startup | Sync read is correct at startup; no async complexity needed |
| `node:child_process` | built-in | Spawn interpreter (bash/python3/tsx) for manifest script tools | Already used by `execute-command.ts` pattern |
| `node:path` | built-in | Resolve handler_path relative to project root | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TypeScript interfaces | N/A | Typed schema for ManifestEntry and McpServerEntry | Always — zero cost, catches config shape errors at compile time |
| `node:util` promisify | built-in | Async child process execution for script tools | For tool execute() handlers (async ToolResult) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual runtime type checks | zod / ajv | zod adds a dependency and bundle weight; the schema is simple enough for manual checks |
| Sync `fs.readFileSync` at startup | async `fs.readFile` | Async complicates wiring; startup is sequential; sync is idiomatic here |
| `child_process.spawn` with stdin pipe | `child_process.exec` | `spawn` with stdio: ['pipe','pipe','pipe'] gives finer control over stdin/stdout/stderr separation |

**Installation:** No new packages required. Phase 5 uses only Node.js built-ins.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── tools/
│   ├── tool-types.ts          # Existing — Tool, ToolResult, JsonSchema
│   ├── tool-registry.ts       # Existing — ToolRegistry with collision detection
│   ├── manifest-loader.ts     # NEW — loads tool_manifest.json
│   └── mcp-config-loader.ts   # NEW — loads mcp_config.json
├── index.ts                   # MODIFIED — calls loaders after built-in registrations
tool_manifest.json             # NEW (gitignored)
tool_manifest.json.example     # NEW (committed)
mcp_config.json                # NEW (gitignored)
mcp_config.json.example        # NEW (committed)
```

### Pattern 1: Manifest Loader
**What:** Reads `tool_manifest.json`, validates each entry, wraps each enabled script as a `Tool` object that pipes JSON to stdin and reads ToolResult from stdout, then registers with ToolRegistry (skipping collisions and missing handlers).
**When to use:** Called once at startup, after all built-in tool registrations.
**Example:**
```typescript
// src/tools/manifest-loader.ts
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Tool, ToolResult } from "./tool-types.js";
import type { ToolRegistry } from "./tool-registry.js";
import { log } from "../logger.js";

interface ManifestEntry {
  name: string;
  description: string;
  parameters: object;
  handler_path: string;
  enabled?: boolean;  // default true
}

export function loadToolManifest(registry: ToolRegistry, manifestPath?: string): void {
  const filePath = manifestPath ?? process.env.MANIFEST_PATH ?? "./tool_manifest.json";
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    log("info", "manifest-loader", "tool_manifest.json not found — starting without manifest tools", { path: resolved });
    return;
  }

  let entries: ManifestEntry[];
  try {
    const raw = readFileSync(resolved, "utf-8");
    entries = JSON.parse(raw) as ManifestEntry[];
  } catch (err) {
    log("error", "manifest-loader", "Failed to parse tool_manifest.json — starting without manifest tools", {
      path: resolved,
      error: (err as Error).message,
    });
    return;
  }

  for (const entry of entries) {
    if (entry.enabled === false) continue;

    const handlerPath = resolve(entry.handler_path);
    if (!existsSync(handlerPath)) {
      log("error", "manifest-loader", `Handler not found for tool "${entry.name}" — skipping`, { handlerPath });
      continue;
    }

    const tool: Tool = buildManifestTool(entry, handlerPath);
    try {
      registry.register(tool);
      log("info", "manifest-loader", `Registered manifest tool: ${entry.name}`);
    } catch {
      // Collision with built-in — built-in has priority
      log("error", "manifest-loader", `Tool "${entry.name}" collides with existing tool — skipping (built-in has priority)`);
    }
  }
}
```

### Pattern 2: Script Tool Execution via stdin/stdout
**What:** Each manifest tool's `execute()` spawns the interpreter, writes JSON args to stdin, reads JSON ToolResult from stdout.
**When to use:** Inside the `Tool.execute()` method built for each manifest entry.
**Example:**
```typescript
function buildManifestTool(entry: ManifestEntry, handlerPath: string): Tool {
  // Resolve interpreter by extension
  let interpreter: string;
  if (handlerPath.endsWith(".py")) interpreter = "python3";
  else if (handlerPath.endsWith(".sh")) interpreter = "/bin/bash";
  else if (handlerPath.endsWith(".ts")) interpreter = "tsx";
  else interpreter = handlerPath; // executable directly

  return {
    definition: {
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters as import("./tool-types.js").JsonSchema,
    },
    async execute(args, context): Promise<ToolResult> {
      // Security gate — same 3-layer check as execute_command
      const { classifyCommand } = await import("../security/command-classifier.js");
      const classification = classifyCommand(handlerPath, []);
      if (classification === "blocked") {
        return { success: false, data: null, error: "Handler path is blocked by security policy" };
      }
      // risky path: request approval (reuse approvalGateRef pattern from execute-command.ts)
      // ... approval flow ...

      return new Promise<ToolResult>((resolve) => {
        const child = spawn(interpreter, [handlerPath], {
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
          timeout: 30_000,
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

        child.stdin.write(JSON.stringify(args));
        child.stdin.end();

        child.on("close", (code) => {
          if (code !== 0) {
            resolve({ success: false, data: null, error: `Handler exited with code ${code}: ${stderr}` });
            return;
          }
          try {
            const result = JSON.parse(stdout) as ToolResult;
            resolve(result);
          } catch {
            resolve({ success: false, data: null, error: `Handler stdout is not valid JSON: ${stdout.slice(0, 200)}` });
          }
        });

        child.on("error", (err) => {
          resolve({ success: false, data: null, error: `Failed to spawn handler: ${err.message}` });
        });
      });
    },
  };
}
```

### Pattern 3: MCP Config Loader with `${VAR}` Substitution
**What:** Reads `mcp_config.json`, expands `${VAR}` tokens in `env` and `headers` fields, skips disabled or failed servers, returns parsed config for Phase 6 to consume.
**When to use:** Called at startup; result stored as module-level object. Phase 6 reads it to open connections.
**Example:**
```typescript
// src/tools/mcp-config-loader.ts
const VAR_PATTERN = /\$\{([^}]+)\}/g;

function substituteEnvVars(value: string, serverName: string): string | null {
  let ok = true;
  const result = value.replace(VAR_PATTERN, (_, varName: string) => {
    const val = process.env[varName];
    if (val === undefined) {
      log("error", "mcp-config-loader", `Undefined env var "${varName}" in server "${serverName}" — skipping server`);
      ok = false;
      return "";
    }
    return val;
  });
  return ok ? result : null;
}

export interface McpServerConfig {
  name: string;
  type: "stdio" | "streamable-http";
  // stdio fields
  command?: string;
  args?: string[];
  // http fields
  url?: string;
  headers?: Record<string, string>;
  // common
  env?: Record<string, string>;
}

export function loadMcpConfig(mcpConfigPath?: string): McpServerConfig[] {
  const filePath = mcpConfigPath ?? process.env.MCP_CONFIG_PATH ?? "./mcp_config.json";
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    log("info", "mcp-config-loader", "mcp_config.json not found — no MCP servers configured", { path: resolved });
    return [];
  }

  let raw: { mcpServers?: Record<string, unknown> };
  try {
    raw = JSON.parse(readFileSync(resolved, "utf-8")) as typeof raw;
  } catch (err) {
    log("error", "mcp-config-loader", "Failed to parse mcp_config.json", { error: (err as Error).message });
    return [];
  }

  const servers: McpServerConfig[] = [];
  for (const [name, entry] of Object.entries(raw.mcpServers ?? {})) {
    const e = entry as Record<string, unknown>;
    if (e.enabled === false) {
      log("info", "mcp-config-loader", `MCP server "${name}" is disabled — skipping`);
      continue;
    }

    // Substitute ${VAR} in env and headers
    let resolvedEnv: Record<string, string> | undefined;
    if (e.env && typeof e.env === "object") {
      resolvedEnv = {};
      let failed = false;
      for (const [k, v] of Object.entries(e.env as Record<string, string>)) {
        const expanded = substituteEnvVars(v, name);
        if (expanded === null) { failed = true; break; }
        resolvedEnv[k] = expanded;
      }
      if (failed) continue; // skip this server
    }

    servers.push({
      name,
      type: (e.type as "stdio" | "streamable-http") ?? "stdio",
      command: e.command as string | undefined,
      args: e.args as string[] | undefined,
      url: e.url as string | undefined,
      headers: resolvedEnv,
      env: resolvedEnv,
    });
  }
  return servers;
}
```

### Pattern 4: Wiring in index.ts
**What:** Insert loader calls after all built-in registrations, before LLM init.
**Example:**
```typescript
// In main() in index.ts, after all toolRegistry.register() calls for built-ins:
import { loadToolManifest } from "./tools/manifest-loader.js";
import { loadMcpConfig } from "./tools/mcp-config-loader.js";

// Load external tool sources (after built-ins — built-ins have collision priority)
loadToolManifest(toolRegistry);
const mcpConfigs = loadMcpConfig();
// mcpConfigs stored; Phase 6 will open connections using this data
log("info", "startup", `Loaded ${mcpConfigs.length} MCP server config(s)`, {
  servers: mcpConfigs.map(s => s.name)
});
```

### Anti-Patterns to Avoid
- **Calling loaders before built-in registrations:** Built-ins must be registered first so collision detection correctly gives them priority.
- **Using `JSON.parse` without try/catch:** A malformed JSON file must be a recoverable error, not an uncaught exception crashing startup.
- **Substituting `${VAR}` in command/args fields:** User decision: only `env` and `headers` fields get substitution. Substituting in `command` would allow injection via env vars.
- **Throwing on duplicate tool name in loader:** `ToolRegistry.register()` throws; the loader must catch and log, not propagate.
- **Missing `child.stdin.end()` after writing:** Forgetting to close stdin causes the child process to wait forever for more input — deadlock.
- **Blocking main thread on script execution:** `Tool.execute()` is async; use `new Promise` wrapping the spawn event callbacks, not synchronous `execFileSync`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Security gate for script tools | Custom allow/deny logic | Reuse `classifyCommand` + `approvalGateRef` from `execute-command.ts` | Already battle-tested; avoids duplicate security logic |
| Child process execution | Custom exec wrapper | Reuse `executeAndFormat` logic pattern from `execute-command.ts` | Handles timeout, output truncation, exit codes, stderr |
| Collision detection | Custom name uniqueness check | Rely on `ToolRegistry.register()` throw + catch | Already implemented; consistent behavior |
| JSON schema validation | Full validation library | Manual field presence checks | Schema is simple; zod adds a dependency for no real gain |

**Key insight:** The hard work (security, process spawning, collision detection, logging) is already done in existing modules. Phase 5 is largely a wiring exercise.

---

## Common Pitfalls

### Pitfall 1: Collision with ToolRegistry.register() throws
**What goes wrong:** `ToolRegistry.register()` throws `Error: Tool "foo" already registered`. If the manifest loader doesn't catch this, it crashes the entire startup.
**Why it happens:** ToolRegistry was designed for built-ins where duplicate registration is always a programming error.
**How to avoid:** Wrap `registry.register(tool)` in try/catch inside the loader loop. Log the collision and continue with the next entry.
**Warning signs:** Any test that registers a manifest tool with the same name as a built-in will surface this.

### Pitfall 2: Script tool stdin/stdout deadlock
**What goes wrong:** Script receives args on stdin, processes them, but the Node.js parent is also trying to write large args and waiting — causing a deadlock if the pipe buffer fills.
**Why it happens:** Synchronous writes to a full pipe buffer block the process.
**How to avoid:** Always end stdin after writing (`child.stdin.end()`). For typical tool args (JSON objects), the buffer limit is unlikely to be hit, but the pattern must be correct.
**Warning signs:** Tool hangs indefinitely; no timeout fires if `spawn` options timeout is omitted.

### Pitfall 3: handler_path relative resolution
**What goes wrong:** `handler_path: "./scripts/backup.py"` resolves against Node's cwd at runtime, which may differ from the project root.
**Why it happens:** `path.resolve` uses `process.cwd()` which depends on how Jarvis is started.
**How to avoid:** Document in the example file that absolute paths are recommended. Optionally resolve relative paths against the directory of `tool_manifest.json` itself (using `path.dirname(resolved)` where `resolved` is the manifest file path).
**Warning signs:** "Handler not found" errors at startup despite file being present.

### Pitfall 4: ${VAR} substitution partial failure
**What goes wrong:** A multi-key env object partially substitutes — some vars resolve, one doesn't. The partially-resolved env object leaks into the config.
**Why it happens:** Iterating env fields one by one and only failing after partial writes.
**How to avoid:** Use a `failed` flag. If any variable fails, skip the entire server (don't push a partially-resolved config).
**Warning signs:** MCP server connection attempt with partial/wrong credentials in Phase 6.

### Pitfall 5: Unresolved `${VAR}` in non-env fields
**What goes wrong:** User copies Claude Desktop config with a `${TOKEN}` in the `command` field. Loader silently passes literal `"${TOKEN}"` as the command string.
**Why it happens:** Substitution only runs on `env`/`headers` per spec.
**How to avoid:** This is the correct behavior per decisions. Document clearly in the example file that `${VAR}` only works in `env` and `headers`.
**Warning signs:** Phase 6 fails to spawn stdio server with weird command name.

### Pitfall 6: ToolResult format contract with scripts
**What goes wrong:** A Python or bash script outputs plain text instead of `{"success": true, "data": ...}` — the loader's JSON parse fails.
**Why it happens:** Script author doesn't know the expected output format.
**How to avoid:** Document the expected output format in `tool_manifest.json.example` and in a comment in the loader. Produce a clear error: "Handler stdout is not valid JSON".
**Warning signs:** All manifest tools return "not valid JSON" errors at runtime.

---

## Code Examples

Verified patterns from existing codebase:

### Existing interpreter dispatch (from execute-command.ts)
```typescript
// Source: src/tools/built-in/execute-command.ts lines 199-208
if (command.endsWith(".sh")) {
  resolvedCommand = "/bin/bash";
  resolvedArgs = [command, ...argList];
} else if (command.endsWith(".py")) {
  resolvedCommand = "python3";
  resolvedArgs = [command, ...argList];
} else if (command.endsWith(".ts")) {
  resolvedCommand = "tsx";
  resolvedArgs = [command, ...argList];
}
```

### ToolRegistry collision throw
```typescript
// Source: src/tools/tool-registry.ts lines 6-9
register(tool: Tool): void {
  if (this.tools.has(tool.definition.name)) {
    throw new Error(`Tool "${tool.definition.name}" already registered`);
  }
  this.tools.set(tool.definition.name, tool);
}
```

### logger.ts signature
```typescript
// Source: src/logger.ts
log(level: "info" | "warn" | "error" | "debug", category: string, message: string, data?: Record<string, unknown>): void
```

### Conditional tool registration pattern
```typescript
// Source: src/index.ts lines 86-101
if (config.google.enabled.drive) {
  toolRegistry.register(gwsDriveTool);
  log("info", "startup", "Google Drive tool enabled");
}
```

### execFile with env inheritance
```typescript
// Source: src/tools/built-in/execute-command.ts lines 211-217
const { stdout, stderr } = await execFileAsync(resolvedCommand, resolvedArgs, {
  shell: false,
  timeout: 30_000,
  cwd,
  maxBuffer: 10 * 1024 * 1024,
  env: process.env,   // inherit full env
});
```

### Example tool_manifest.json schema
```json
[
  {
    "name": "backup_photos",
    "description": "Backup photos from Downloads to external drive",
    "parameters": {
      "type": "object",
      "properties": {
        "source": { "type": "string", "description": "Source directory" },
        "destination": { "type": "string", "description": "Destination directory" }
      },
      "required": ["source", "destination"]
    },
    "handler_path": "/Users/max/scripts/backup_photos.py",
    "enabled": true
  }
]
```

### Example mcp_config.json schema
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/max/Documents"],
      "enabled": true
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "enabled": true
    },
    "remote-service": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/v1",
      "headers": {
        "Authorization": "Bearer ${REMOTE_MCP_TOKEN}"
      },
      "enabled": false
    }
  }
}
```

### Script handler output contract (for documentation in example)
```python
# A manifest tool handler must write a JSON ToolResult to stdout
import json, sys

args = json.load(sys.stdin)
# ... do work ...
print(json.dumps({"success": True, "data": {"result": "done"}}))
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded tool list in index.ts | Manifest-driven tool discovery | Phase 5 (this phase) | User can add tools without editing TypeScript |
| Built-in tools only | Built-ins + manifest scripts + MCP servers | Phase 5-6 | Extensible tool ecosystem |
| Secrets in .env only | Secrets in .env, referenced via ${VAR} in manifest | Phase 5 (this phase) | MCP config files can be version-controlled (minus .env) |

**Deprecated/outdated:**
- SSE transport for MCP: Deprecated in MCP spec; StreamableHTTP replaces it (already captured in REQUIREMENTS.md out-of-scope)

---

## Open Questions

1. **Approval gate wiring for manifest tools**
   - What we know: The approval gate (`approvalGateRef`) is set via `setApprovalGate()` in index.ts, and requires access to the Telegram send functions which are wired after the tool registry setup
   - What's unclear: The manifest loader runs before the Telegram channel starts, so `approvalGateRef` may not be set yet at load time. The actual gate ref is checked at `execute()` time, not at `register()` time.
   - Recommendation: This is fine — `approvalGateRef` check happens inside `execute-command.ts` at call time, not at registration time. The same pattern applies to manifest tools. The manifest loader only registers tools; the gate is checked when the tool actually runs. No action needed.

2. **TypeScript type for mcpConfigs storage**
   - What we know: `loadMcpConfig()` returns `McpServerConfig[]`. This array needs to be passed to Phase 6's MCP client initializer.
   - What's unclear: Whether to store it in `config.ts` or pass it as a return value from the loader.
   - Recommendation: Return value from loader stored in a local variable in `main()` and passed to Phase 6's initialization function. Matches existing pattern (`memoryManager` is created and passed around, not stored globally).

3. **Path resolution strategy for handler_path**
   - What we know: `path.resolve(entry.handler_path)` uses `process.cwd()` which is typically the project root when started with npm scripts.
   - What's unclear: Whether to resolve relative to manifest file location or cwd.
   - Recommendation: Resolve relative to project root (cwd). Document this in the `.example` file with a note that absolute paths are safest. Match how Claude Desktop handles MCP server paths.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test infrastructure exists in this project |
| Config file | None — Wave 0 must create if needed |
| Quick run command | N/A |
| Full suite command | N/A |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MNFST-01 | `mcp_config.json` with mcpServers object is parsed into McpServerConfig[] | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-01 | Disabled server (enabled: false) is skipped | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-01 | Missing file logs info and returns empty | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-01 | Malformed JSON logs error and returns empty | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-02 | `${VAR}` in env field is replaced with process.env value | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-02 | Partial substitution "Bearer ${TOKEN}" works | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-02 | Undefined var causes server to be skipped | unit | Manual verification at startup | ❌ Wave 0 |
| MNFST-03 | Only servers with enabled: true (or omitted) are returned | unit | Manual verification at startup | ❌ Wave 0 |

### Sampling Rate
- No automated test framework in this project — all validation via TypeScript compile check + manual startup testing.
- **Per task:** `npm run typecheck` to verify no TypeScript errors
- **Per wave:** `npm run dev` startup smoke test with example config files
- **Phase gate:** Both loader modules pass `npm run typecheck` + startup loads and logs correctly

### Wave 0 Gaps
- No test infrastructure to create — this project has no test runner.
- All validation is via TypeScript type-checking (`npm run typecheck`) and manual startup smoke tests.
- The planner should include a startup smoke test task as the final verification step.

*(Note: Adding a test framework is out of scope for this phase — the project has zero test infrastructure and introducing one would be a separate architectural decision.)*

---

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/tools/execute-command.ts` — interpreter dispatch pattern, execFile options, timeout/env handling
- Existing codebase: `src/tools/tool-registry.ts` — ToolRegistry.register() collision behavior
- Existing codebase: `src/logger.ts` — log() signature and categories
- Existing codebase: `src/config.ts` — requireEnv() pattern and optional path overrides
- Existing codebase: `src/index.ts` — startup wiring sequence, conditional registration pattern
- Node.js docs: `child_process.spawn` with stdio:'pipe' — stdin write + stdout read pattern

### Secondary (MEDIUM confidence)
- Claude Desktop config format (`claude_desktop_config.json`) — `mcpServers` key structure with `command`, `args`, `env` fields; this is the format the user's mcp_config.json must be a superset of

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all Node.js built-ins, no new packages
- Architecture: HIGH — direct pattern reuse from existing codebase
- Pitfalls: HIGH — derived from code analysis of existing execute-command.ts and ToolRegistry
- Validation: HIGH — no test infrastructure confirmed by filesystem inspection

**Research date:** 2026-03-19
**Valid until:** 2026-06-19 (stable domain — Node.js built-ins, no external APIs)
