# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

## [Unreleased]

## [1.2.0] - 2026-04-09

### Added
- **Structured logging con pino**: reemplazo completo de `console.log/error` por logging estructurado en 18 archivos
- **Logger factory** (`src/logger.ts`): `createLogger(component)` genera child loggers con contexto por componente
- **Transports**: pino-roll (rotación diaria, 7 días retención), pino-pretty (dev con colores), JSON stdout (prod)
- **Fatal log flush** (`src/index.ts`): `fatalExit()` garantiza flush del transport asíncrono antes de `process.exit(1)` con safety timeout de 2s

### Changed
- `pino-pretty` movido de `devDependencies` a `dependencies` para evitar crash en deploys sin `NODE_ENV=production`
- Supervisor (`src/supervisor.ts`) migrado a pino con child loggers separados por componente (supervisor, watchdog, autoupdate, telegram)
- Dependencias agregadas: `pino@^10.3.1`, `pino-roll@^4.0.0`, `pino-pretty@^13.1.3`

## [1.1.0] - 2026-03-19

### Added
- **Tool manifest** (`src/tools/manifest-loader.ts`): configuración declarativa JSON (`tool_manifest.json`) para activar/desactivar tools y MCP servers, con sustitución de `${VAR}` en campos env/headers
- **MCP config loader** (`src/tools/mcp-config-loader.ts`): parsea `mcp_config.json` con validación de entradas y soporte para transporte stdio y StreamableHTTP
- **MCP client** (`src/mcp/mcp-client.ts`): wrapper del SDK `@modelcontextprotocol/sdk` con soporte dual stdio/HTTP, detección de crash via transport callbacks, y lifecycle management
- **MCP tool adapter** (`src/mcp/mcp-tool-adapter.ts`): convierte tools de MCP servers a objetos `Tool` del registry con prefijo `serverName__toolName` para evitar colisiones, guard de servidor muerto (`isAlive`), y normalización de resultados
- **McpManager** (`src/mcp/mcp-manager.ts`): orquestador que conecta múltiples MCP servers en paralelo via `Promise.allSettled` con timeout de 10s por servidor
- **SEC-01 — Truncamiento de descripciones**: descripciones de tools MCP se truncan a 500 caracteres para limitar superficie de tool poisoning
- **SEC-02 — Trust framing**: sección "External Tools Notice" en el system prompt cuando hay tools MCP activos, indicando al LLM que trate descripciones y resultados como no confiables
- **SEC-05 — Tool count logging**: log de conteo por fuente al startup (`X built-in, Y manifest, Z MCP = N total`) con warning si el total excede 30
- Archivos de ejemplo (`tool_manifest.json.example`, `mcp_config.json.example`) documentan el schema de configuración

### Changed
- `src/index.ts`: loop inline de conexión MCP reemplazado por `McpManager.connectAll()` — más limpio y con startup paralelo
- `src/agent/context-builder.ts`: `buildSystemPrompt` acepta parámetro `hasMcpTools` para inyección condicional del trust warning
- `src/agent/agent.ts`: propaga `hasMcpTools` desde `AgentContext` al context builder
- `src/types.ts`: `AgentContext` extiende con campo opcional `hasMcpTools`
- Dependencia agregada: `@modelcontextprotocol/sdk@^1.27.1`

## [1.0.0] - 2026-03-19

### Added
- **Web search** (`src/tools/built-in/web-search.ts`): búsqueda en internet via Tavily API con resultados resumidos
- **Web scraping** (`src/tools/built-in/web-scrape.ts`): extracción de contenido de URLs via Firecrawl API, incluyendo páginas renderizadas con JS
- **Frontera de confianza para contenido web**: todo contenido web se envuelve en delimitadores `[WEB CONTENT - UNTRUSTED]` para prevenir prompt injection
- **Shell execution** (`src/tools/built-in/execute-command.ts`): ejecución de comandos shell y scripts (.sh, .py, .ts) via `execFile` con `shell:false`
- **Clasificador de comandos** (`src/security/command-classifier.ts`): tres niveles de seguridad (blocked/risky/safe) con fail-closed por defecto
- **Approval gate** (`src/security/approval-gate.ts`): aprobación humana via Telegram inline keyboard para comandos riesgosos, persistente en SQLite
- **Scheduler** (`src/scheduler/scheduler-manager.ts`): motor de tareas programadas basado en croner con persistencia SQLite
- **Scheduler tools** (`src/scheduler/scheduler-tools.ts`): 4 herramientas del agente para crear, listar, gestionar y eliminar tareas programadas
- **Morning briefing**: resumen matutino automático combinando Calendar, Gmail, PRs y búsqueda web
- **PR monitor** (`src/scheduler/pr-monitor.ts`): monitoreo periódico de PRs en Bitbucket con notificaciones de cambios via Telegram
- **Heartbeat watchdog**: supervisor detecta bot colgado (no solo crasheado) via IPC heartbeat cada 10s con timeout de 30s
- **Git auto-update**: supervisor hace polling cada 5 minutos y aplica actualizaciones automáticamente (incluyendo `npm install` si `package.json` cambió)
- **Supervisor logging**: todos los eventos del ciclo de vida se escriben en `data/supervisor.log` con timestamp, nivel y categoría
- **Telegram notifications en supervisor**: notificaciones directas via Telegram API para hang detection, crashes y auto-updates
- **Graceful shutdown mejorado**: espera hasta 15 segundos para operaciones in-flight antes de cerrar, con tracking de agentes activos via contador

### Changed
- Supervisor reescrito completamente (`src/supervisor.ts`): de 60 líneas a 296 líneas con logging, watchdog, auto-update y notificaciones
- `src/index.ts` extendido con heartbeat IPC, in-flight tracking, y secuencia de shutdown ordenada
- Timeout de shutdown aumentado de 3s a 15s para acomodar llamadas LLM en progreso
- Migración SQLite v4 (pending_approvals) y v5 (scheduled_tasks, task_runs)

## [0.3.0] - 2026-03-15

### Added
- **Supervisor process** (`src/supervisor.ts`): proceso padre que lanza y supervisa a Jarvis, con reinicio automático ante fallos
- **Señal de reinicio** (`src/restart-signal.ts`): mecanismo para que el agente indique al supervisor que debe reiniciarse
- **Herramienta `restart-server`** (`src/tools/built-in/restart-server.ts`): permite a Jarvis reiniciarse a sí mismo vía Telegram
- **Códigos de salida** (`src/exit-codes.ts`): constantes para distinguir reinicio intencional de fallo
- Comando `/restart` en Telegram con confirmación antes de ejecutar
- Scripts npm actualizados: `start` arranca el supervisor, `start:direct` arranca Jarvis sin supervisor

## [0.2.0] - 2026-03-14

### Added
- **Typing indicator persistente**: el indicador de escritura de Telegram se renueva cada 4 segundos mientras el agente está procesando, evitando que desaparezca en respuestas largas

## [0.1.0] - 2026-03-13

### Added
- **Sistema de migración de base de datos** (`src/memory/db.ts`): tabla `schema_migrations` para aplicar migraciones SQL de forma incremental y segura
- **Upsert atómico de memorias**: las memorias se crean o actualizan sin duplicados usando `INSERT OR REPLACE`
- **Full-text search con FTS5**: tabla virtual `memories_fts` para búsqueda semántica eficiente en memorias
- **Historial de cambios de memorias**: tabla `memory_history` que registra cada modificación con timestamp
- **Limpieza automática de sesiones**: al iniciar, se eliminan sesiones vacías o incompletas del arranque anterior
- **Contexto de memorias mejorado**: las memorias se agrupan por categoría en el prompt del sistema, con más resultados recuperados
- **Pistas de consolidación en `save-memory`**: al guardar una memoria, el agente recibe sugerencias sobre memorias existentes relacionadas para evitar fragmentación
- **Fallback a búsqueda LIKE**: si FTS5 no devuelve resultados, se cae automáticamente a búsqueda por LIKE
- **Herramienta `bitbucket-prs`**: revisión de pull requests de Bitbucket Cloud con soporte para listar PRs, ver diff, comentarios y actividad (`src/tools/built-in/bitbucket-prs.ts`, `src/tools/bitbucket-api.ts`)

## [0.0.2] - 2026-03-08

### Added
- **Google Workspace tools**: integración completa con las APIs de Google vía OAuth2
  - `gws-gmail`: lectura y envío de correos
  - `gws-calendar`: consulta y creación de eventos
  - `gws-drive`: búsqueda y descarga de archivos
  - `gws-sheets`: lectura y escritura en hojas de cálculo
- **Ejecutor GWS** (`src/tools/gws-executor.ts`): capa centralizada para autenticación y llamadas a Google APIs
- **Subida de fotos a Telegram** (`src/channels/telegram.ts`): el agente puede enviar imágenes además de texto
- **Herramienta `propose-tool`** (`src/tools/built-in/propose-tool.ts`): Jarvis puede proponer nuevas herramientas describiendo su propósito y parámetros
- **Herramienta `table-image`** (`src/tools/built-in/table-image.ts`): genera imágenes PNG de tablas con coloreado condicional (útil para pagos y estados)
- Variables de entorno para Google OAuth (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`)

## [0.0.1] - 2026-03-08

### Added
- Implementación inicial de Jarvis: agente de IA personal con interfaz Telegram
- **Agent loop** (`src/agent/agent.ts`): ciclo LLM ↔ herramientas con límite de iteraciones configurable
- **Context builder** (`src/agent/context-builder.ts`): construye el prompt del sistema a partir de `soul.md` y memorias relevantes
- **LLM vía OpenRouter** (`src/llm/openrouter.ts`): implementación OpenAI-compatible con soporte para tool calling
- **Model router** (`src/llm/model-router.ts`): selección de modelo según tipo de tarea
- **Canal Telegram** (`src/channels/telegram.ts`): integración con Grammy en modo long polling, whitelist de usuarios
- **Sistema de memoria SQLite** (`src/memory/memory-manager.ts`, `src/memory/db.ts`): almacenamiento persistente de memorias y sesiones con timeout de 30 minutos
- **Herramientas integradas**: `get-current-time`, `save-memory`, `search-memories`
- **Personalidad configurable** vía `soul.md`
- **Seguridad**: whitelist de Telegram user IDs, todos los secretos en `.env`, ejecución de herramientas en try/catch
- Soporte TypeScript con ES modules, hot reload vía `tsx`
