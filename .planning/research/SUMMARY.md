# Project Research Summary

**Project:** Jarvis — Personal AI Agent capability expansion
**Domain:** Personal AI agent — local Mac, Telegram interface, tool execution, scheduling, security
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

Jarvis is a personal AI agent with a clean, working foundation (grammy + OpenRouter + SQLite + TypeScript). This milestone expands its capabilities from a memory-and-tool loop into a fully autonomous agent that can search the web, read URLs, run shell commands, and execute scheduled tasks without user prompting. All four research streams confirm the same architectural direction: extend the existing layered monolith cleanly, avoid introducing new infrastructure (no Docker, no Redis, no second database), and treat shell execution as the highest-risk capability requiring defense in depth before shipping.

The recommended approach is to build in four phases ordered by dependency and risk. Web search and scraping come first — they are zero-security-risk additions that immediately expand what Jarvis can answer. The security infrastructure (command blacklist, approval gate, per-tool risk levels) comes second because the shell execution tool cannot ship without it. Scheduled tasks come third because they depend on both the agent loop working reliably and the database schema migrations from earlier phases. Supervisor improvements are largely independent and can be threaded into any phase. Every recommended library is production-proven, zero-extra-infrastructure, and compatible with the existing Node.js 22 + ESM setup.

The critical risk in this milestone is shell command security. Research across three independent sources (OWASP MCP05:2025, Trail of Bits RCE analysis, CVE-2025-53372) confirms that blacklist-based filtering is categorically insufficient — all three layers of the recommended security model (allowlist-based `execFile` + per-tool risk levels + human-in-the-loop Telegram approval) must be present before the shell tool is registered. A secondary risk is indirect prompt injection via web content (OWASP LLM01:2025 top-ranked vulnerability): scraped content must be wrapped in untrusted-content framing before reaching the LLM. Both risks are fully preventable with the patterns documented in ARCHITECTURE.md and PITFALLS.md.

## Key Findings

### Recommended Stack

The existing stack stays entirely intact. Four new capability areas require new libraries, all lightweight and infrastructure-free. Tavily (`@tavily/core@^0.7.2`) is the clear choice for web search — it is the only search API designed specifically for LLM agent workflows, returning ranked summaries rather than raw HTML. For web scraping, Cheerio (`cheerio@^1.2.0`) with axios handles static pages (90%+ of agent use cases) without spinning up a browser process; Playwright/Puppeteer is deferred until a concrete SPA use case demands it. Shell execution requires no new library — `child_process.execFile` (built-in) with an explicit allowlist is both safer and simpler than any sandboxing library. The `vm2` library has an active critical CVE (CVSS 9.8, Jan 2026) and must not be used. For scheduling, `croner@^10.0.1` replaces the `node-cron` mentioned in some sources — it is the only Node.js scheduler with true timezone support, pause/resume, and async handler support at zero dependencies.

**Core technologies:**
- `@tavily/core@^0.7.2`: Web search — purpose-built for LLM agents, returns ranked summaries, 1,000 free queries/month
- `cheerio@^1.2.0` + `axios@^1.8.x`: Web scraping — jQuery-like HTML parsing without a browser, handles 90% of URLs
- `child_process.execFile` (built-in): Shell execution — no shell spawning, eliminates metacharacter injection by design
- `croner@^10.0.1`: Task scheduling — zero dependencies, full cron syntax, timezone support, async handlers, pause/resume
- Brave Search REST API: Search fallback — independent index, $5/1,000 queries when Tavily quota is exhausted

### Expected Features

**Must have (table stakes — P1 for this milestone):**
- Web Search tool (Tavily) — real-time information access; unblocks proactive briefings
- Web Scraping tool (Cheerio for static, Firecrawl API for JS-heavy pages) — URL reading on demand
- Shell Command Execution tool — single highest-value capability; enables scripting and automation on Mac
- Command allowlist + `execFile` enforcement — mandatory precondition for shell execution
- HITL Approval via Telegram inline keyboard — mandatory precondition for shell execution; user approves flagged commands
- Scheduled Tasks with croner + SQLite persistence — enables proactive behavior (morning briefings, reminders)
- Graceful Shutdown on SIGTERM — prevents state corruption during restarts; low effort, high reliability impact

**Should have (differentiators — P2, add after core is validated):**
- Morning briefing scheduled task (preset combining Gmail + Calendar + web search + Bitbucket PRs)
- Supervisor hang detection / watchdog (heartbeat file, SIGKILL on stale heartbeat)
- Supervisor auto-update from git (periodic `git rev-parse HEAD` poll in supervisor)

**Defer (v2+):**
- Persistent crash/restart logs (useful but not blocking anything)
- Per-tool permission flags in Tool schema (needed only if tool set grows significantly)
- Puppeteer-based full browser automation (defer until a concrete use case requires it)
- External web dashboard for approvals (Telegram IS the interface; a second UI splits attention)
- Multi-agent orchestration frameworks (the existing ReAct loop handles all current needs)

### Architecture Approach

The architecture extends the existing clean layered monolith without restructuring it. Two new modules are introduced at clear boundaries: `src/security/` (command blacklist, tool permissions, approval gate) and `src/scheduler/` (croner scheduler, task runner, task types). The tool registry becomes the single enforcement point for security — `ToolRegistry.execute()` checks `riskLevel` before every tool call, invoking the approval gate for high-risk operations. The approval gate uses async Promise resolution stored in a Map (with SQLite-persisted state for restart safety) so the event loop stays free while waiting for user response. The scheduler runs in-process, reads tasks from a new `scheduled_tasks` SQLite table, and calls the existing `runAgent()` function with a synthetic context — no special code path needed. Two new SQLite tables are required: `scheduled_tasks` (cron expression + prompt + enabled flag) and `execution_log` (audit trail per tool call).

**Major components:**
1. `src/security/` (new) — command blacklist, per-tool risk levels, async approval gate; wraps `ToolRegistry.execute()`
2. `src/scheduler/` (new) — croner instance, task CRUD, task runner that calls `runAgent()` and broadcasts result
3. `src/tools/built-in/web-search.ts` (new) — Tavily API calls, returns ranked snippets to LLM
4. `src/tools/built-in/web-scrape.ts` (new) — axios + Cheerio HTML fetch/parse with untrusted-content framing
5. `src/tools/built-in/shell-exec.ts` (new) — `execFile` with allowlist check, timeout, maxBuffer cap
6. `src/tools/built-in/schedule-task.ts` (new) — CRUD interface to `scheduled_tasks` table
7. `src/memory/db.ts` (extended) — migrations for `scheduled_tasks` and `execution_log` tables
8. `src/supervisor.ts` (extended) — heartbeat detection, periodic git poll, crash log

### Critical Pitfalls

1. **Blacklist-based command filtering is trivially bypassed** — use `child_process.execFile` with an explicit allowlist of permitted binaries, never `exec()` with a shell string. Defense in depth: allowlist + `shell: false` + HITL approval for all shell execution. (OWASP MCP05:2025; CVE-2025-53372)

2. **Indirect prompt injection via scraped web content** — wrap all scraped content in clearly-delimited untrusted-content framing in the system prompt. Strip HTML before sending to LLM. Never inject tool results into the system prompt, only into conversation history as `role: "tool"` messages. (OWASP LLM01:2025 top-ranked)

3. **Human approval blocks the agent loop forever** — never store approval state in-memory only; persist to SQLite with a timeout and status field. On restart, scan for expired approvals and notify the user. The approval Promise resolver must survive bot restarts. (Documented failure mode in production Telegram bots)

4. **Scheduled tasks fail silently** — every scheduled task must report success AND failure back to the user via Telegram. Wrap all task execution in a top-level try/catch that always sends a failure notification. Log structured events (start, finish, duration, error) to a persistent file. (Production incident pattern)

5. **Scheduled task overlap — same task runs twice concurrently** — use a per-task lock in the `execution_log` SQLite table (`status: running | done | failed`). Only start a new run if no run for that task is currently `running`. Add a stale-lock timeout (5x expected duration). Never use `setInterval` directly for multi-step agent tasks. (node-cron documented pitfall)

## Implications for Roadmap

Based on research, the build order is determined by two constraints: (1) security infrastructure must precede the shell execution tool, and (2) web search/scraping have no security dependencies and deliver immediate user value. Architecture.md explicitly documents the dependency graph; this section translates it into phases.

### Phase 1: Web Access (Search + Scraping)

**Rationale:** Zero security risk — these are read-only tools with no destructive capability. They deliver immediate user value and unblock the morning briefing feature. No new infrastructure or database changes required; just new tools plugged into the existing registry. Building these first validates the tool-adding workflow before tackling the riskier shell execution work.

**Delivers:** Jarvis can search the web in real time and read any URL the user sends. The agent loop immediately becomes more useful for research, fact-checking, and answering time-sensitive questions.

**Addresses features:** Web Search (Tavily), Web Scraping (Cheerio/axios), fallback to Firecrawl API for JS-heavy pages

**Avoids:** Prompt injection via web content — wrap scraped content in untrusted-content framing from day one; do not defer this safety measure

**Stack:** `@tavily/core`, `axios`, `cheerio`

**Research flag:** Standard patterns. Tavily has official SDK docs. Cheerio 1.x has official docs. Skip deeper research-phase.

### Phase 2: Security Infrastructure + Shell Execution

**Rationale:** The security module must exist before the shell tool is registered. Building security first means the shell tool is safe by construction — it cannot ship without the gate being in place. This ordering also validates the approval-gate UX before it becomes critical.

**Delivers:** Jarvis can run shell commands on the Mac with defense-in-depth security: allowlist-based `execFile`, per-tool risk levels on the registry, and Telegram HITL approval gate for high-risk operations. Approval state persists across restarts via SQLite.

**Addresses features:** Shell Command Execution, Command allowlist + `execFile`, HITL Approval Gate, Graceful Shutdown on SIGTERM

**Avoids:** `exec()` string interpolation, blacklist-only security, approval state lost on restart, event-loop blocking during approval wait

**Stack:** `child_process.execFile` (built-in), SQLite approvals table (new migration)

**Architecture:** `src/security/command-blacklist.ts`, `src/security/tool-permissions.ts`, `src/security/approval-gate.ts`, `src/tools/built-in/shell-exec.ts`; `riskLevel` field added to `ToolDefinition`

**Research flag:** Needs careful implementation review. The three-layer security model has documented patterns but the interaction between approval gate, agent loop pause, and bot restart survival is nuanced. Consider a focused implementation review of the approval gate before shipping.

### Phase 3: Scheduled Tasks

**Rationale:** Scheduling depends on the agent loop running reliably (available from the start) and on the DB schema migrations being established (available after Phase 2 adds migration patterns). The morning briefing preset also depends on web search existing (Phase 1). Building third lets the scheduler leverage all existing tools including web search.

**Delivers:** Jarvis operates proactively — morning briefings, PR reminders, any recurring task the user defines. The `schedule-task` tool gives Jarvis the ability to manage its own schedule via natural language.

**Addresses features:** Scheduled Tasks (croner + SQLite), Morning Briefing preset (P2 — can ship as part of this phase or immediately after)

**Avoids:** Silent task failures (always report via Telegram), task overlap (SQLite lock per task), hardcoded tasks (store in `scheduled_tasks` table), timezone drift (always pass explicit timezone to croner)

**Stack:** `croner@^10.0.1`, new SQLite tables (`scheduled_tasks`, `execution_log`)

**Architecture:** `src/scheduler/scheduler.ts`, `src/scheduler/task-runner.ts`, `src/scheduler/task-types.ts`, `src/tools/built-in/schedule-task.ts`

**Research flag:** Standard patterns for croner. SQLite table design is straightforward. The overlap-prevention pattern (per-task status lock) needs explicit implementation — this is the highest-risk part of this phase.

### Phase 4: Supervisor Improvements

**Rationale:** Independent of all bot-process internals — can be built alongside any phase or as its own phase. Grouped at the end because it addresses reliability rather than new user-facing capability, and because it is easiest to understand what to monitor after the other phases have shipped.

**Delivers:** Supervisor detects hangs (not just crashes), auto-updates from git on new commits, and writes structured crash/restart logs for debugging.

**Addresses features:** Supervisor Hang Detection (P2), Supervisor Auto-Update from git (P2), Persistent crash logs (P3 — can defer entirely)

**Avoids:** Heartbeat via HTTP (use file-based heartbeat at `/tmp/jarvis.heartbeat`); replacing the supervisor with PM2 (out-of-scope per project constraints)

**Stack:** `child_process` (built-in), `node:fs/promises` (built-in), no new dependencies

**Research flag:** Standard patterns. All built-in Node.js APIs. Skip deeper research-phase.

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** Web access has no security dependencies and delivers immediate user value. Validates tool-addition workflow before the more complex security work.
- **Phase 2 before Phase 3:** Security module must exist before shell execution is registered. The SQLite approval table also establishes migration patterns used in Phase 3.
- **Phase 3 after Phase 1 and 2:** Morning briefing preset (the highest-value scheduled task) requires web search from Phase 1. Scheduler patterns are simpler to validate once the agent loop is proven reliable with new tools.
- **Phase 4 is independent:** Can be done in parallel with Phase 3 or after. No user-facing features blocked on it.
- **Graceful shutdown (SIGTERM handler) belongs in Phase 2:** It is a precondition for the approval gate working correctly across restarts. Low effort, high reliability impact.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Security + Shell):** The approval gate's interaction with the agent loop pause/resume, restart survival, and Telegram callback de-duplication is nuanced. Review the Pattern 2 example in ARCHITECTURE.md carefully. Consider a focused spike on the approval-gate state machine before writing the implementation plan.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Web Access):** Tavily SDK has official docs; Cheerio 1.x is thoroughly documented. Patterns are established.
- **Phase 3 (Scheduling):** croner docs cover all required patterns. The main implementation detail (overlap prevention via SQLite lock) is documented in PITFALLS.md.
- **Phase 4 (Supervisor):** All built-in Node.js APIs with no research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Tavily version (0.7.2) confirmed ~20 days ago — slight staleness. croner, cheerio, isolated-vm versions confirmed from official sources within 1-2 months. `execFile` security recommendation from official Node.js docs. |
| Features | HIGH | Active requirements from PROJECT.md verified against 2026 ecosystem. Competitor analysis (OpenAI Operator, Google CC) validates proactive briefing and HITL approval as differentiators. |
| Architecture | HIGH | Based on direct codebase inspection + verified CVE patterns. Build order validated against actual dependency graph. |
| Pitfalls | HIGH | Security pitfalls verified against named CVEs (CVE-2025-53372, CVE-2026-22709, OWASP LLM01/MCP05 2025). Scheduling pitfalls from multiple production sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **Firecrawl API vs. Cheerio decision:** FEATURES.md recommends Firecrawl API for JS-heavy scraping; STACK.md recommends Cheerio + axios for static pages. The resolution is: ship Cheerio first (handles 90% of cases), add Firecrawl API integration if specific JS-heavy pages are needed. Validate by testing the first 10 URLs Jarvis actually scrapes in practice.

- **Tavily quota exhaustion strategy:** The free tier (1,000 queries/month) is sufficient for personal use, but the Brave Search fallback should be wired in during Phase 1 to avoid a hard outage when quota runs out. Confirm the fallback routing logic during Phase 1 implementation.

- **Approval gate restart survival — scope decision:** PITFALLS.md recommends persisting approval state to SQLite (approval table). ARCHITECTURE.md Pattern 2 example uses an in-memory Map. These are not contradictory, but Phase 2 must explicitly choose the SQLite-persisted approach (not the in-memory-only approach) to avoid the documented pitfall. This decision should be explicit in the Phase 2 implementation plan.

- **`isolated-vm` deferral:** If the shell tool ever evolves to execute LLM-generated JavaScript (not just pre-written scripts), `isolated-vm@6.0.2` with `--no-node-snapshot` is the correct addition. This requires updating the supervisor launch command. Treat as a future-phase consideration, not a current requirement.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `/Users/max/Personal/repos/open-jarvis/src/` — architecture, existing patterns
- `cheerio` npm + GitHub: v1.2.0, Oct 2024 release — scraping recommendation
- `croner` npm: v10.0.1, published 1 month ago — scheduling recommendation
- `isolated-vm` GitHub releases: v6.0.2, Oct 2025 — sandbox recommendation
- CVE-2026-22709 (vm2): Endor Labs, Jan 2026 — vm2 avoidance
- CVE-2025-53372 (Node.js MCP server command injection): GitHub Advisory — shell security
- OWASP LLM01:2025 Prompt Injection — web scraping risk
- OWASP MCP05:2025 Command Injection & Execution — shell execution risk
- Node.js `child_process` official docs — `execFile` recommendation
- Trail of Bits: Prompt Injection to RCE in AI Agents — attack chain analysis

### Secondary (MEDIUM confidence)
- Tavily npm: v0.7.2, published ~20 days ago — search recommendation (version may have bumped)
- Brave Search pricing announcement — fallback cost model
- BetterStack Node.js schedulers comparison — scheduler alternatives
- CVE-2025-68613 (n8n sandbox escape) — blacklist bypass pattern

### Tertiary (LOW confidence / community)
- Firecrawl API vs. Puppeteer comparison (zackproser.com) — JS-heavy scraping alternative
- Human-in-the-Loop AI Agents design patterns (StackAI) — HITL approval UX patterns
- AI Agent Job Scheduling patterns (Fast.io) — scheduling for agents

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
