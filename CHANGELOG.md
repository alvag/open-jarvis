# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

## [Unreleased]

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
