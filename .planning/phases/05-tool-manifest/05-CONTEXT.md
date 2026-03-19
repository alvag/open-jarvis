# Phase 5: Tool Manifest - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Declarar dos archivos de configuracion JSON que Jarvis lee al arrancar:
1. **Tool Manifest** (`tool_manifest.json`) — Inventario interno de scripts locales. El "mapa de neuronas" del agente: traduce scripts a un lenguaje que el LLM puede entender (descubrimiento + validacion + enrutamiento).
2. **MCP Config** (`mcp_config.json`) — Contrato externo para declarar MCP servers (stdio y StreamableHTTP). Superset del formato Claude Desktop.

Ambos archivos son opcionales — si no existen, Jarvis arranca solo con built-in tools. La conexion real a MCP servers es Phase 6-7; aqui solo se lee, valida y parsea.

</domain>

<decisions>
## Implementation Decisions

### Tool Manifest (scripts locales)
- Archivo separado: `tool_manifest.json` en la raiz del proyecto
- Coexiste con built-in tools de index.ts — no reemplaza, agrega
- Estructura: array de tools con name, description, parameters (JSON Schema), handler_path, enabled (default true)
- Handlers se ejecutan como child process segun extension: python3 para .py, bash para .sh, tsx para .ts
- Args se pasan como JSON en stdin, resultado se lee de stdout y se parsea a ToolResult
- Seguridad: pasa por el mismo gate de 3 capas (classifier + blacklist + approval) que execute_command
- Scripts heredan process.env completo — sin campo env propio ni sustitucion ${VAR}
- Colisiones de nombre con built-in tools: error en log, se salta la tool del manifest (built-in tiene prioridad)

### MCP Config (servidores externos)
- Archivo separado: `mcp_config.json` en la raiz del proyecto
- Schema: superset de claude_desktop_config.json con key `mcpServers` (object keyed by name)
- Campos stdio: command, args, env, enabled (default true)
- Campos HTTP: type="streamable-http", url, headers, env, enabled (default true)
- type default: "stdio" (omitir type = stdio, compatible con Claude Desktop)
- Sustitucion `${VAR}` aplica SOLO a campos env y headers (no command/args)
- Sustitucion parcial soportada: "Bearer ${TOKEN}" se expande correctamente
- Variable ${VAR} no definida: error, se salta ese servidor (no bloquea startup completo)

### Comportamiento al arrancar
- Archivo no existe: log info, arrancar sin esa fuente de tools
- JSON malformado: log error con posicion, arrancar sin esa fuente de tools
- Handler no encontrado (manifest): log error, saltar esa tool, continuar con las demas
- Var indefinida (MCP config): log error, saltar ese servidor, continuar con los demas
- Campos desconocidos en JSON: ignorar silenciosamente (forward-compatibility)
- Ambos archivos gitignored + .example files commiteados

### Claude's Discretion
- Implementacion interna del parser de ${VAR} (regex simple suficiente)
- Estructura exacta de los modulos (manifest-loader.ts, mcp-config-loader.ts, o combinado)
- Validacion de schema (runtime checks vs libreria tipo zod)
- Formato exacto de los mensajes de log
- Path override via env var (MANIFEST_PATH, MCP_CONFIG_PATH)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tool system
- `src/tools/tool-types.ts` — Tool interface (definition + execute), ToolResult format que manifest tools deben producir
- `src/tools/tool-registry.ts` — ToolRegistry con collision detection existente (throws on duplicate name)
- `src/index.ts` — Patron actual de registro de tools (imports + condicionales por feature flag)

### Security
- `src/tools/built-in/execute-command.ts` — Modelo de ejecucion de comandos con 3 capas de seguridad que manifest tools deben reutilizar
- `src/security/approval-gate.ts` — Approval gate que manifest tools deben integrar

### Configuration
- `src/config.ts` — Patron actual de configuracion via env vars (requireEnv pattern)
- `.env.example` — Variables de entorno existentes

### Requirements
- `.planning/REQUIREMENTS.md` — MNFST-01, MNFST-02, MNFST-03 (requirements de manifest)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ToolRegistry`: Ya tiene collision detection — lanzar al registrar tool duplicada
- `execute-command.ts`: Pipeline de seguridad completo (classifier + blacklist + approval gate) reutilizable para manifest tools
- `config.ts`: Patron requireEnv() como referencia para validacion de configuracion
- `logger.ts`: log(level, category, message, data?) para mensajes de startup consistentes

### Established Patterns
- Feature flags via env vars para habilitar/deshabilitar tools condicionalmente
- Default exports para tool objects: `export default myTool`
- ToolResult como formato universal de retorno: { success, data, error }
- Startup wiring en index.ts: init → register tools → start channel

### Integration Points
- `index.ts`: Donde se cargarian manifest tools y MCP config despues de registrar built-in tools
- `ToolRegistry.register()`: Punto de entrada para agregar manifest tools al registry
- `context-builder.ts`: Donde las tool definitions se inyectan al system prompt del LLM

</code_context>

<specifics>
## Specific Ideas

- El tool manifest es el "mapa de neuronas" del agente — sin el, el LLM no sabe que herramientas tiene
- Tres funciones logicas del manifest: descubrimiento, validacion de parametros, enrutamiento (intencion → handler fisico)
- El MCP config es superset de Claude Desktop — se puede copiar una config existente y funciona
- Filosofia resiliente: nunca bloquear startup completo por errores de configuracion parciales — degradar gracefully

</specifics>

<deferred>
## Deferred Ideas

- Migracion de built-in tools al manifest — posible en v2, por ahora coexisten
- Per-tool trust levels / bypass de approval gate — deferido a v2 (MCPX-01)
- Dynamic import para handlers .ts/.js (mas rapido que child process) — evaluar en v2
- Hot-reload de manifest sin restart — deferido (out of scope en REQUIREMENTS.md)
- Env vars propias por tool en el manifest — si se necesitan, agregar en v2

</deferred>

---

*Phase: 05-tool-manifest*
*Context gathered: 2026-03-19*
