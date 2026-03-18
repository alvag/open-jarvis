# Requirements: Jarvis — Personal AI Agent

**Defined:** 2026-03-18
**Core Value:** Jarvis debe ser un asistente personal confiable que ejecuta tareas de forma autónoma sin comprometer la seguridad del sistema donde corre.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Web Access

- [ ] **WEB-01**: User can ask Jarvis to search the web and receive summarized results via Tavily API
- [ ] **WEB-02**: User can send a URL and Jarvis extracts the content (JS-rendered pages supported) via Firecrawl API

### Code Execution

- [ ] **EXEC-01**: User can ask Jarvis to execute shell commands on their Mac via execFile with shell:false
- [ ] **EXEC-02**: User can ask Jarvis to execute local scripts (.sh, .py, .ts) by file path

### Security

- [ ] **SEC-01**: Destructive commands (rm -rf, mkfs, dd, curl|sh, privilege escalation) are automatically blocked by a configurable blacklist
- [ ] **SEC-02**: Commands flagged as risky require user approval via Telegram inline keyboard before execution
- [ ] **SEC-03**: Pending approval state persists in SQLite and survives bot restarts

### Scheduled Tasks

- [ ] **SCHED-01**: User can create recurring scheduled tasks with cron expressions that persist in SQLite
- [ ] **SCHED-02**: User can request one-shot reminders that execute at a specific time
- [ ] **SCHED-03**: Automatic morning briefing combines Calendar + Gmail + PRs + web search results
- [ ] **SCHED-04**: Periodic PR monitoring with change notifications via Telegram

### Supervisor

- [ ] **SUP-01**: Bot completes in-flight operations before restarting (graceful shutdown with bounded timeout)
- [ ] **SUP-02**: Supervisor detects hung bot (alive but unresponsive) via heartbeat and restarts automatically
- [ ] **SUP-03**: Supervisor detects git changes automatically and updates without manual /update command
- [ ] **SUP-04**: Supervisor writes persistent log of each crash, restart, and update with timestamp and reason

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Web Access

- **WEB-03**: Simple URL reading via cheerio/axios for lightweight static page extraction

### Security

- **SEC-04**: Per-tool permission flags in the Tool definition schema (granular capability limits)

### Scheduled Tasks

- **SCHED-05**: Weekly activity reports and metrics summaries

### Code Execution

- **EXEC-03**: Agent-generated code execution (Jarvis writes and runs code to solve problems)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Docker/VM sandbox for code execution | Overkill for personal agent on owner's Mac; three-layer security model is sufficient |
| Multi-agent orchestration frameworks (LangGraph, AutoGen) | Current agent loop already handles tool chaining; framework adds complexity without value |
| Web dashboard for approvals | Telegram is the sole interface; second UI splits attention and doubles maintenance |
| Permanent background browser (Puppeteer) | ~300MB RAM overhead; Firecrawl API handles JS pages without local infrastructure |
| Allowlist-only command execution | Destroys UX — agent constantly blocked on novel but safe commands |
| Slack/Notion/Jira integrations | Not needed now; Google Workspace + Bitbucket cover current workflow |
| Server/VPS migration | Runs locally on Mac; revisit if always-on reliability becomes an issue |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WEB-01 | — | Pending |
| WEB-02 | — | Pending |
| EXEC-01 | — | Pending |
| EXEC-02 | — | Pending |
| SEC-01 | — | Pending |
| SEC-02 | — | Pending |
| SEC-03 | — | Pending |
| SCHED-01 | — | Pending |
| SCHED-02 | — | Pending |
| SCHED-03 | — | Pending |
| SCHED-04 | — | Pending |
| SUP-01 | — | Pending |
| SUP-02 | — | Pending |
| SUP-03 | — | Pending |
| SUP-04 | — | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15 ⚠️

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after initial definition*
