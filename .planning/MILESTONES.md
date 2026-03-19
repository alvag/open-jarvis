# Milestones

## v1.1 MCP Tools & Tool Manifest (Shipped: 2026-03-19)

**Phases completed:** 3 phases, 5 plans
**Timeline:** 1 day (2026-03-19)
**Files modified:** 38 (+5,817 / -82 lines)
**Codebase:** 6,256 LOC TypeScript

**Key accomplishments:**

- Declarative JSON manifest (`mcp_config.json`) con `${VAR}` env substitution para configurar MCP servers sin exponer secrets
- MCP client con dual transport (stdio + StreamableHTTP), crash isolation, y namespace prefixing (`serverName__toolName`)
- McpManager para startup paralelo de múltiples servers via `Promise.allSettled` con timeout de 10s
- Security hardening: description truncation a 500 chars (SEC-01), trust framing en system prompt (SEC-02), tool count logging con >30 warning (SEC-05)
- Enfoque híbrido donde custom tools y MCP tools coexisten transparentemente en el agent loop

---

## v1.0 MVP (Shipped: 2026-03-19)

**Phases completed:** 4 phases, 11 plans
**Timeline:** 10 days (2026-03-08 → 2026-03-18)
**Files modified:** 56 (+9,745 / -106 lines)
**Codebase:** 5,295 LOC TypeScript

**Key accomplishments:**

- Web search (Tavily) and URL scraping (Firecrawl) with content trust boundaries and prompt injection protection
- Shell execution with three-layer security: blocked/risky/safe classifier + Telegram approval gate + SQLite-backed persistence
- Croner-based scheduler with SQLite persistence, natural language cron, morning briefings, and Bitbucket PR monitoring
- Supervisor rewrite: lifecycle logging to file, IPC heartbeat watchdog (30s), git auto-update polling (5min), Telegram notifications
- Graceful shutdown with in-flight agent tracking (15s timeout) across both supervisor and bot process

---
