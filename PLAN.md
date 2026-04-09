# Jarvis Improvement Plan — v2 Features Integration

## Context

Jarvis es un agente AI personal que usa Telegram como interfaz, OpenRouter como LLM, y SQLite para persistencia. Existia un `open-jarvis-2` con mejoras significativas que fue abandonado. Este plan rescata lo mejor de v2 e integrarlo en v1.

**Proyecto personal**: No necesitamos TUI, setup wizards, ni configuracion para terceros.

## Analisis de Agent SDKs

### Anthropic Agent SDK — Descartado
- Amarrado a modelos Claude (SDK se conecta a `api.anthropic.com`)
- `toolRunner()` y streaming acoplados al formato de respuesta de Anthropic
- Perderiamos model routing (simple/moderate/complex con distintos modelos via OpenRouter)
- No justifica la migracion para un proyecto que ya usa multi-modelo

### Vercel AI SDK + OpenRouter Provider — Futuro (Fase 8)
- Libertad total de modelos: 300+ via `@openrouter/ai-sdk-provider`
- Auto-router, provider routing, BYOK, streaming nativo
- Abstracciones limpias: `generateText()`, `streamText()`, tool calling con Zod
- **Pero**: Migracion significativa para un loop que funciona en ~50 lineas
- **Decision**: Considerar despues de portar todas las features de v2

### Decision Final
Mantener el agent loop custom. Es simple, funciona, y da control total. Foco en traer las mejoras reales de v2.

## Lo que NO traemos de v2
- Terminal/TUI channel (Ink, React, @clack/prompts)
- Setup wizard interactivo
- Formato config.json (mantenemos .env)
- drizzle-orm (mantenemos better-sqlite3 con prepared statements)

---

## Fases Completadas

### Fase A: Web Access (v1.0)

**Estado**: [x] Completada — v1.0 (2026-03-19)

- **Web Search** (`src/tools/built-in/web-search.ts`): Tavily API, depth modes basic/advanced, 5 resultados rapidos o investigacion profunda
- **Web Scrape** (`src/tools/built-in/web-scrape.ts`): Firecrawl API, JS rendering (SPAs/React), markdown extraction, 8K char limit con truncado inteligente
- **Content Security**: Marcadores `[WEB CONTENT - UNTRUSTED]` para awareness del agente

---

### Fase B: Security + Shell Execution (v1.0)

**Estado**: [x] Completada — v1.0 (2026-03-19)

- **Command Classifier** (`src/security/command-classifier.ts`): 3-tier (blocked/risky/safe), 23 comandos safe whitelistados, deteccion de flags peligrosos, fail-closed para desconocidos
- **Approval Gate** (`src/security/approval-gate.ts`): SQLite-backed, Telegram inline keyboard (Accept/Deny), 5min auto-expiry, recovery post-restart de approvals pendientes
- **Execute Command** (`src/tools/built-in/execute-command.ts`): `execFile` (nunca shell:true), 30s timeout, fire-and-forget para risky, rechazo de shell metacharacters, script interpreter resolution (.sh→bash, .py→python3, .ts→tsx), output limit 4096 chars

---

### Fase C: Scheduled Tasks (v1.0)

**Estado**: [x] Completada — v1.0 (2026-03-19)

- **Scheduler Manager** (`src/scheduler/scheduler-manager.ts`): Croner, 4 task types (reminder/task/briefing/pr-monitor), cola de ejecucion secuencial, two-strike retry (5min), one-shot detection
- **Scheduler Tools** (`src/scheduler/scheduler-tools.ts`): `schedule_task`, `list_scheduled_tasks`, `delete_scheduled_task`, `manage_scheduled_task`
- **PR Monitor** (`src/scheduler/pr-monitor.ts`): Bitbucket PRs, baseline tracking, change detection (state/commits/mentions/approvals), UPSERT para evitar duplicados
- **Morning Briefing**: Auto-seeded al startup, prompt multi-tool (Calendar → Gmail → Bitbucket → web search)

---

### Fase D: Supervisor Improvements (v1.0)

**Estado**: [x] Completada — v1.0 (2026-03-19)

- **Heartbeat**: IPC channel, child envia heartbeat cada 10s, watchdog mata despues de 30s sin heartbeat
- **Git Auto-Update**: `git fetch` periodico, comparacion local vs remote HEAD, `npm install` si `package-lock.json` cambio
- **Lifecycle Logging**: Notificacion Telegram en crash/restart (fetch directo, sin grammy)
- **Graceful Shutdown**: Tracking de requests in-flight, drain con timeout antes de cerrar

---

### Fase E: Tool Manifest (v1.1)

**Estado**: [x] Completada — v1.1 (2026-03-19)

- **Manifest Loader** (`src/tools/manifest-loader.ts`): Lee `tool_manifest.json`, interpreter resolution, security gate integration (misma 3-tier que execute_command), fire-and-forget para risky
- **Config** (`tool_manifest.json`): JSON array declarativo, schema con name/description/parameters/handler_path/enabled
- **Prioridad**: Built-in > Manifest > MCP (colisiones resueltas por prioridad)

---

### Fase F: MCP Client Layer + Integration (v1.1)

**Estado**: [x] Completada — v1.1 (2026-03-19)

- **MCP Client** (`src/mcp/mcp-client.ts`): Dual transport (stdio + StreamableHTTP), crash detection via `isAlive`, stderr capture
- **MCP Manager** (`src/mcp/mcp-manager.ts`): Parallel connect via `Promise.allSettled()`, 10s timeout por servidor, startup summary
- **MCP Tool Adapter** (`src/mcp/mcp-tool-adapter.ts`): Namespace `serverName__toolName`, description cap 500 chars (tool-poisoning defense SEC-01), dead server guard
- **MCP Config Loader** (`src/tools/mcp-config-loader.ts`): `mcp_config.json`, stdio + streamable-http, `${ENV_VAR}` substitution, skip si env var faltante
- **Tool Budget**: Warning si >30 tools activas, conteo por fuente (built-in/manifest/MCP)
- **Context Security** (SEC-02): System prompt marca tools MCP como untrusted cuando hay MCP activo

---

## Fases Pendientes

### Fase 1: Logging Estructurado

**Estado**: [ ] Pendiente
**Dependencias**: Ninguna
**Deps nuevas**: `pino`, `pino-roll`, `pino-pretty` (dev)

Reemplazar logger custom (`src/logger.ts` — `appendFileSync` plano) con pino structured logging.

**Archivos a modificar:**
- `src/logger.ts` — Reescribir: `createLogger(component)` factory, pino-roll para rotacion diaria, pino-pretty en dev, 7 dias retencion
- ~12 archivos que importan `log` de `../logger.js` — Actualizar a `const log = createLogger("component")`

**Referencia v2**: `open-jarvis-2/src/core/logger.ts`

**Verificacion:**
- [ ] `npm run typecheck` sin errores
- [ ] Logs en formato JSON estructurado en produccion
- [ ] Logs legibles con colores en dev
- [ ] Rotacion diaria funciona

---

### Fase 2: Tool Definition Format

**Estado**: [ ] Pendiente
**Dependencias**: Ninguna

Migrar de formato simplificado a formato OpenAI API completo para alinearlo con MCP y estandares.

```typescript
// ANTES (actual)
{ name: "tool_name", description: "...", parameters: {...} }

// DESPUES
{ type: "function", function: { name: "tool_name", description: "...", parameters: {...} } }
```

**Archivos a modificar:**
- `src/tools/tool-types.ts` — Cambiar interface `ToolDefinition` al formato wrapeado. Hacer `data` opcional en `ToolResult`
- `src/tools/tool-registry.ts` — Actualizar acceso a `tool.definition.function.name`. Agregar metodos: `unregister(name)`, `has(name)`, `getToolNames()`, getter `size`
- `src/llm/openrouter.ts` — Eliminar wrapping logic, pasar tools directo. Agregar retry con exponential backoff para errores 429/5xx. Agregar log de token usage
- `src/llm/llm-provider.ts` — Agregar `updateModels?()` a la interface. Agregar campo `usage` a `LLMChatResult`
- Todos los archivos en `src/tools/built-in/*.ts` — Actualizar `definition` al formato wrapeado
- `src/tools/manifest-loader.ts` — Actualizar generacion de definitions
- `src/mcp/mcp-tool-adapter.ts` — Actualizar conversion de MCP tools

**Verificacion:**
- [ ] `npm run typecheck` sin errores
- [ ] Bot responde como antes en Telegram
- [ ] Tools MCP y manifest siguen funcionando

---

### Fase 3: Tool Factory Pattern

**Estado**: [ ] Pendiente
**Dependencias**: Fase 2 (tool format)

Convertir tools de singletons estaticos a factory functions. Elimina el hack de `setMemoryManager()`.

```typescript
// ANTES
export const saveMemoryTool: Tool = { definition, execute };
export function setMemoryManager(mm: MemoryManager) { ... }

// DESPUES
export function createSaveMemoryTool(memoryManager: MemoryManager): Tool {
  return { definition, execute: (args, ctx) => { /* usa memoryManager directamente */ } };
}
```

**Archivos a modificar:**
- `src/tools/built-in/save-memory.ts` — Factory `createSaveMemoryTool(memoryManager)`
- `src/tools/built-in/search-memories.ts` — Factory `createSearchMemoriesTool(memoryManager)`
- `src/tools/built-in/get-current-time.ts` — Factory `createGetCurrentTimeTool()`
- `src/tools/built-in/propose-tool.ts` — Factory `createProposeToolTool()`
- `src/tools/built-in/table-image.ts` — Factory `createTableImageTool()`
- `src/tools/built-in/restart-server.ts` — Factory `createRestartServerTool()`
- `src/tools/built-in/gws-drive.ts` — Factory `createGwsDriveTool()`
- `src/tools/built-in/gws-gmail.ts` — Factory `createGwsGmailTool()`
- `src/tools/built-in/gws-calendar.ts` — Factory `createGwsCalendarTool()`
- `src/tools/built-in/gws-sheets.ts` — Factory `createGwsSheetsTool()`
- `src/tools/built-in/bitbucket-prs.ts` — Factory `createBitbucketPrsTool(config)`
- `src/tools/built-in/web-search.ts` — Factory `createWebSearchTool(config)`
- `src/tools/built-in/web-scrape.ts` — Factory `createWebScrapeTool(config)`
- `src/tools/built-in/execute-command.ts` — Factory `createExecuteCommandTool(deps)`
- `src/index.ts` — Actualizar toda la registracion usando factory calls

**Verificacion:**
- [ ] `npm run typecheck` sin errores
- [ ] `setMemoryManager` eliminado completamente
- [ ] Bot funciona igual en Telegram

---

### Fase 4: Mejoras de Memoria

**Estado**: [ ] Pendiente
**Dependencias**: Ninguna
**Deps nuevas**: `@secretlint/node`, `@secretlint/secretlint-rule-preset-recommend`

**Archivos nuevos:**
- `src/memory/memory-sanitizer.ts` — Singleton lazy de @secretlint/node. `containsSensitiveData(text)`, `detectSensitiveData(text)`. Detecta: API keys, tokens, passwords, SSH keys, AWS credentials
- `src/tools/built-in/delete-memory.ts` — Factory `createDeleteMemoryTool(memoryManager)`. Borra por ID + history
- `src/tools/built-in/audit-memories.ts` — Factory `createAuditMemoriesTool(memoryManager)`. Escanea con `detectSensitiveData()`, reporta flaggeadas

**Archivos a modificar:**
- `src/memory/memory-manager.ts` — Agregar `getAllMemories(userId)`, gate de sanitizacion en `saveMemory()`
- `src/index.ts` — Registrar delete_memory y audit_memories tools

**Referencia v2**: `open-jarvis-2/src/memory/memory-sanitizer.ts`, `open-jarvis-2/src/tools/built-in/delete-memory.ts`

**Verificacion:**
- [ ] `save_memory` con API key fake — rechazada
- [ ] `audit_memories` — escanea y reporta
- [ ] `delete_memory` — borra correctamente

---

### Fase 5: Sistema Soul Mejorado

**Estado**: [ ] Pendiente
**Dependencias**: Ninguna

**Archivos a modificar:**
- `src/memory/soul.ts` — Cargar multiples archivos:
  ```typescript
  interface SoulContent {
    soul: string;       // soul.md (required)
    agentRules?: string; // AGENTS.md (optional)
  }
  ```
- `src/agent/context-builder.ts` — Aceptar `SoulContent`. Construir system prompt con secciones:
  1. Personalidad (soul.md)
  2. Reglas del agente (AGENTS.md)
  3. Fecha/hora actual
  4. Memorias del usuario
  5. Contexto MCP (si aplica)
- `src/agent/agent.ts` — Actualizar firma para recibir `SoulContent`
- `src/index.ts` — Actualizar llamada a soul loading

**Referencia v2**: `open-jarvis-2/src/memory/soul-loader.ts`

**Verificacion:**
- [ ] System prompt contiene soul + AGENTS.md correctamente seccionado
- [ ] Sin AGENTS.md el bot sigue funcionando

---

### Fase 6: Tool Auto-Discovery (Opcional)

**Estado**: [ ] Pendiente — Evaluar necesidad
**Dependencias**: Fase 3 (factory pattern)

> **Nota**: Con el sistema de Tool Manifest (`tool_manifest.json`) ya implementado, el auto-discovery es menos critico. Evaluar si el valor agregado justifica la complejidad.

**Archivos nuevos:**
- `src/tools/tool-discovery.ts` — Escanea `src/tools/built-in/`, importa dinamicamente, encuentra `create*Tool` factories, las llama con deps apropiadas. Factories que retornan `null` se omiten (tools condicionales)

**Archivos a modificar:**
- `src/index.ts` — Reemplazar bloque manual de imports/registros con `await discoverAndRegisterTools(toolRegistry, toolDeps)`

**Verificacion:**
- [ ] Mismo set de tools en el registry antes y despues
- [ ] Tools condicionales desactivados no aparecen

---

### Fase 7: Validacion de Config con Zod (Opcional)

**Estado**: [ ] Pendiente
**Dependencias**: Ninguna
**Deps nuevas**: `zod`

**Archivos a modificar:**
- `src/config.ts` — Agregar schema Zod que valida el objeto config construido desde `.env`

**Verificacion:**
- [ ] Quitar env var requerido — error claro de Zod al startup
- [ ] Config completa — pasa validacion sin problemas

---

### Fase 8: Migracion a Vercel AI SDK (Futura, Opcional)

**Estado**: [ ] Evaluacion futura
**Deps nuevas**: `ai`, `@openrouter/ai-sdk-provider`

Solo considerar si:
- Se necesita streaming de respuestas
- Se quiere simplificar el tool calling
- Se requiere soporte nativo para mas providers

**Approach**: Reemplazar solo `src/llm/openrouter.ts` con Vercel AI SDK, manteniendo todo lo demas custom.

---

## Resumen de Dependencias Nuevas por Fase

| Fase | Dependencias | Tamanio |
|------|-------------|---------|
| 1 | pino, pino-roll, pino-pretty (dev) | ~200KB |
| 4 | @secretlint/node, preset-recommend | ~2MB |
| 7 | zod | ~300KB |

## Grafo de Dependencias

```
Fase 1 (Logging) ────── independiente
Fase 2 (Tool Format) ── independiente
Fase 3 (Factory) ────── depende de Fase 2
Fase 4 (Memory) ─────── independiente
Fase 5 (Soul) ──────── independiente
Fase 6 (Auto-Discovery) depende de Fase 3
Fase 7 (Zod Config) ─── independiente
Fase 8 (Vercel AI SDK)  futura
```

## Verificacion End-to-End (despues de cada fase)
1. `npm run typecheck` — Sin errores de tipos
2. `npm run dev` — Bot inicia sin errores
3. Test manual en Telegram — Bot responde como antes
4. Test especifico de la feature de la fase
