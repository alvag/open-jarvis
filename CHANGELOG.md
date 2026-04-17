# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

## [Unreleased]

## [1.18.1] - 2026-04-17

### Changed
- Integración documental inicial de **Claude Code** en los flujos de revisión y desarrollo:
  - `skills/development-workflow.md`: ahora incluye `invoke_claude_code` como herramienta opcional para investigación profunda o implementación no trivial dentro del *worktree*, con reglas explícitas para verificar resultados antes de usarlos y para delegar siempre sobre el worktree activo.
  - `skills/proactive-review.md`: añade un paso opcional de *deep dive* con Claude Code para casos con contexto amplio, señales conflictivas o necesidad de exploración repo-wide, además de reglas para no tratar su salida como evidencia suficiente por sí sola.
  - `CLAUDE.md`: documenta la estrategia híbrida recomendada — primero herramientas nativas para reunir evidencia con `file:line`, luego Claude Code como segunda pasada para exploración, hipótesis alternativas o trabajo repetitivo.
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
  - Reuses `memoryManager.searchMemories` (FTS5 + LIKE fallback) for the memories side; runs a direct SQL query with `LIKE ... ESCAPE '\\'` against `list_items` JOIN `lists` for the lists side.
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
