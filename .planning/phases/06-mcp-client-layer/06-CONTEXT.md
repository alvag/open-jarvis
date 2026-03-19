# Phase 6: MCP Client Layer - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Jarvis se conecta a MCP servers (stdio y StreamableHTTP), descubre sus tools via `listTools()`, y las ejecuta via `callTool()` — con crashes aislados, nombres con namespace prefix, y cierre limpio al shutdown. Este phase implementa el client para un solo server; la orquestación multi-server es Phase 7.

</domain>

<decisions>
## Implementation Decisions

### Ciclo de vida de conexiones
- Conexión eager: todos los servers habilitados se conectan durante startup, antes de aceptar mensajes de Telegram
- Si un server falla al conectar: log warning y continuar sin él (filosofía resiliente consistente con Phase 5)
- Timeout de conexión: 10 segundos por server — si no conecta, skip con warning
- Shutdown: integrar MCP disconnect en el flujo de shutdown existente de index.ts (entre parar scheduler y parar Telegram), respetando el timeout de 15s ya implementado

### Adaptación de tools al ToolRegistry
- Namespace prefix: `serverName__toolName` (doble underscore como separador)
- Schema: pasar JSON Schema raw del MCP tool al LLM tal cual — no normalizar ni aplanar schemas complejos (nested objects, arrays). OpenRouter y modelos modernos manejan schemas complejos
- Colisiones de nombre: error en startup, no registrar el MCP tool — log error claro con los nombres involucrados (consistente con Success Criteria #2 del roadmap)
- Resultado de callTool(): mapear MCP content array a ToolResult — extraer texto del primer content item como data, mapear isError a success:false

### Manejo de errores en runtime
- Tool falla mid-session: retornar ToolResult con error estructurado — `{success: false, error: "MCP server 'name' error: description"}` — consistente con cómo fallan los demás tools
- Child process crashea: marcar server como muerto, todas sus tools retornan error hasta restart de Jarvis (no auto-reconnect en v1.1, decisión previa de STATE.md)
- Notificación de crashes: solo log, no notificar por Telegram — el LLM ya informa al usuario si un tool falla en conversación
- stderr del child process: capturar y loguear con categoría "mcp:{serverName}" para debugging

### SDK y transporte
- SDK: `@modelcontextprotocol/sdk` (oficial, usado por Claude Desktop, Cursor, etc.)
- Child process env: heredar process.env completo + env variables del mcp_config.json (ya resueltas por mcp-config-loader). Compatible con Claude Desktop
- Pattern: clase `McpClient` que encapsula Client del SDK, transport, estado (connected/dead), y métodos connect/disconnect/listTools/callTool
- Ubicación: `src/mcp/` (directorio nuevo) — mcp-client.ts, mcp-tool-adapter.ts. Consistente con separación por capas del proyecto

### Claude's Discretion
- Implementación interna del McpClient (manejo de eventos del SDK, buffer de stderr)
- Estructura exacta del McpToolAdapter (cómo wrappea execute() para rutear a callTool)
- Manejo de edge cases en schema normalization (tools sin parameters, etc.)
- Orden exacto de operaciones en connect() (create transport → connect → listTools)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tool system (integración)
- `src/tools/tool-types.ts` — Interface Tool, ToolDefinition, ToolResult, ToolContext que MCP tools deben implementar
- `src/tools/tool-registry.ts` — ToolRegistry con collision detection (throws en duplicado) — MCP tools se registran aquí
- `src/tools/mcp-config-loader.ts` — McpServerConfig type y loadMcpConfig() que retorna configs ya parseadas y validadas
- `src/index.ts` — Startup sequence actual: loadMcpConfig() en línea 136 retorna configs, MCP client debe conectar después

### Convenciones del proyecto
- `src/logger.ts` — log(level, category, message, data?) para mensajes consistentes
- `src/config.ts` — Patrón de configuración via env vars

### Requirements
- `.planning/REQUIREMENTS.md` — MCP-01 a MCP-09, SEC-03, SEC-04 (requirements de este phase)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `McpServerConfig` (mcp-config-loader.ts): Type ya definido con name, type, command, args, url, headers, env — input directo para McpClient
- `loadMcpConfig()`: Ya se llama en index.ts y retorna array de configs resueltas — no hay que parsear config de nuevo
- `ToolRegistry.register()`: Punto de entrada para agregar MCP tools adaptadas — ya tiene collision detection
- `log()`: Logger con categorías — usar "mcp" como categoría base, "mcp:{serverName}" para stderr

### Established Patterns
- Feature flags via env vars para tools condicionales (Google, Bitbucket) — MCP sigue el mismo patrón (enabled en config)
- ToolResult como formato universal: {success, data, error} — MCP tools deben retornar lo mismo
- Try-catch en tool execution retorna error estructurado, nunca throw — MCP adapter debe seguir este patrón
- Startup wiring en index.ts: init → register tools → start channel — MCP connect va entre register y start

### Integration Points
- `index.ts` línea 136: `loadMcpConfig()` ya retorna configs — siguiente paso es conectar y registrar tools
- `shutdown()` en index.ts: agregar MCP disconnect entre `stopScheduler()` y `telegram.stop()`
- `ToolRegistry`: MCP tools adaptadas se registran igual que cualquier otra tool

</code_context>

<specifics>
## Specific Ideas

- El McpClient es un wrapper alrededor del Client del SDK oficial — no reimplementar el protocolo
- El flujo es: McpServerConfig (de Phase 5) → McpClient.connect() → listTools() → McpToolAdapter wrappea cada tool → ToolRegistry.register()
- stderr del child process es valioso para debugging — loguear con categoría específica por server
- El timeout de 10s para conexión inicial cubre el caso de npx que hace npm install al primer uso

</specifics>

<deferred>
## Deferred Ideas

- Auto-reconnect cuando un server crashea — evaluable en v2 (MCPX-05 cubre lazy connections)
- Notificación proactiva por Telegram cuando un server crashea — posible en v2
- allowedTools filter per server (MCPX-02) — deferido a v2
- tools/list_changed notification handling (MCPX-03) — deferido a v2

</deferred>

---

*Phase: 06-mcp-client-layer*
*Context gathered: 2026-03-19*
