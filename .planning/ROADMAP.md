# Roadmap: Jarvis — Personal AI Agent (Capability Expansion)

## Overview

This milestone transforms Jarvis from a memory-and-tool loop into a fully autonomous personal agent. The work proceeds in four phases ordered by dependency and risk: web access first (zero-risk, immediate value), security infrastructure + shell execution second (security gates the tool), scheduled tasks third (depends on web search for the morning briefing), and supervisor improvements last (independent reliability work). Every phase delivers a coherent, verifiable capability that the user can observe and test via Telegram.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Web Access** - Jarvis can search the web and read URLs on demand
- [ ] **Phase 2: Security + Shell Execution** - Jarvis can run shell commands safely with three-layer defense and human approval
- [ ] **Phase 3: Scheduled Tasks** - Jarvis operates proactively with cron-based tasks, reminders, and morning briefings
- [ ] **Phase 4: Supervisor Improvements** - Supervisor detects hangs, auto-updates from git, and persists crash logs

## Phase Details

### Phase 1: Web Access
**Goal**: Jarvis can search the internet in real time and extract content from any URL the user sends
**Depends on**: Nothing (first phase)
**Requirements**: WEB-01, WEB-02
**Success Criteria** (what must be TRUE):
  1. User can ask Jarvis a question about current events and receive a summarized answer sourced from live web search results
  2. User can send a URL to Jarvis and receive the extracted text content of that page
  3. JS-rendered pages (SPAs, dynamically loaded content) return readable content, not empty HTML
  4. Scraped web content is framed as untrusted so Jarvis does not execute instructions embedded in page content
**Plans**: TBD

### Phase 2: Security + Shell Execution
**Goal**: Jarvis can execute shell commands and local scripts on the user's Mac with defense-in-depth safety controls that survive bot restarts
**Depends on**: Phase 1
**Requirements**: SEC-01, SEC-02, SEC-03, EXEC-01, EXEC-02
**Success Criteria** (what must be TRUE):
  1. User can ask Jarvis to run a shell command (e.g., `ls`, `git status`) and receive the output in Telegram
  2. User can ask Jarvis to run a local script by file path (.sh, .py, .ts) and receive the result
  3. A destructive command (e.g., `rm -rf /`) is automatically blocked and Jarvis explains why without executing it
  4. A risky-but-not-blacklisted command triggers an inline Telegram keyboard asking the user to approve or deny before execution
  5. If the bot restarts while an approval is pending, the pending approval is recovered from SQLite and the user is notified on reconnect
**Plans**: TBD

### Phase 3: Scheduled Tasks
**Goal**: Jarvis operates proactively — executing recurring tasks, one-shot reminders, and automated briefings without user prompting
**Depends on**: Phase 1 (morning briefing requires web search), Phase 2 (stable agent loop with proven tool execution)
**Requirements**: SCHED-01, SCHED-02, SCHED-03, SCHED-04
**Success Criteria** (what must be TRUE):
  1. User can tell Jarvis to remind them of something at a specific time and receive that reminder via Telegram when the time arrives
  2. User can ask Jarvis to create a recurring task with a cron expression and it persists across bot restarts
  3. Each morning Jarvis sends an unprompted briefing combining Calendar events, unread Gmail, open Bitbucket PRs, and a relevant news summary
  4. Jarvis sends a Telegram notification when a Bitbucket PR it monitors has new activity
  5. A scheduled task that fails sends a failure notification to the user via Telegram rather than failing silently
**Plans**: TBD

### Phase 4: Supervisor Improvements
**Goal**: The supervisor detects hung (not just crashed) bot processes, auto-updates from git without manual intervention, and maintains a persistent log of all lifecycle events
**Depends on**: Nothing (independent of bot-process internals; can follow Phase 3)
**Requirements**: SUP-01, SUP-02, SUP-03, SUP-04
**Success Criteria** (what must be TRUE):
  1. Bot completes any in-flight tool execution or approval before shutting down when a restart is triggered
  2. If the bot process is alive but stops responding (no heartbeat), the supervisor kills and restarts it automatically without user action
  3. When a new commit is pushed to the git repository, the supervisor detects it and applies the update automatically without requiring `/update`
  4. Every crash, restart, and update is written to a persistent log file with timestamp and reason that the user can inspect
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Web Access | 0/TBD | Not started | - |
| 2. Security + Shell Execution | 0/TBD | Not started | - |
| 3. Scheduled Tasks | 0/TBD | Not started | - |
| 4. Supervisor Improvements | 0/TBD | Not started | - |
