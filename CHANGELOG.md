# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

## [Unreleased]

## [1.20.0] - 2026-04-17

### Added
- **Validación estricta de configuración con Zod** (`src/config.ts`): el archivo completo se refactorizó para validar `process.env` con un schema Zod antes de exportar el objeto `config`. Fail-fast al startup con mensajes de error claros por variable (ej. `TELEGRAM_ALLOWED_USER_IDS: "abc" is not a valid integer`, `BRIEFING_TIME: must be HH:MM`) en lugar de crashes opacos en runtime.
  - Tipos validados: enteros (`^-?\d+$`), booleanos (`"true"|"false"`), listas CSV, listas de enteros, horas `HH:MM` con rangos válidos (`00:00`-`23:59`), enums (`LLM_PROVIDER`, `CLAUDE_CODE_DEFAULT_MODEL`).
  - **Regla cross-field**: `OPENROUTER_API_KEY` ahora solo es obligatorio cuando `LLM_PROVIDER=openrouter` (antes lo exigía siempre el wrapper manual `requireEnv`).
  - **Preserva comportamiento previo**: variables con valor vacío (`FOO=`) se tratan como no definidas para que los defaults apliquen; la forma del objeto `config` exportado es idéntica a la anterior (sin cambios en las 93 referencias `config.*` repartidas en 8 archivos).
- Dependencia nueva: `zod@^4.3.6`.

## [1.19.0] - 2026-04-17

### Fixed
- **Supervisor self-restart**: el supervisor ahora se reinicia a sí mismo cuando `src/supervisor.ts` o `src/exit-codes.ts` cambian en un auto-update o `/update`, evitando que corra código viejo indefinidamente.
- **`/restart` siempre reinicia el supervisor**: garantiza que el proceso supervisor corra el código más reciente del disco.
- **`restoreGeneratedLockfile` más robusto**: cambiado de `git restore` a `git checkout HEAD --` para ser explícito sobre el source y evitar edge cases con el index.

## [1.18.1] - 2026-04-17

### Changed
- Integración documental inicial de **Claude Code** en los flujos de revisión y desarrollo:
  - `skills/development-workflow.md`: ahora incluye `invoke_claude_code` como herramienta opcional para investigación profunda o implementación no trivial dentro del *worktree*, con reglas explícitas para verificar resultados antes de usarlos y para delegar siempre sobre el worktree activo.
  - `skills/proactive-review.md`: añade un paso opcional de *deep dive* con Claude Code para casos con contexto amplio, señales conflictivas o necesidad de exploración repo-wide, además de reglas para no tratar su salida como evidencia suficiente por sí sola.
  - `CLAUDE.md`: documenta la estrategia híbrida recomendada — primero herramientas nativas para reunir evidencia con `file:line`, luego Claude Code como segunda pasada para exploración, hipótesis alternativas o trabajo repetitivo.
  - **Availability guard** en ambos skills: dado que `invoke_claude_code` se registra solo si `CLAUDE_CODE_ENABLED=true` (opt-in), cada paso que menciona la tool ahora incluye una nota explícita para saltarlo silenciosamente cuando la tool no está en el registry de la sesión, evitando que el LLM intente llamar una tool inexistente y confunda al usuario con menciones irrelevantes.
- Bump de versión a `1.18.1` y sincronización de `package-lock.json` vía `npm install`.

## [1.18.0] - 2026-04-17

### Added
- **`invoke_claude_code` tool**: delega tareas de desarrollo al CLI local de Claude Code (`claude -p`). El agente pasa un `prompt` y un `working_directory` absoluto; Claude Code ejecuta autónomamente (edita archivos, corre comandos, hace commits) con `--dangerously-skip-permissions` dentro del directorio permitido.
  - **Fire-and-forget con resultado por Telegram**: la tool retorna inmediatamente al agente (`awaiting_result:true`) y el resultado final llega por Telegram via `approvalDeps.sendResult`, evitando bloquear el agent loop durante tareas largas.
  - **Validación estricta de path**: debe ser absoluto, existir, ser directorio, y estar contenido en `CLAUDE_CODE_ALLOWED_DIRS` (o dentro del `$HOME` si la lista está vacía). Rechaza paths con `..` o fuera de scope.
  - **Continuación de sesiones**: parámetro opcional `session_id` que se traduce a `--resume <id>` para mantener contexto entre invocaciones. El `session_id` viene incluido en el mensaje de resultado para que el LLM lo reuse.
  - **Output JSON parseado**: usa `--output-format json`; muestra `result`, `num_turns`, `total_cost_usd` y `session_id` formateados. Fallbacks para timeout, exit≠0 y parse error.
  - **Timeout configurable**: `CLAUDE_CODE_TIMEOUT_MINUTES` (default 30). Al expirar, envía `SIGTERM` y luego `SIGKILL` tras 5s.
  - **Opt-in**: `CLAUDE_CODE_ENABLED=false` por default. Variables `CLAUDE_CODE_ALLOWED_DIRS`, `CLAUDE_CODE_DEFAULT_MODEL` (opus|sonnet|haiku), `CLAUDE_CODE_TIMEOUT_MINUTES`, `CLAUDE_CODE_BINARY_PATH`.

## [1.17.0] - 2026-04-16

### Added
- **Unified personal knowledge search** (`search_personal_knowledge` tool): lets the user ask free-form questions like "busca Fausto", "qué tengo sobre Arely", "¿leche en mis listas?" and get a single aggregated response combining memories and list items.
  - Reuses `memoryManager.searchMemories` (FTS5 + LIKE fallback) for the memories side; runs a direct SQL query with `LIKE ... ESCAPE '\'` against `list_items` JOIN `lists` for the lists side.
  - Optional `list_hint` scopes the list search to a single list (case-insensitive exact name match). Omitted by default for global search.
  - Multi-term queries are ranked per-item by how many terms matched (case-insensitive substring).
  - Discarded list items are excluded from results.
  - Returns structured data plus a pre-rendered `formatted` field suitable for direct Telegram delivery (sections for Memorias and Listas with status glyphs; "no matches" message when empty).
  - Zero schema changes — no new tables or columns.

## [1.16.0] - 2026-04-16

### Added
- **Automatic worktree + branch cleanup after GitHub PR MERGED/CLOSED**: closes the worktree lifecycle loop that previously left orphan `.worktrees/<slug>` directories and unmerged `jarvis/*` local branches.
  - New scheduler task `github-pr-monitor` (`src/scheduler/github-pr-monitor.ts`) polls every `WORKFLOW_PR_POLL_INTERVAL_MINUTES` (default 10) for any `backlog_items` row with `status='pr_created' AND pr_number IS NOT NULL`. Uses `gh pr view --json state,mergedAt,closedAt` to detect transitions.
  - On **MERGED**: backlog status → `merged`, worktree removed via `git worktree remove`, local branch deleted with `git branch -D`, Telegram notification sent.
  - On **CLOSED** without merge: backlog status → `dismissed`, same cleanup and notification.
  - Uncommitted changes in the worktree are detected via `git status --porcelain` and the remove is skipped (backlog still transitions). Missing worktrees and already-deleted branches are tolerated.
  - Honors `WORKFLOW_AUTO_CLEANUP_WORKTREE`: when false, backlog status still transitions but the worktree is preserved.
  - Seeded automatically at startup when `WORKFLOW_ENABLED=true && CODEBASE_ENABLED=true`.
- **Auto-link backlog item ↔ GitHub PR**: `github_prs` tool's `create_pr` action now accepts an optional `backlog_item_id` parameter. When provided, the tool updates the backlog row's `pr_number`, `pr_url`, and `status='pr_created'` automatically so the monitor above can find the worktree later. Without this link the cleanup cannot happen.
- Config `WORKFLOW_PR_POLL_INTERVAL_MINUTES` and matching `config.workflow.prPollIntervalMinutes`.

## [1.15.1] - 2026-04-16

### Fixed
- **Eliminated unnecessary Telegram approval prompts** for scheduled tasks and common read-only inspection commands.
  - Expanded `SAFE_COMMANDS` in `src/security/command-classifier.ts` with genuinely read-only utilities that the agent frequently uses while self-inspecting files: hash/checksum (`shasum`, `sha256sum`, `sha1sum`, `md5`, `md5sum`, `cksum`), path utilities (`basename`, `dirname`, `realpath`, `readlink`), env/comparison/binary-read tools (`printenv`, `cmp`, `comm`, `od`, `hexdump`), and pure utilities (`seq`, `true`, `false`). `DANGEROUS_FLAGS` guardrails remain in place so edit-enabling flags still escalate to "risky". `tree`, `diff`, and `xxd` are deliberately NOT included because they can write files via `-o`/`--output`/`-r <out>` flags that `DANGEROUS_FLAGS` does not catch.
  - Wired up the previously-dead `scheduled_tasks.pre_approved` DB column end-to-end: the scheduler now propagates it via a new `AgentContext.preApproved` field, and `execute_command` bypasses the approval gate (but **not** blocked-command enforcement) when the context is pre-approved. Logs the bypass with command/userId/channelId for auditability.
  - Proactive code-review cron task is now seeded with `pre_approved` set to `CODE_REVIEW_AUTO_APPROVE` (default `true`). Existing code-review rows are bidirectionally synced to the current config value on every startup, so flipping `CODE_REVIEW_AUTO_APPROVE=false` re-enables the approval gate even for legacy tasks.

### Added
- Config option `CODE_REVIEW_AUTO_APPROVE` (default `true`) and matching `config.codeReview.autoApprove`.

## [1.15.0] - 2026-04-14

### Added
- **Proactive automated code review**: scheduled task that periodically analyzes the codebase and creates backlog items for findings
  - `manage_code_review_log`: tool for tracking review progress per file (upsert, get_file, list_reviewed, stats)
  - `src/scheduler/code-review.ts`: dynamic prompt builder with hybrid file selection algorithm — git-changed files (priority, uncapped) + unreviewed/oldest backlog files (configurable cap)
  - Git checkpoint mechanism that only advances after successful review runs with no deferred files, preventing loss of pending reviews on failures
  - Auto-fix flow: if high-confidence quick-wins are found and no Jarvis PR is open, automatically triggers development-workflow to create a fix PR
  - Telegram notification with detailed summary of findings by severity
  - Auto-seed: cron job created automatically at startup when `CODE_REVIEW_ENABLED=true`
  - DB migration v10: `code_review_log` table with per-file review state tracking
  - Config: `CODE_REVIEW_ENABLED`, `CODE_REVIEW_TIMES`, `CODE_REVIEW_MAX_BACKLOG_FILES`

### Fixed
- `github_prs` tool now uses configured `codebaseRoot` as working directory instead of `process.cwd()`, fixing PR operations when `CODEBASE_ROOT` differs from launch directory
- Added `.worktrees` to default `CODEBASE_IGNORE` to prevent scanning worktree copies as duplicate source files

## [1.14.0] - 2026-04-14

### Added
- **Worktree dev workflow with backlog and GitHub PRs**: complete pipeline for detecting, tracking, and fixing issues in isolated worktrees with human review
  - `manage_backlog`: tool for managing a prioritized backlog of codebase findings (bugs, refactors, improvements) with SQLite persistence, deduplication by source tool + finding ID, severity-based priority ordering, and lifecycle tracking (open -> in_progress -> pr_created -> merged/dismissed)
  - `git_worktree`: tool for creating, listing, removing, and checking status of isolated git worktrees with branch naming enforcement (`jarvis/fix-*`, `jarvis/refactor-*`, `jarvis/feat-*`) and path traversal protection
  - `github_prs`: tool wrapping `gh` CLI for listing, creating, and checking status of GitHub PRs, with automatic availability/auth verification and local mode fallback when `gh` is not available
  - `skills/development-workflow.md`: orchestration skill with 10-phase workflow (verify gh, gate check, reconcile, select, confirm, prepare, implement, validate, deliver, report), enforcing one-PR-at-a-time constraint and human-only merging
  - DB migration v9: `backlog_items` table with category, severity, confidence, status lifecycle, PR tracking, and source traceability
  - Config section `workflow` with configurable default branch, worktree directory, branch prefix, and validation commands
- **Backlog integration in analysis skills**: `bug-triage.md`, `refactor-analysis.md`, and `codebase-improvement.md` now offer to save confirmed findings to the backlog for later execution

## [1.13.0] - 2026-04-14

### Added
- **Evidence-based bug detection and triage**: programmatic tool + skill for detecting potential bugs with verifiable evidence and structured triage
  - `detect_bugs`: tool with 8 code pattern detectors (empty catches, null dereference risks, unhandled async/promises, type coercion, race conditions, unreachable code, off-by-one indicators, resource leaks), git diff regression analysis (new empty catches, removed null checks, removed error handling), and application log analysis (pino JSON format)
  - Parameterized scope: explicit `path` (file or directory) or auto-detect from git-changed files; `focus` filter (all/patterns/git/logs); configurable `git_depth`
  - Heuristic severity classification based on file domain context (auth/payment/persistence get severity bump, test files get lowered)
  - Progressive output truncation to respect token budget
  - `skills/bug-triage.md`: skill with 7-phase workflow (scan, deep read, cross-reference, enrich, filter, prioritize, present), structured per-finding format with root cause hypothesis and reproduction steps, anti-hallucination rules, and uncertainty declaration

## [1.12.0] - 2026-04-14

### Added
- **Refactor opportunity identification**: programmatic pre-screening tool + skill for detecting and prioritizing refactoring opportunities with technical justification
  - `find_refactor_candidates`: tool with 7 analyzers (long functions, god objects, code duplication, coupling, conditional complexity, dead exports, error handling patterns, hardcoded values)
  - 3 analysis modes: `file` (single file), `module` (directory), `flow` (entry file + transitive imports)
  - Progressive output truncation to respect token budget
  - `skills/refactor-analysis.md`: skill with 6-phase workflow, anti-hallucination rules, priority classification (quick_win/important_careful/later), and counter-indication awareness
- **Shared codebase module**: extracted `FileInfo`, `collectFiles`, `fmtBytes` from `analyze-codebase.ts` into `codebase-shared.ts` for reuse across codebase tools
- Model router: refactoring-related keywords (`smell`, `dead code`, `duplica`, `acoplamiento`, `coupling`) now route to complex model tier

## [1.11.0] - 2026-04-14

### Added
- **Codebase improvement analysis**: programmatic analyzer + skill for diagnosing and proposing improvements
  - `analyze_codebase`: tool that scans structure, complexity, dependencies, quality signals, and config patterns in one call
  - 5 analyzers: structure (file distribution, sizes), complexity (long functions, deep nesting), dependencies (import graph, hubs, circulars), quality (TODOs, commented code, any types, console.logs), config (env vars, scattered defaults, hardcoded URLs)
  - Progressive output truncation to respect token budget
  - `skills/codebase-improvement.md`: skill that guides prioritized improvement proposals with evidence, categorization, and anti-hallucination rules

## [1.10.0] - 2026-04-14

### Added
- **Codebase analysis tools**: 4 new read-only tools for code understanding
  - `read_file`: read source files with line numbers and optional line ranges
  - `list_directory`: explore directory structure as indented tree with file sizes
  - `search_code`: regex/text search across files with context lines (grep-like)
  - `codebase_map`: persist/query structured codebase knowledge (semantic index with FTS5)
- `src/security/path-validator.ts`: shared path validation with jail check, ignore patterns, and sensitive file blocking
- `skills/code-analysis.md`: skill that guides the agent's code analysis strategy (evidence-based, structured output)
- Config: `CODEBASE_ENABLED`, `CODEBASE_ROOT`, `CODEBASE_MAX_FILE_SIZE`, `CODEBASE_MAX_OUTPUT`, `CODEBASE_IGNORE`
- SQLite migration v8: `codebase_index` table + `codebase_fts` virtual table with sync triggers
- Model router: codebase-related keywords now route to complex model tier

## [1.9.0] - 2026-04-14

### Added
- **Voice message transcription** via Groq Whisper (`whisper-large-v3-turbo`)
- `src/transcription/transcriber.ts`: Transcriber interface + GroqTranscriber implementation
- `skills/voice-messages.md`: skill para manejo inteligente de mensajes de voz transcritos
- Config: `GROQ_API_KEY` (opcional), `TRANSCRIPTION_LANGUAGE` (default: "es")
- Graceful degradation: handler de voz solo activo cuando `GROQ_API_KEY` está configurada

## [1.8.0] - 2026-04-14

### Added
- **manage_lists tool** (`src/tools/built-in/manage-lists.ts`): gestión de listas personales (compras, libros, ideas, tareas) con 8 acciones: get_lists, create_list, view_list, add_item, remove_item, toggle_item, discard_item, delete_list
- Items con 3 estados: pending, completed, discarded — discard marca sin eliminar, toggle restaura
- Detección de duplicados: add_item busca items exactos existentes antes de agregar, y avisa si hay similares
- Búsqueda fuzzy segura: cuando hay múltiples matches parciales, retorna candidatos en lugar de actuar sobre el primero
- Auto-creación de listas: add_item crea la lista automáticamente si no existe
- Instrucciones de formato visual en soul.md: iconos ⬚/✅/❌ para pending/completed/discarded
- SQLite migrations v6 (tablas lists + list_items) y v7 (completed INTEGER → status TEXT)

## [1.7.0] - 2026-04-13

### Changed
- **Soul System v2**: `loadSoul()` ahora retorna `SoulContent { soul, agentRules? }` en lugar de un string plano
- `AGENTS.md` se carga en `soul.ts` (antes se cargaba a nivel de módulo en `context-builder.ts`)
- `buildSystemPrompt()`, `runAgent()` y `SchedulerDeps` actualizados para recibir `SoulContent`
- Eliminado el singleton de módulo `agentRules` en `context-builder.ts` — responsabilidad centralizada en `soul.ts`

## [1.6.0] - 2026-04-13

### Added
- **Memory sanitizer** (`src/memory/memory-sanitizer.ts`): detección de secrets (API keys, tokens, passwords) via `@secretlint/node` con singleton lazy. Gate en `save_memory` rechaza memorias con data sensible
- **delete_memory tool** (`src/tools/built-in/delete-memory.ts`): borrado de memorias por ID numérico con validación
- **list_memories tool** (`src/tools/built-in/list-memories.ts`): listado completo de memorias con filtro opcional por categoría
- **audit_memories tool** (`src/tools/built-in/audit-memories.ts`): escaneo de todas las memorias buscando secrets, reporta IDs flaggeados sin exponer contenido sensible
- **Memory backfill** (`src/memory/memory-backfill.ts`): migración one-time al startup que escanea memorias y memory_history existentes, borra registros con data sensible, tracked via `agent_metadata` table
- **Daily memory consolidation** (`src/scheduler/consolidation.ts`): tarea programada a las 23:00 que usa el LLM para extraer hechos nuevos de conversaciones del día, mergear memorias duplicadas, actualizar info obsoleta y limpiar memorias de bajo valor
- Nuevos métodos en `MemoryManager`: `getAllMemories(userId)`, `getTodaySessionMessages(userId)`
- Nuevo task type `consolidation` en el scheduler con prompt dinámico
- Config: `CONSOLIDATION_ENABLED` (default: true), `CONSOLIDATION_TIME` (default: "23:00")

### Changed
- `save_memory` ahora valida contenido contra secrets antes de guardar
- Dependencias agregadas: `@secretlint/node`, `@secretlint/secretlint-rule-preset-recommend`

## [1.5.0] - 2026-04-13

### Added
- **OpenAI Codex OAuth Provider**: nuevo LLM provider que usa la suscripción de ChatGPT (Plus/Pro) via OAuth PKCE, sin costo por token
- `src/llm/codex-provider.ts`: implementación de `LLMProvider` con SSE streaming, retry con backoff, refresh serializado de tokens, y detección de límites de uso
- `src/llm/codex-oauth.ts`: flujo OAuth PKCE completo (generación, exchange, refresh, JWT decode)
- `src/llm/codex-auth-cli.ts`: CLI standalone para autenticación (`npm run auth:codex`)
- `src/llm/codex-message-adapter.ts`: traducción bidireccional Chat Completions ↔ Responses API
- `src/llm/codex-token-store.ts`: persistencia atómica de tokens con permisos `0o600`
- Variable `LLM_PROVIDER` para seleccionar provider (`openrouter` | `codex`) con validación
- Modelos default: `gpt-5.4-mini` (simple), `gpt-5.4` (moderate/complex)

### Changed
- `src/config.ts`: `OPENROUTER_API_KEY` solo requerido cuando `LLM_PROVIDER=openrouter`
- `src/index.ts`: instanciación condicional del provider según configuración

## [1.4.0] - 2026-04-13

### Changed
- **Tool Factory Pattern**: migración completa de 14 built-in tools de singletons estáticos a factory functions (`createXTool(deps)`)
- Eliminados 6 setter functions de dependency injection (`setMemoryManager` x2, `setApprovalGate`, `setSendApproval`, `setSendResult`, + 3 equivalentes en manifest-loader)
- Eliminado todo estado mutable a nivel de módulo en `src/tools/` — dependencias capturadas via closures
- `src/index.ts` reordenado: TelegramChannel y ApprovalGate se crean antes del registro de tools
- `loadToolManifest()` recibe `ApprovalDeps` como parámetro en vez de usar setters globales
- `propose-tool` actualizado para generar templates con el nuevo factory pattern
- `gws-drive` recibe `driveFolderIds` como parámetro en vez de leer `config` directamente
- `web-search` y `web-scrape` reciben `apiKey` como parámetro, lazy client en closure

### Added
- `src/tools/built-in/approval-deps.ts`: interface `ApprovalDeps` compartida entre `execute-command` y `manifest-loader`

## [1.3.0] - 2026-04-09

### Added
- **Retry con exponential backoff** (`src/llm/openrouter.ts`): reintentos automáticos en errores 429/5xx y fallos de red (timeout, DNS, socket reset). Max 3 retries con backoff (1s, 2s, 4s) + jitter. Respeta header `retry-after` en 429s
- **Fetch timeout**: `AbortSignal.timeout(60s)` previene llamadas LLM colgadas indefinidamente
- **Token usage logging** (`src/agent/agent.ts`): log estructurado de tokens por iteración y totales acumulados al completar respuesta

### Changed
- `LLMChatResult` (`src/llm/llm-provider.ts`) extiende con tipo `TokenUsage` y campo `usage?`
- OpenRouter provider extrae y retorna `usage` de la respuesta de la API

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
