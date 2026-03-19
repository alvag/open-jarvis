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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Timeline | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 10 days | 4 | First milestone — established wave-based execution and human verification patterns |

### Top Lessons (Verified Across Milestones)

1. SQLite persistence for any state that must survive process restarts
2. Human verification checkpoints catch integration issues that automated checks miss
3. Detailed interface sections in plans reduce executor context loading overhead
