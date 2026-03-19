# Phase 4: Supervisor Improvements - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve the existing supervisor (`src/supervisor.ts`) to detect hung bots via heartbeat, auto-update from git without manual `/update`, ensure graceful shutdown completes in-flight operations, and persist a lifecycle log of all supervisor events. No new user-facing features — this is infrastructure hardening.

</domain>

<decisions>
## Implementation Decisions

### Heartbeat & hang detection (SUP-02)
- Use Node.js IPC channel (`process.send()`) between supervisor and bot — no HTTP server, no files
- Bot sends heartbeat every 10 seconds
- Supervisor considers bot hung after 30 seconds without heartbeat (3 missed beats)
- On hang detection: supervisor kills the bot process and restarts it
- Supervisor sends Telegram notification when a hang is detected and the bot is restarted

### Auto-update strategy (SUP-03)
- Supervisor polls with `git fetch` every 5 minutes
- Compares local HEAD vs remote HEAD for the current branch only
- If remote is ahead: graceful shutdown bot → `git pull` → restart
- If `package.json` changed in the diff: run `npm install` before restarting
- No branch filtering — always tracks whatever branch the bot is running on

### Graceful shutdown (SUP-01)
- Bounded timeout of 15 seconds for in-flight operations (current 3s is too short)
- Shutdown sequence: notify Telegram ("Jarvis reiniciando...") → stop scheduler → wait for in-flight agent runs → stop Telegram → close DB
- Pending approval gates persist in SQLite (SEC-03) and recover on restart via `recoverPendingOnStartup()` — no change needed, already works
- After 15s timeout: force exit regardless of in-flight state

### Lifecycle logging (SUP-04)
- Separate log file: `data/supervisor.log` (not mixed with bot's `data/jarvis.log`)
- Same format as `src/logger.ts`: `[timestamp] [LEVEL] [category] message`
- No log rotation for now — supervisor events are infrequent enough
- Events to log: start, crash (with exit code), restart, hang-detected, auto-update-started, auto-update-complete (with commit hash), shutdown, npm-install (if triggered)

### Claude's Discretion
- IPC message format and protocol details
- Exact implementation of the git fetch comparison
- How to track in-flight agent runs for graceful shutdown
- Supervisor log function implementation (can reuse logger.ts pattern or be standalone)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

No external specs — requirements fully captured in decisions above and in REQUIREMENTS.md (SUP-01 through SUP-04).

### Existing implementation (must read)
- `src/supervisor.ts` — Current supervisor with exit-code-based restart/update and exponential backoff
- `src/exit-codes.ts` — EXIT_CLEAN=0, EXIT_RESTART=42, EXIT_UPDATE=43
- `src/restart-signal.ts` — scheduleRestart/getPendingRestart mechanism
- `src/index.ts` — Bot entry point with graceful shutdown (SIGINT/SIGTERM handlers)
- `src/logger.ts` — Logging pattern to replicate for supervisor log
- `src/tools/built-in/restart-server.ts` — restart_server tool using exit codes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/logger.ts`: Log format pattern `[timestamp] [LEVEL] [category] message` — supervisor log should match
- `src/exit-codes.ts`: Exit code protocol (0=clean, 42=restart, 43=update) — auto-update can reuse EXIT_UPDATE flow
- `src/restart-signal.ts`: scheduleRestart mechanism — may need extension for graceful shutdown coordination

### Established Patterns
- Supervisor spawns bot with `spawn("node", ["--import", "tsx", "src/index.ts"])` — IPC requires adding `stdio: ['inherit', 'inherit', 'inherit', 'ipc']`
- Signal forwarding: supervisor forwards SIGINT/SIGTERM to child — graceful shutdown already receives these
- Exponential backoff on crash: 1s→2s→4s→...→60s max, resets after 30s stable uptime

### Integration Points
- `supervisor.ts` → bot IPC: supervisor listens for heartbeat messages from child process
- `index.ts` → heartbeat: bot needs to emit heartbeat messages via `process.send()` on an interval
- `supervisor.ts` → git: new git polling loop alongside existing exit code handler
- `supervisor.ts` → Telegram: supervisor needs to send notifications (hang detected, update applied) — requires either direct bot API call or IPC message to bot

</code_context>

<specifics>
## Specific Ideas

- Supervisor Telegram notifications can use the bot token directly (simple `fetch` to Telegram API) since the supervisor is a separate process from the bot
- The existing `restart_server` tool with `mode: 'update'` should continue working alongside auto-update — both paths should coexist

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-supervisor-improvements*
*Context gathered: 2026-03-18*
