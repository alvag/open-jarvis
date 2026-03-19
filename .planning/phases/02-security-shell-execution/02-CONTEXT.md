# Phase 2: Security + Shell Execution - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Jarvis puede ejecutar shell commands y scripts locales en macOS del usuario con controles de seguridad defense-in-depth: blacklist de comandos letales + heurísticas de clasificación risky/safe + aprobación humana vía Telegram inline keyboard. El estado de aprobación persiste en SQLite y sobrevive reinicios del bot. Incluye graceful shutdown (SIGTERM) como precondición para que las aprobaciones sobrevivan reinicios.

</domain>

<decisions>
## Implementation Decisions

### Clasificación de comandos
- Blacklist mínima: solo comandos letales (rm -rf /, mkfs, dd if=/dev/zero, curl|sh, sudo su, chmod -R 777 /)
- Comandos blacklisted se bloquean automáticamente — Jarvis explica por qué sin ejecutar
- Clasificación risky/safe por heurísticas fijas codificadas:
  - **Safe**: lectura pura (ls, cat, git status, grep, pwd, echo, head, tail, wc, find, which, env, date)
  - **Risky**: todo lo que escribe/borra archivos, instala paquetes, modifica configs del sistema, operaciones de red con escritura
- Blacklist y heurísticas hardcoded en código — sin archivos de configuración externos
- Pipes, &&, ; NO permitidos — solo comandos simples. Si el agente necesita encadenar, hace múltiples llamadas al tool

### Flujo de aprobación (Approval UX)
- Mensaje de aprobación muestra: comando exacto + razón de riesgo + directorio de trabajo + contexto de la tarea del agente
- Botones inline de Telegram: Aprobar / Denegar
- Timeout de 5 minutos — si no hay respuesta, se deniega automáticamente y Jarvis informa que expiró
- Al denegar: Jarvis recibe "comando denegado por usuario" como resultado del tool y continúa razonando (puede ofrecer alternativas)
- Al reiniciar bot: aprobaciones pendientes en SQLite se re-envían al usuario con nuevos botones inline

### Manejo de output
- Output largo se trunca (límite ~4KB) y se pasa al LLM para que resuma lo relevante
- Timeout de ejecución: 30 segundos — si no termina, se mata el proceso y se reporta timeout
- stdout y stderr combinados en un solo resultado para el LLM, exit code como metadata
- Output presentado en bloque de código monoespaciado (```) en Telegram

### Ejecución de scripts
- Un solo tool `execute_command` que acepta comandos directos o rutas a scripts
- Puede ejecutar scripts desde cualquier ruta absoluta — las reglas de seguridad aplican igual
- Scripts siempre clasificados como "risky" — requieren aprobación del usuario
- No se valida el contenido del script antes de ejecutar — la aprobación del usuario es la validación
- Working directory por defecto: ~/ (home del usuario). El agente puede especificar otro cwd como parámetro
- Tipos de script soportados: .sh, .py, .ts

### Claude's Discretion
- Nombres exactos de comandos en la blacklist (más allá de los mencionados)
- Heurísticas específicas para clasificar comandos como risky vs safe
- Estrategia de resumen cuando el output excede el límite
- Esquema exacto de la tabla SQLite para aprobaciones pendientes
- Implementación del graceful shutdown (SIGTERM handler)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Security model
- `.planning/REQUIREMENTS.md` — Requirements SEC-01, SEC-02, SEC-03, EXEC-01, EXEC-02
- `.planning/ROADMAP.md` — Phase 2 success criteria and dependency on Phase 1
- `.planning/research/PITFALLS.md` — Approval state must be SQLite-persisted (not in-memory Map)
- `.planning/research/ARCHITECTURE.md` — Pattern 2: approval gate restart-survival (highest-risk detail)

### Tool pattern
- `src/tools/tool-types.ts` — Tool interface (ToolDefinition, ToolContext, ToolResult)
- `src/tools/tool-registry.ts` — Registry pattern for registration and execution
- `src/tools/built-in/get-current-time.ts` — Simple tool reference implementation

### Database pattern
- `src/memory/db.ts` — SQLite schema init and migrations pattern
- `src/memory/memory-manager.ts` — Query builders and API methods

### Telegram interaction
- `src/channels/telegram.ts` — Grammy bot, inline keyboard support, message handling

### Configuration and wiring
- `src/config.ts` — Environment variable loading pattern
- `src/index.ts` — Tool registration, conditional enabling, startup sequence
- `src/exit-codes.ts` — Exit codes for supervisor communication
- `src/restart-signal.ts` — IPC for tools to request restart/update

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Tool` interface (`src/tools/tool-types.ts`): Standard interface — definition + execute
- `ToolRegistry` (`src/tools/tool-registry.ts`): Register and execute pattern with error handling
- `db.ts` migration system: Versioned migrations for adding new SQLite tables
- `exit-codes.ts` + `restart-signal.ts`: Exit code pattern for supervisor communication (SIGTERM support)
- Grammy inline keyboard: `grammy` ya soporta inline keyboards para botones de aprobación

### Established Patterns
- Conditional tool registration: `if (config.X.enabled) { toolRegistry.register(tool) }` en index.ts
- Tool result format: `{ success: boolean, data: unknown, error?: string }`
- Error handling: try-catch en tool execution, retorna ToolResult con success: false
- Logging: `log(level, category, message, data?)` para todas las operaciones

### Integration Points
- `src/index.ts`: Registrar nuevo tool execute_command
- `src/memory/db.ts`: Nueva tabla para aprobaciones pendientes (migration)
- `src/channels/telegram.ts`: Handler para callback queries de botones inline
- `src/index.ts`: SIGTERM handler para graceful shutdown
- `soul.md`: Reglas sobre cuándo usar execute_command y cómo manejar denegaciones

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing tool and database patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-security-shell-execution*
*Context gathered: 2026-03-18*
