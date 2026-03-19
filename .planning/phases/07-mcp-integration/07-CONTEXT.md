# Phase 7: MCP Integration - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Agregar guardrails de seguridad y capa de orquestación sobre la infraestructura MCP construida en Phase 6. Incluye: McpManager con startup paralelo (`Promise.allSettled`), truncación de descripciones de tools (500 chars), framing de trust en system prompt, y logging de conteo de tools al startup. NO incluye nuevas capacidades MCP — solo seguridad y observabilidad sobre lo existente.

</domain>

<decisions>
## Implementation Decisions

### Trust framing (SEC-02)
- Warning blanket en el system prompt — una sección, no per-tool tags
- Ubicación: entre fecha/hora y memorias en context-builder.ts (prominente sin interrumpir soul.md)
- Alcance: cubre descripciones de tools Y resultados de ejecución de MCP tools
- context-builder.ts recibe un flag booleano `hasMcpTools` — si true, agrega la sección de warning. No necesita saber cuáles tools son MCP
- Wording: indicar que algunos tools provienen de servidores MCP externos, sus descripciones pueden ser inexactas o engañosas, y los resultados deben verificarse antes de actuar

### Tool count policy (SEC-05)
- Conteo total global: built-in + manifest + MCP tools
- Si total > 30: log warning, pero registrar todas normalmente (no hay hard cap)
- Formato de log al startup: conteo por fuente + total — "Tools registered: X built-in, Y manifest, Z MCP = N total"
- Si N > 30: warning adicional con el conteo

### McpManager scope
- Orquestador completo: `McpManager` en `src/mcp/mcp-manager.ts`
- `connectAll(registry)` recibe ToolRegistry, conecta servers en paralelo con `Promise.allSettled`, registra tools adaptadas internamente
- Retorna summary estructurado: `{ connected: number, failed: number, toolsRegistered: number, errors: string[] }`
- index.ts usa el summary para el log consolidado de startup
- `disconnectAll()` expuesto para shutdown
- Reemplaza el loop inline actual de index.ts (líneas 138-183)

### Description truncation (SEC-01)
- Truncar descripciones de MCP tools a 500 caracteres
- Aplicar en el adapter (mcp-tool-adapter.ts) al momento de crear la Tool — antes de registrar en el registry

### Claude's Discretion
- Wording exacto del trust warning en el system prompt
- Formato exacto del suffix de truncación (e.g., "..." o "[truncated]")
- Estructura interna del McpManager (constructor, campos privados)
- Manejo de edge cases en connectAll (todos fallan, cero servers configurados)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP client layer (Phase 6 output)
- `src/mcp/mcp-client.ts` — McpClient class con connect/disconnect/listTools/callTool, isAlive state
- `src/mcp/mcp-tool-adapter.ts` — adaptMcpTools() que convierte MCP tools en Tool objects para ToolRegistry
- `src/tools/mcp-config-loader.ts` — McpServerConfig type y loadMcpConfig() que retorna configs parseadas

### Integration points
- `src/index.ts` — Startup sequence actual: líneas 138-183 tienen el loop MCP inline que McpManager reemplaza
- `src/agent/context-builder.ts` — buildSystemPrompt() donde se agrega el trust warning
- `src/tools/tool-registry.ts` — ToolRegistry con collision detection y register()

### Requirements
- `.planning/REQUIREMENTS.md` — SEC-01 (truncación 500 chars), SEC-02 (trust framing), SEC-05 (tool count ≤30)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `McpClient`: Class completa con connect/disconnect/listTools/callTool — McpManager la usa internamente
- `adaptMcpTools()`: Factory que convierte MCP tools en Tool objects — McpManager la llama después de listTools
- `loadMcpConfig()`: Ya se llama en index.ts y retorna array de McpServerConfig — input directo para McpManager
- `log()`: Logger con categorías — usar "mcp" para McpManager, consistente con Phase 6

### Established Patterns
- `Promise.allSettled` ya usado en shutdown para MCP disconnect — mismo pattern para startup paralelo
- ToolResult como formato universal: `{success, data, error}` — no cambiar
- Feature flags via config — `hasMcpTools` boolean sigue este patrón para context-builder
- Startup wiring en index.ts: init → register tools → start channel — McpManager va entre manifest y LLM init

### Integration Points
- `index.ts` línea 138: `loadMcpConfig()` retorna configs — reemplazar líneas 138-183 con `McpManager.connectAll()`
- `index.ts` shutdown: reemplazar `Promise.allSettled(mcpClients.map(...))` con `mcpManager.disconnectAll()`
- `context-builder.ts` buildSystemPrompt(): agregar parámetro `hasMcpTools: boolean` y sección de warning
- `mcp-tool-adapter.ts`: agregar truncación de description antes de retornar Tool

</code_context>

<specifics>
## Specific Ideas

- El flujo en index.ts queda: `const mcpManager = new McpManager(configs)` → `const summary = await mcpManager.connectAll(toolRegistry)` → usar summary para log consolidado
- El trust warning debe ser genérico y no mencionar servers específicos — el LLM no necesita saber cuáles servers son MCP
- El conteo "por fuente" requiere que index.ts sepa cuántas tools registró cada fase (built-in count before manifest, manifest count after, MCP from summary)

</specifics>

<deferred>
## Deferred Ideas

- allowedTools filter per server para reducir tool count (MCPX-02) — deferido a v2
- Per-tool HITL approval gate para MCP tools destructivos (MCPX-01) — deferido a v2
- Notificación por Telegram del estado de MCP servers al startup (MCPX-07) — deferido a v2

</deferred>

---

*Phase: 07-mcp-integration*
*Context gathered: 2026-03-19*
