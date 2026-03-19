# Phase 3: Scheduled Tasks - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Jarvis opera proactivamente — ejecutando tareas recurrentes (cron), recordatorios one-shot y recurrentes, briefings matutinos automáticos (Calendar + Gmail + PRs + noticias), y monitoreo periódico de PRs de Bitbucket. Todo persiste en SQLite y sobrevive reinicios del bot. Las tareas se ejecutan a través del agent loop (LLM razona + usa tools) excepto los recordatorios simples que envían texto directo.

</domain>

<decisions>
## Implementation Decisions

### Motor de scheduling
- Cron in-process usando librería Node.js (node-cron o croner) dentro del proceso del bot
- Tareas almacenadas en SQLite, timers de cron configurados al startup
- Ejecución via agent loop: cada tarea envía un prompt al agente como si fuera un mensaje de usuario — el LLM decide qué tools usar
- Ejecución secuencial: tareas se ejecutan una a la vez en orden, si coinciden se encolan
- Creación por lenguaje natural: el usuario dice "recordame X todos los lunes" y el LLM extrae la expresión cron + prompt. Tool `create_scheduled_task` interno
- Gestión completa via tools del agente: listar, eliminar, pausar tareas. Usuario dice "muestra mis tareas" o "cancela el recordatorio de X"
- Confirmación antes de eliminar: Jarvis pide confirmación antes de borrar una tarea

### Manejo de errores
- Notificar + reintentar: envía notificación al usuario por Telegram con el error, reintenta 1 vez tras 5 min
- Si falla de nuevo, espera la próxima ejecución programada
- Tareas que fallan nunca fallan silenciosamente — siempre notifican

### Seguridad de tareas con shell
- Aprobación al crear: el usuario aprueba la tarea al crearla
- Las ejecuciones futuras de esa tarea no piden aprobación nuevamente — ya fue autorizada
- El campo de pre-aprobación se persiste en SQLite junto con la tarea

### Morning briefing
- Hora fija configurable: por defecto 7:00 AM, configurable via comando al agente ("cambia mi briefing a las 8")
- 4 secciones obligatorias: Eventos del día (Calendar), Emails no leídos (Gmail), PRs abiertos (Bitbucket), Noticias relevantes (Web)
- Un solo mensaje estructurado con emojis como headers de sección (📅 Agenda, 📧 Emails, 🔀 PRs, 📰 Noticias), ~300 palabras máx
- Temas de noticias configurables por el usuario: "mis temas son AI, startups, crypto" — se guardan como memoria y se pueden cambiar en cualquier momento
- Implementado como tarea programada built-in que viene pre-configurada con Jarvis

### Recordatorios
- Mensaje simple de notificación: "🔔 Recordatorio: [texto]" enviado directo por Telegram
- Soporta one-shot ("recordame en 2 horas") y recurrentes ("recordame todos los lunes a las 9")
- Mismo modelo interno que tareas programadas: un recordatorio es una tarea cuyo tipo es "reminder" y cuya acción es enviar texto directo (sin agent loop)
- Una sola tabla SQLite, un solo scheduler — el tipo (reminder/task) es solo un campo

### Monitoreo de PRs
- Frecuencia: cada 15 minutos
- Actividad que genera notificación: nuevos commits pusheados, mención directa, cambio de estado (approved/merged/declined). NO comentarios generales
- Alcance: PRs donde el usuario es autor o reviewer del repo configurado en Bitbucket
- Notificación: resumen breve con link — "🔀 PR #42 'Fix auth bug': 2 nuevos commits por Juan + estado cambió a Approved"
- Implementado como tarea programada built-in usando el mismo scheduler
- Necesita tabla o mecanismo para trackear el "último estado conocido" de cada PR y detectar cambios

### Claude's Discretion
- Elección de librería cron específica (node-cron vs croner vs otra)
- Esquema exacto de la tabla SQLite para tareas programadas
- Cómo el LLM parsea lenguaje natural a expresiones cron
- Estrategia de resumen para el briefing (qué emails son "importantes", cuántos eventos mostrar)
- Formato exacto de las notificaciones de PR
- Cómo detectar menciones directas del usuario en comentarios de PR

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — Requirements SCHED-01, SCHED-02, SCHED-03, SCHED-04

### Tool pattern
- `src/tools/tool-types.ts` — Tool interface (ToolDefinition, ToolContext, ToolResult)
- `src/tools/tool-registry.ts` — Registry pattern for registration and execution
- `src/tools/built-in/get-current-time.ts` — Simple tool reference implementation

### Existing tools que el briefing/scheduler usará
- `src/tools/built-in/gws-calendar.ts` — Google Calendar tool (briefing: eventos del día)
- `src/tools/built-in/gws-gmail.ts` — Google Gmail tool (briefing: emails no leídos)
- `src/tools/built-in/bitbucket-prs.ts` — Bitbucket PRs tool (briefing: PRs abiertos + monitoreo)
- `src/tools/built-in/web-search.ts` — Web search via Tavily (briefing: noticias)

### Database pattern
- `src/memory/db.ts` — SQLite schema init and migrations (actualmente en v4)
- `src/memory/memory-manager.ts` — Query builders and memory API

### Agent loop
- `src/agent/agent.ts` — Agent loop que las tareas programadas invocarán
- `src/agent/context-builder.ts` — System prompt builder

### Telegram (proactive messaging)
- `src/channels/telegram.ts` — `sendMessage()` y `broadcast()` para enviar mensajes proactivos
- `src/channels/channel.ts` — Channel interface

### Wiring
- `src/index.ts` — Tool registration, startup sequence, graceful shutdown
- `src/config.ts` — Environment variable loading
- `soul.md` — Personality and rules (agregar reglas sobre tareas programadas)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TelegramChannel.sendMessage(userId, text)`: Envía mensajes proactivos a un usuario — usado para recordatorios y notificaciones
- `TelegramChannel.broadcast(text)`: Envía a todos los usuarios permitidos — usado para briefing matutino
- `runAgent()`: Agent loop completo que las tareas programadas invocarán con un prompt sintético
- `ToolRegistry`: Todas las tools existentes (Calendar, Gmail, Bitbucket, Web) disponibles para el agent loop
- `db.ts` migration system: Patrón para agregar nueva tabla de scheduled_tasks (migration v5)
- `MemoryManager.saveMemory/searchMemories`: Para persistir temas de noticias del usuario

### Established Patterns
- Conditional tool registration: `if (config.X.enabled) { toolRegistry.register(tool) }` en index.ts
- Tool result format: `{ success: boolean, data: unknown, error?: string }`
- Module-level setter pattern: `setMemoryManager()`, `setApprovalGate()` — para inyectar dependencias
- SQLite migrations versionadas en `runMigrations()` de db.ts
- Graceful shutdown con SIGTERM handler — scheduler debe limpiarse al shutdown

### Integration Points
- `src/index.ts`: Inicializar scheduler después de registrar tools, antes de telegram.start()
- `src/memory/db.ts`: Nueva tabla `scheduled_tasks` (migration v5)
- `src/config.ts`: Env vars para hora de briefing, intervalo de PR polling
- `soul.md`: Reglas sobre cómo manejar tareas programadas y briefings
- Nuevo directorio `src/scheduler/` o archivo `src/scheduler.ts` para el motor de scheduling

</code_context>

<specifics>
## Specific Ideas

- Recordatorios y tareas programadas son el mismo concepto interno — una sola tabla con campo `type` (reminder/task/briefing/pr-monitor)
- El morning briefing y PR monitor son tareas built-in que se crean automáticamente al primer arranque si no existen
- El briefing debe sentirse como un resumen ejecutivo conciso, no un dump de datos
- Las noticias usan temas almacenados como memorias del usuario, no hardcoded

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-scheduled-tasks*
*Context gathered: 2026-03-18*
