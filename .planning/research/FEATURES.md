# Feature Research

**Domain:** Personal AI agent — local Mac, Telegram interface, tool execution, scheduling, security
**Researched:** 2026-03-18
**Confidence:** HIGH (active requirements from PROJECT.md verified against current ecosystem patterns)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that define a capable personal agent. Missing these means the agent can't fulfill the core value of autonomous task execution.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Web search | Agents without web access can't answer real-time questions — this is the baseline in 2026 | LOW | Tavily is the go-to for AI-native search; returns LLM-optimized snippets with relevance scores. Brave Search API is the alternative when privacy matters (independent index). Use Tavily for simplicity. |
| Web scraping / URL reading | Users will paste URLs and expect the agent to read them | LOW | For static pages: `fetch` + a markdown converter (e.g. `turndown`). For JS-rendered pages: Firecrawl API or Puppeteer. For a personal agent, Firecrawl API is the right call — no infrastructure overhead, 96% JS coverage, returns clean markdown. |
| Shell command execution | An agent that can't run commands can't automate real tasks on a Mac | HIGH | Most critical feature to get right. Must have: command validation before execution, output capture, timeout enforcement. Blacklist approach (block dangerous patterns) is simpler but weaker than AST-parsing. For personal use with HITL approval, blacklist + approval gate is acceptable. |
| Command execution security — blacklist + HITL | Running shell commands without guardrails on a personal Mac is unacceptable | HIGH | Three-layer model: (1) tool-level permission flags in the Tool definition, (2) command blacklist (rm -rf, mkfs, dd, curl \| sh, etc.), (3) HITL Telegram approval for flagged commands. Blacklist alone is insufficient (whack-a-mole) — HITL gate for high-risk patterns is the required backstop. |
| Scheduled tasks | Without scheduling, all agent value is reactive — the agent can't work while the user sleeps | MEDIUM | `node-cron` or `node-schedule` are the standard Node.js libraries. Scheduler runs inside the bot process or as a supervisor extension. Cron expressions for recurring tasks; one-shot timers for reminders. State persistence in SQLite. |
| Graceful shutdown | Without graceful shutdown, restarts during a task can corrupt state or leave operations half-done | LOW | SIGTERM → finish in-flight operations → close SQLite → exit. Existing supervisor sends restart signals; the bot must handle them cleanly. Pattern is well-established in Node.js ecosystem. |

### Differentiators (Competitive Advantage)

Features that go beyond what most personal agents offer. These align with the Jarvis "trusted autonomous agent" core value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Human-in-the-loop approval via Telegram | Approval workflows native to the agent's own interface — no separate approval UI needed | MEDIUM | The "propose-and-commit" pattern: agent stores action payload, sends Telegram message with approve/reject buttons, waits for response before executing. This already has a foundation with `propose-tool.ts`. Extend it to shell execution and other high-risk operations. |
| Proactive scheduled briefings | Agent pushes value to user without being asked (morning summary, PR digest, reminders) | MEDIUM | Morning briefings that pull from Gmail, Calendar, Bitbucket PRs, and news via web search. OpenAI's "Pulse" and Google's "CC" validated this pattern commercially in late 2025. The Jarvis stack (Gmail + Calendar + Bitbucket tools already exist) makes this high-value/low-cost to implement. |
| Action chaining for complex tasks | Agent autonomously sequences multiple tools to accomplish a goal the user stated in natural language | HIGH | This is the ReAct loop already present in the agent. The differentiator is making it reliable: iteration cap, per-step logging, partial failure recovery. The value comes from combining web search + scraping + shell + memory in a single user-requested workflow. |
| Supervisor health check — hang detection | Crash recovery already works; hang detection (bot alive but unresponsive) is rare but critical | MEDIUM | Pattern: watchdog timer resets on each processed message. If N minutes pass without a reset, supervisor sends SIGKILL and restarts. Implemented as a heartbeat file or shared memory between bot and supervisor processes. |
| Supervisor auto-update from git | Bot updates itself when the user pushes code, without manual `/update` | LOW | `git fetch && git diff HEAD origin/main` on a timer. If diff detected, run the existing update flow. Reduces ops friction for a developer-owned personal agent. |
| Persistent crash and restart logs | Audit trail of when and why the bot restarted — useful for debugging | LOW | Append-only log file written by the supervisor on each restart event: timestamp, exit code, signal, uptime. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full Docker/VM sandbox for code execution | Security teams recommend isolation for agent code execution | Overkill for a personal agent running on the owner's Mac. Adds startup latency (MicroVMs take 100-500ms), local file access complexity, and maintenance burden. The user IS the attacker model here — they own the machine | Three-layer security (tool permissions + blacklist + HITL approval) is the right tradeoff for personal use. If the agent moves to a server, revisit. |
| Allowlist-only command execution | Allowlists feel more secure than blacklists | An allowlist means the user must pre-approve every command variation. This destroys the "ask Jarvis to do things" UX — the agent would be constantly blocked on novel but safe commands | Blacklist dangerous patterns (destructive filesystem ops, privilege escalation, network exfiltration patterns) + HITL for anything that triggers a flag. This is the correct model for a trusted personal agent. |
| Multi-agent orchestration frameworks (LangGraph, AutoGen) | These frameworks provide orchestration primitives | Jarvis is a single-user agent with a working tool-loop architecture. Replacing the core with a framework means re-implementing the existing grammy + OpenRouter + SQLite integrations with framework abstractions, adding complexity without value | Keep the current loop architecture. The agent loop already does ReAct-style chaining natively. |
| External web dashboard for approvals | More ergonomic approval UI than Telegram buttons | Requires a web server, authentication, and a separate interface. This is explicitly out-of-scope. Telegram IS the interface — adding a second interface splits attention and doubles the surface area to maintain | Use Telegram inline keyboard buttons for all approval flows (already used in `propose-tool.ts`). |
| Natural language cron scheduling ("every weekday at 8am") | More ergonomic than cron syntax | Adds an NLP parsing layer for scheduling input, which introduces edge cases (timezone ambiguity, relative expressions). Cron syntax is the better internal representation — the LLM can translate user intent to cron syntax when creating scheduled tasks | Store schedules as cron strings in SQLite. Let the agent do the NLP-to-cron translation when the user creates a scheduled task. |
| Permanent background browser (Puppeteer) | Enables full browser automation (login flows, SPAs) | Running a persistent Chromium process adds ~300MB RAM and complexity. For most web use cases, Firecrawl API handles JS-rendered content without local infrastructure. Login-protected pages require per-site implementation anyway | Use Firecrawl API as the default web scraper. Add Puppeteer only if a specific use case requires it (and document it as a specific tool). |

## Feature Dependencies

```
[Shell Command Execution]
    └──requires──> [Command Blacklist]
    └──requires──> [HITL Approval Gate]
                       └──requires──> [Telegram inline keyboard response handling]

[Scheduled Tasks]
    └──requires──> [Scheduler process (node-cron)]
    └──requires──> [Task state in SQLite (schedule definitions)]
    └──enhances──> [Web Search] (morning briefing pulls news)
    └──enhances──> [Gmail tool] (morning briefing pulls emails)
    └──enhances──> [Google Calendar tool] (morning briefing pulls events)
    └──enhances──> [Bitbucket tool] (PR digest)

[HITL Approval Gate]
    └──enhances──> [Shell Command Execution] (blocks dangerous commands until approved)
    └──enhances──> [Scheduled Tasks] (optionally confirm before running high-impact scheduled jobs)

[Web Search]
    └──enhances──> [Action Chaining] (agent can search during complex workflows)

[Web Scraping / URL Reading]
    └──enhances──> [Action Chaining] (agent can read URLs during complex workflows)
    └──enhances──> [Web Search] (search result URLs can be scraped for full content)

[Supervisor Health Check / Hang Detection]
    └──requires──> [Heartbeat mechanism] (bot writes/touches a file on each processed message)
    └──enhances──> [Graceful Shutdown] (hang detection triggers graceful shutdown before SIGKILL)

[Supervisor Auto-Update]
    └──requires──> [git fetch + diff logic in supervisor]
    └──enhances──> [Supervisor Crash Logs] (log auto-update events alongside crashes)

[Action Chaining]
    └──requires──> [existing agent loop iteration cap]
    └──enhances──> [Web Search]
    └──enhances──> [Shell Command Execution]
    └──enhances──> [Web Scraping]
```

### Dependency Notes

- **Shell Command Execution requires HITL Approval Gate:** Executing arbitrary shell commands without approval is the highest-risk operation in the system. The security gate is not optional — it must exist before the tool is used in production.
- **Scheduled Tasks require Scheduler process:** The scheduler must be in-process (single Node.js process) or managed by the supervisor. In-process with `node-cron` is simpler and sufficient. The tasks need SQLite for persistence so schedules survive restarts.
- **Web Search enhances Action Chaining:** Search becomes most powerful when the agent can use it mid-task (e.g., search for a library, then write code using that library, then run it). The agent loop handles this natively once the web search tool exists.
- **Supervisor Health Check conflicts with simple SIGTERM handling:** A watchdog that sends SIGKILL for hangs must be carefully coordinated with graceful shutdown to avoid killing during cleanup. Graceful shutdown must complete within a bounded timeout (e.g. 30 seconds) before the watchdog escalates.

## MVP Definition

### Launch With (v1 — this milestone)

Minimum set to make Jarvis meaningfully more autonomous than its current state.

- [ ] Web Search tool (Tavily API) — enables real-time information access, unblocks proactive briefings
- [ ] Web Scraping tool (Firecrawl API for JS pages, fetch+turndown for simple URLs) — enables URL reading on demand
- [ ] Shell Command Execution tool — the single highest-value capability; enables scripting, automation, file management
- [ ] Command Blacklist — mandatory precondition for shell execution; blocks rm -rf, mkfs, dd, privilege escalation, etc.
- [ ] HITL Approval via Telegram inline keyboard — mandatory precondition for shell execution; user approves flagged commands
- [ ] Scheduled Tasks with node-cron + SQLite persistence — enables proactive behavior (morning briefings, PR reminders)
- [ ] Graceful Shutdown on SIGTERM — prevents state corruption during restarts; low effort, high reliability impact

### Add After Validation (v1.x)

Features to add once the core capability set is validated in daily use.

- [ ] Morning briefing scheduled task (preset combining Gmail + Calendar + web search + Bitbucket PRs) — trigger: user requests it; the individual tools must exist first
- [ ] Supervisor hang detection / watchdog — trigger: bot hangs in production at least once; low risk to defer
- [ ] Supervisor auto-update from git — trigger: user is annoyed by manual /update; easy to add once hang detection is in

### Future Consideration (v2+)

- [ ] Supervisor persistent crash/restart logs — useful but not blocking anything; defer until there's a reason to audit restart history
- [ ] Per-tool permission flags in the Tool definition schema — currently all tools run if registered; fine for now, but needed if the tool set grows significantly
- [ ] Puppeteer-based full browser automation — defer until there's a concrete use case that Firecrawl can't handle

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Web Search (Tavily) | HIGH | LOW | P1 |
| Web Scraping (Firecrawl) | HIGH | LOW | P1 |
| Shell Command Execution | HIGH | MEDIUM | P1 |
| Command Blacklist | HIGH | LOW | P1 (gates shell execution) |
| HITL Approval Gate | HIGH | MEDIUM | P1 (gates shell execution) |
| Scheduled Tasks (node-cron) | HIGH | MEDIUM | P1 |
| Graceful Shutdown | MEDIUM | LOW | P1 |
| Morning Briefing preset | HIGH | LOW | P2 (requires P1 tools) |
| Supervisor Hang Detection | MEDIUM | MEDIUM | P2 |
| Supervisor Auto-Update | LOW | LOW | P2 |
| Per-tool permission flags | MEDIUM | MEDIUM | P3 |
| Crash/restart log persistence | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when core is working
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | OpenAI Operator/Agents | Google CC / Gemini | Jarvis Approach |
|---------|------------------------|-------------------|-----------------|
| Web search | Built-in, proprietary | Built-in, proprietary | Tavily API — same quality, explicit control over queries |
| Web scraping | Browser-native (Operator) | Browser-native | Firecrawl API — simpler, no local browser process |
| Code/shell execution | Python sandbox (cloud) | Python sandbox (cloud) | Local shell on Mac — higher risk, higher power, requires HITL |
| Scheduled briefings | Pulse (Sept 2025) | "Your Day Ahead" (Dec 2025) | Personal briefing with user's own Google Workspace data — no vendor lock-in |
| Human approval | Not exposed to end users | Not exposed to end users | Telegram inline buttons — user owns the approval flow |
| Privacy | Queries sent to OpenAI/Google | Queries sent to Google | Local agent, only API calls leave the machine |

## Sources

- [Building Effective Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents) — agentic loop patterns, tool integration
- [Best Web Search APIs for AI Applications in 2026 — Firecrawl](https://www.firecrawl.dev/blog/best-web-search-apis) — Tavily vs Brave vs Serper comparison
- [Brave vs Tavily — Data4AI](https://data4ai.com/blog/vendors-comparison/brave-vs-tavily/) — search API tradeoffs
- [Practical Security Guidance for Sandboxing Agentic Workflows — NVIDIA](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) — sandbox security patterns
- [Prompt Injection to RCE in AI Agents — Trail of Bits](https://blog.trailofbits.com/2025/10/22/prompt-injection-to-rce-in-ai-agents/) — shell execution attack vectors
- [Securing Shell Execution Agents — yortuc](https://yortuc.com/posts/securing-shell-execution-agents/) — blacklist vs allowlist vs AST-parsing approaches
- [Destructive Command Guard — GitHub](https://github.com/Dicklesworthstone/destructive_command_guard) — reference implementation for command blacklisting
- [Human-in-the-Loop AI Agents: Approval Workflows — StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation) — HITL patterns
- [AI Agent Job Scheduling: Best Patterns for 2026 — Fast.io](https://fast.io/resources/ai-agent-job-scheduling/) — scheduling patterns for agents
- [How to Create Cron Jobs in Node.js — OneUptime](https://oneuptime.com/blog/post/2026-01-22-nodejs-cron-jobs/view) — node-cron implementation
- [Health Checks and Graceful Shutdown — Express.js](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html) — graceful shutdown patterns
- [Best Web Scraping API 2026 — zackproser](https://zackproser.com/blog/best-web-scraping-api-2026) — Firecrawl vs Puppeteer comparison
- [Proactive AI in 2026 — Alpha Sense](https://www.alpha-sense.com/resources/research-articles/proactive-ai/) — proactive/scheduled briefing patterns
- [7 Proactive OpenClaw Agent Workflows — xCloud](https://xcloud.host/proactive-openclaw-agent-workflows) — real-world scheduled agent workflow examples

---
*Feature research for: personal AI agent (Jarvis) — web access, code execution, scheduling, security*
*Researched: 2026-03-18*
