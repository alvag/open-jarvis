# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-19
**Phases:** 4 | **Plans:** 11 | **Timeline:** 10 days

### What Was Built
- Web search (Tavily) and URL scraping (Firecrawl) with prompt injection protection
- Shell execution with three-layer security (classifier + approval gate + SQLite persistence)
- Croner-based scheduler with morning briefings, PR monitoring, and one-shot reminders
- Supervisor rewrite: lifecycle logging, IPC heartbeat watchdog, git auto-update, Telegram notifications
- Graceful shutdown with in-flight agent tracking (15s timeout)

### What Worked
- Wave-based parallel execution kept phases moving efficiently
- Detailed PLAN.md with interfaces sections gave executors full context without reading extra files
- Human verification checkpoints (Phases 2, 3, 4) caught real integration issues that typechecks miss
- Security-first ordering (Phase 2 before Phase 3) meant the scheduler inherited proven tool execution patterns
- IPC heartbeat design (not HTTP) was simple and reliable — zero false positives

### What Was Inefficient
- SUMMARY.md one-liner field was not consistently populated across all phases — extraction tooling returned null
- Phase 4 ROADMAP.md plan checkboxes were not updated by the executor (still showed `[ ]` after completion)
- Performance metrics table in STATE.md accumulated format inconsistencies across phases

### Patterns Established
- Conditional tool registration: `if (config.service.enabled) toolRegistry.register(tool)`
- Web content trust boundary: `[WEB CONTENT - UNTRUSTED]` delimiters in tool output
- SQLite-first persistence for any state that must survive restarts (approvals, scheduled tasks)
- Supervisor notifications via direct Telegram API (independent of bot process state)
- fail-closed security: unknown commands default to 'risky', not 'safe'

### Key Lessons
1. SQLite persistence for approval state was critical — in-memory Map would have lost pending approvals on every restart
2. execFile with shell:false provides defense-in-depth even if the command classifier has gaps
3. Heartbeat watchdog must clear timeout FIRST in exit handler to prevent false-positive SIGKILL after clean exit
4. Scheduler init ordering matters — must come after tools are registered and Telegram is started
5. PR monitor should use direct API calls (not agent loop) for mechanical checks — avoids unnecessary LLM cost

### Cost Observations
- Model mix: ~80% sonnet (executors/verifiers), ~20% opus (orchestrator)
- Notable: Executor agents with detailed plans completed most tasks in 2-5 minutes

---

## Milestone: v1.1 — MCP Tools & Tool Manifest

**Shipped:** 2026-03-19
**Phases:** 3 | **Plans:** 5 | **Timeline:** 1 day

### What Was Built
- Declarative JSON manifest (`mcp_config.json`) con `${VAR}` env substitution para MCP servers
- MCP client con dual transport (stdio + StreamableHTTP), crash isolation, y lifecycle management
- Tool adapter con namespace prefixing (`serverName__toolName`), dead-server guard, y result normalization
- McpManager para startup paralelo de múltiples servers via `Promise.allSettled` con 10s timeout
- Security hardening: description truncation (SEC-01), trust framing (SEC-02), tool count logging (SEC-05)

### What Worked
- Security requirements embedded in the phase that creates the surface area — not retrofitted after the fact
- Build order (manifest → client → manager) made each phase independently testable
- `Promise.allSettled` pattern for both connect and disconnect — one failed server never blocks others
- Optional `hasMcpTools` field on AgentContext — backward compatible, scheduler calls unaffected
- Small milestone (3 phases) shipped in one session without context exhaustion

### What Was Inefficient
- SUMMARY.md one-liner field still not populated consistently (same issue as v1.0)
- Phase 7 ROADMAP.md plan checkboxes not updated by executor (07-01 and 07-02 still show `[ ]`)
- Connection timeout was initially in index.ts (Phase 6), then moved inside McpManager (Phase 7) — could have been planned from the start

### Patterns Established
- `Promise.race` with `setTimeout` for per-server connection timeout
- Module-level constant (`MAX_DESC_LEN`) for security policy values
- Conditional system prompt injection via optional boolean flag through context chain
- `serverName__toolName` double-underscore namespace to prevent MCP/custom tool collisions

### Key Lessons
1. `hasMcpTools` derived from actual registered count (not config count) — config may list servers that fail to connect
2. Trust framing in system prompt is simple but effective — just tell the LLM that MCP descriptions are untrusted
3. Tool count budget (≤30) should be monitored empirically with real MCP servers in production
4. Crash isolation via transport callbacks (`onclose`) requires careful `isAlive` guards to suppress spurious warnings on clean disconnect

### Cost Observations
- Model mix: ~80% sonnet (executors/verifiers), ~20% opus (orchestrator)
- Notable: Entire milestone (5 plans) executed in ~20 minutes of agent time — detailed plans with interfaces sections keep executors fast

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Timeline | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 10 days | 4 | First milestone — established wave-based execution and human verification patterns |
| v1.1 | 1 day | 3 | Security-embedded-in-creation pattern — hardening built where surface area originates |

### Top Lessons (Verified Across Milestones)

1. SQLite persistence for any state that must survive process restarts
2. Human verification checkpoints catch integration issues that automated checks miss
3. Detailed interface sections in plans reduce executor context loading overhead
4. SUMMARY.md one-liner field needs consistent population — extraction tooling fails silently when missing
5. Security requirements should live in the phase that creates the attack surface, not in a separate hardening phase
