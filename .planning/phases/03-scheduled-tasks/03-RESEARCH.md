# Phase 3: Scheduled Tasks - Research

**Researched:** 2026-03-18
**Domain:** In-process cron scheduling, SQLite persistence, proactive Telegram messaging, Bitbucket PR polling
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Scheduling engine:** In-process cron using a Node.js library (node-cron or croner) inside the bot process
- **Persistence:** Tasks stored in SQLite; cron timers reconfigured at startup from the DB
- **Execution model:** Tasks run through the agent loop — each task sends a synthetic prompt to the agent as if it were a user message; the LLM decides which tools to use
- **Concurrency:** Sequential execution — tasks run one at a time in order; concurrent triggers are queued
- **Task creation:** Natural language — user says "remind me X every Monday" and the LLM extracts the cron expression + prompt. Internal tool `create_scheduled_task`
- **Task management:** Full CRUD via agent tools — list, delete, pause. User says "show my tasks" or "cancel reminder X"
- **Confirmation before delete:** Jarvis asks for confirmation before deleting a task
- **Error handling:** Notify + retry — sends Telegram notification on error, retries once after 5 minutes; if it fails again, waits for next scheduled execution. Tasks NEVER fail silently.
- **Shell task security:** Approved at creation time — future executions of that task do not re-prompt. Pre-approval flag persisted in SQLite alongside the task.
- **Morning briefing:** Fixed configurable time (default 7:00 AM), 4 mandatory sections (Calendar, Gmail, Bitbucket PRs, News), single structured message with emoji section headers, ~300 words max. News topics stored as user memories. Built-in pre-configured task.
- **Reminders:** Simple "🔔 Recordatorio: [text]" message sent directly via Telegram (no agent loop). Supports one-shot and recurring. Same internal model as scheduled tasks — type field distinguishes "reminder" from "task".
- **PR monitoring:** Every 15 minutes. Notifies on: new commits pushed, direct mention, state change (approved/merged/declined). NOT general comments. Scope: PRs where user is author or reviewer. Notification: brief summary with link. Built-in scheduled task. Needs a table or mechanism to track last known state per PR.
- **Single table:** One `scheduled_tasks` table with a `type` field (reminder/task/briefing/pr-monitor). One scheduler engine handles all types.

### Claude's Discretion
- Choice of specific cron library (node-cron vs croner vs other)
- Exact SQLite schema for scheduled tasks table
- How the LLM parses natural language to cron expressions
- Briefing summarization strategy (which emails are "important", how many events to show)
- Exact notification format for PR changes
- How to detect direct user mentions in PR comments

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHED-01 | User can create recurring scheduled tasks with cron expressions that persist in SQLite | croner library + SQLite migration v5 schema + `create_scheduled_task` tool |
| SCHED-02 | User can request one-shot reminders that execute at a specific time | croner `maxRuns: 1` + ISO datetime pattern + reminder type in unified table |
| SCHED-03 | Automatic morning briefing combines Calendar + Gmail + PRs + web search results | Built-in briefing task + agent loop invocation + existing GWS/Bitbucket tools |
| SCHED-04 | Periodic PR monitoring with change notifications via Telegram | Built-in PR monitor task + `updated_on` + `/activity` polling + pr_states tracking table |
</phase_requirements>

---

## Summary

Phase 3 adds proactive scheduling to Jarvis. The core architecture is: a persistent SQLite table (`scheduled_tasks`) that survives restarts, loaded at startup into in-process cron timers (croner), which fire synthetic agent-loop invocations or direct Telegram sends depending on task type.

The key insight is that reminders and tasks share a single internal model — they are the same row in `scheduled_tasks` with a `type` field that determines execution behavior. Recurring tasks invoke `runAgent()` with a synthetic prompt (LLM reasons + uses tools). Reminders call `telegram.sendMessage()` directly, skipping the agent loop entirely.

PR monitoring requires a companion table to track last-known PR state per PR ID. The polling strategy uses the Bitbucket Cloud `/repositories/{ws}/{repo}/pullrequests/{id}/activity` endpoint to detect changes since the last check, keyed on `updated_on` timestamps stored in SQLite.

**Primary recommendation:** Use croner 10.0.1 (zero dependencies, full ESM, TypeScript types, `maxRuns: 1` for one-shot tasks, `.stop()` for graceful shutdown). Add migration v5 to `db.ts`. Create `src/scheduler/` directory with `scheduler-manager.ts` (engine) and `scheduler-tools.ts` (agent-facing tools).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| croner | 10.0.1 | In-process cron scheduling | Zero deps, full ESM, TypeScript types, Node ≥18, `maxRuns` for one-shot, `.stop()/.pause()/.resume()`, used by PM2/Uptime Kuma. Latest published 2026-02-21. |
| better-sqlite3 | 12.6.2 (already installed) | Persist scheduled_tasks table | Already in use; synchronous API fits prepared-statement pattern established in db.ts |

### Supporting (already installed — no new installs needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| grammy | 1.35.0 | `bot.api.sendMessage()` for proactive Telegram sends | All reminder and notification delivery |
| croner | 10.0.1 | NEW — only new dependency | All scheduling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| croner | node-cron 4.2.1 | node-cron: no `nextRun()` display, no `.pause()`, no ESM-first exports, does not show next execution time |
| croner | node-schedule 2.1.1 | node-schedule: heavier, date-based API is verbose for cron-string workflows |
| croner | Custom setTimeout | Hand-rolling misses DST, month-end edge cases, cron parse bugs |

**Installation:**
```bash
npm install croner
```

**Version verification:** croner@10.0.1 confirmed via `npm view croner version` on 2026-03-18.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── scheduler/
│   ├── scheduler-manager.ts   # Engine: loads from DB, starts/stops cron jobs
│   └── scheduler-tools.ts     # Agent tools: create, list, delete, pause scheduled tasks
├── tools/built-in/
│   └── (existing tools unchanged — briefing uses them via agent loop)
└── memory/
    └── db.ts                  # Migration v5: scheduled_tasks + pr_states tables
```

### Pattern 1: SQLite-Backed Scheduler (Restart-Safe)
**What:** On startup, read all `active` rows from `scheduled_tasks`, register each as a croner job. On any CRUD operation from tools, update SQLite first, then update in-memory jobs.

**When to use:** This is the only correct approach for restart-safe scheduling — croner timers are in-memory only; SQLite is the source of truth.

**Example:**
```typescript
// Source: croner docs (croner.56k.guru) + established db.ts pattern
import { Cron } from "croner";

export function startScheduler(db: Database, telegram: TelegramChannel, runAgent: AgentRunner): void {
  const rows = db.prepare("SELECT * FROM scheduled_tasks WHERE status = 'active'").all();
  for (const row of rows as ScheduledTaskRow[]) {
    registerCronJob(row, db, telegram, runAgent);
  }
}

function registerCronJob(task: ScheduledTaskRow, db: Database, telegram: TelegramChannel, runAgent: AgentRunner): void {
  const job = new Cron(task.cron_expression, { name: task.id, timezone: task.timezone ?? "local" }, async () => {
    await executeTask(task, db, telegram, runAgent);
  });
  activeJobs.set(task.id, job);
}
```

### Pattern 2: Task Execution — Two Paths by Type
**What:** `reminder` type → `telegram.sendMessage(userId, "🔔 Recordatorio: " + task.prompt)`. All other types (`task`, `briefing`, `pr-monitor`) → `runAgent(syntheticContext, ...)`.

**When to use:** Reminders skip LLM to reduce cost and latency for trivial notifications. Tasks need LLM because they use tools.

**Example:**
```typescript
// Source: existing runAgent signature in src/agent/agent.ts
async function executeTask(task: ScheduledTaskRow, ...): Promise<void> {
  try {
    if (task.type === "reminder") {
      await telegram.sendMessage(task.user_id, `🔔 Recordatorio: ${task.prompt}`);
    } else {
      const sessionId = memoryManager.resolveSession(task.user_id, "scheduler", 0); // 0 = always new session
      await runAgent(
        { userId: task.user_id, userName: "scheduler", channelId: "scheduler", sessionId, userMessage: task.prompt },
        llm, toolRegistry, memoryManager, soulContent, config.agent.maxIterations
      );
    }
    db.prepare("UPDATE scheduled_tasks SET last_run_at = datetime('now'), run_count = run_count + 1 WHERE id = ?").run(task.id);
  } catch (err) {
    await handleTaskError(task, err, telegram, db);
  }
}
```

### Pattern 3: Error Handling — Notify + Retry
**What:** On task failure, notify user via Telegram, set `retry_after` to now+5min. A separate retry check runs on each cron tick. If second attempt also fails, leave task active for next scheduled run.

**When to use:** All task types. Decisions locked this behavior.

```typescript
async function handleTaskError(task: ScheduledTaskRow, err: unknown, telegram: TelegramChannel, db: Database): Promise<void> {
  const errorMsg = (err as Error).message;
  await telegram.sendMessage(task.user_id, `❌ Tarea fallida: "${task.name}"\nError: ${errorMsg}\nReintentando en 5 minutos...`);
  db.prepare("UPDATE scheduled_tasks SET last_error = ?, retry_after = datetime('now', '+5 minutes') WHERE id = ?")
    .run(errorMsg, task.id);
}
```

### Pattern 4: One-Shot Reminders via maxRuns: 1
**What:** croner supports `maxRuns: 1` to fire once then stop. Alternatively, ISO datetime string as the cron expression fires at a specific moment.

**When to use:** SCHED-02 one-shot reminders. After firing, mark the task `status = 'completed'` in SQLite.

```typescript
// Source: croner docs — ISO datetime scheduling
const job = new Cron("2026-03-19T09:00:00", { timezone: "America/Bogota" }, async () => {
  await executeTask(task, ...);
  db.prepare("UPDATE scheduled_tasks SET status = 'completed' WHERE id = ?").run(task.id);
  activeJobs.get(task.id)?.stop();
  activeJobs.delete(task.id);
});
```

### Pattern 5: PR State Change Detection
**What:** Poll `/repositories/{ws}/{repo}/pullrequests` (open + recently closed) every 15 minutes. Compare each PR's `updated_on` timestamp against what's stored in `pr_states` table. If changed, fetch `/pullrequests/{id}/activity` to determine what changed (new commits, state transition, direct mention). Send targeted Telegram notification.

**When to use:** SCHED-04. The Bitbucket Cloud API `/activity` endpoint returns all events in order: updates (state changes), approvals, commits.

```typescript
// Simplified PR monitor logic — runs as built-in task every 15 minutes
async function checkPRChanges(db: Database, telegram: TelegramChannel, userId: string): Promise<void> {
  const client = new BitbucketClient();
  const openPRs = await client.listPRs(undefined, undefined, "OPEN");

  for (const pr of openPRs.values) {
    const known = db.prepare("SELECT last_updated_on, last_state FROM pr_states WHERE pr_id = ?").get(pr.id) as PrStateRow | undefined;

    if (!known) {
      // First time seeing this PR — store baseline
      db.prepare("INSERT INTO pr_states (pr_id, last_updated_on, last_state) VALUES (?, ?, ?)").run(pr.id, pr.updated_on, pr.state);
      continue;
    }

    if (pr.updated_on !== known.last_updated_on) {
      // PR changed — fetch activity to categorize what happened
      const activity = await client.getPRActivity(String(pr.id));
      const notification = buildPRNotification(pr, activity, known);
      if (notification) {
        await telegram.sendMessage(userId, notification);
      }
      db.prepare("UPDATE pr_states SET last_updated_on = ?, last_state = ? WHERE pr_id = ?").run(pr.updated_on, pr.state, pr.id);
    }
  }
}
```

### Pattern 6: Natural Language to Cron — LLM Extraction
**What:** The `create_scheduled_task` tool is called by the LLM after the LLM has already extracted cron expression + prompt from user natural language. The tool receives structured args. The soul.md prompt guides the LLM on cron extraction.

**When to use:** Every time a user asks Jarvis to schedule something.

Soul.md guidance example (add to Scheduled Tasks section):
```
## Scheduled Tasks
When users ask you to schedule something:
- Extract: what to do (prompt), when (cron expression), task name
- Cron format: "second minute hour day month weekday" (6 fields for croner)
- Examples: "every Monday at 9" → "0 0 9 * * 1", "in 2 hours" → ISO datetime
- Use create_scheduled_task tool with these extracted values
- Always confirm back: "Task created: [name] — next run: [datetime]"
- For delete, always ask for confirmation first before calling delete_scheduled_task
```

### Anti-Patterns to Avoid
- **Storing cron jobs only in memory:** Timers are lost on restart. SQLite is the source of truth; croner timers are ephemeral handles that get rebuilt on startup.
- **Running agent loop inside scheduler without session boundary:** Use `resolveSession` with `timeoutMinutes: 0` (always new session) so scheduler invocations don't contaminate user's conversation session.
- **Polling Bitbucket every minute:** API rate limits apply. 15-minute interval (locked decision) is appropriate.
- **Blocking event loop with synchronous task execution:** All task execution must be async. The croner callback is `async` — awaiting is safe because croner's `protect: true` handles overrun (next tick is skipped if current is still running).
- **Forgetting to call job.stop() on graceful shutdown:** Active croner jobs hold timers; without `.stop()` the Node.js process won't exit cleanly during `SIGTERM`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron expression parsing and scheduling | Custom `setTimeout` + regex | croner | DST transitions, month-end edge cases, leap years, second-precision — all handled |
| Natural language → cron conversion | Custom parser | LLM (it already knows cron) | LLM handles "last Friday of the month", "every weekday except Monday", etc. |
| One-shot timer countdown | `setTimeout` with persisted ms | croner ISO datetime pattern | `setTimeout` loses state on restart; croner + SQLite pattern is restart-safe |
| PR change detection webhook server | HTTP server for Bitbucket webhooks | Polling with `updated_on` comparison | Webhooks require public URL; this bot runs locally on Mac without public ingress |

**Key insight:** The project's existing Bitbucket client (`BitbucketClient`) already has all the HTTP infrastructure needed. PR monitoring only needs a new method `getPRActivity(prId)` added to the existing client, plus a new `pr_states` SQLite table.

---

## Common Pitfalls

### Pitfall 1: Scheduler Tries to Use Tools Before Tools Are Registered
**What goes wrong:** If the scheduler is initialized before `toolRegistry.register()` calls in `index.ts`, tasks that fire immediately (e.g., if `BRIEFING_TIME` is 7:00 and the bot starts at 7:00) will fail with "unknown tool" errors.
**Why it happens:** The startup sequence in `index.ts` has a specific order — tools registered, then `telegram.start()`. Scheduler must come after tool registration and before or alongside `telegram.start()`.
**How to avoid:** Initialize scheduler in `index.ts` after all tool registrations, passing the fully-configured `toolRegistry`. The CONTEXT.md specifies: "initialize scheduler after registering tools, before `telegram.start()`."
**Warning signs:** "Unknown tool: google_calendar" error in scheduler logs on startup.

### Pitfall 2: Agent Loop Sessions Bleed Between Scheduler and User
**What goes wrong:** Scheduler invokes `runAgent()` using the same session as the user's active conversation. The LLM sees briefing results in the user's chat context, or worse, user messages appear in briefing context.
**Why it happens:** `resolveSession()` returns the existing session if called within `sessionTimeoutMinutes`.
**How to avoid:** Pass `channelId: "scheduler"` (not `"telegram"`) when resolving the scheduler session. Since no user message with `channelId: "scheduler"` has ever been sent, a fresh session is always created. Alternatively pass `timeoutMinutes: 0` to force a new session every time.

### Pitfall 3: croner Job Handles Not Cleaned Up on Shutdown
**What goes wrong:** `process.exit(0)` is called in the SIGTERM handler but croner timers keep the event loop alive, causing a delayed exit or `process.exit` hanging.
**Why it happens:** croner uses `setInterval` internally; without `.stop()` the timers are not cleared.
**How to avoid:** The scheduler manager must expose a `stopAll()` method that calls `job.stop()` for every entry in `activeJobs`. Call `schedulerManager.stopAll()` in the existing SIGTERM handler in `index.ts` before `db.close()`.

### Pitfall 4: One-Shot Tasks Fire on Every Restart if Not Marked Completed
**What goes wrong:** A one-shot reminder for "tomorrow at 9am" fires correctly, but because the `scheduled_tasks` row is still `status = 'active'`, it gets re-registered at every bot restart and fires again the next time croner sees the expression match.
**Why it happens:** ISO datetime expressions in croner: once past, croner won't fire them again in the same process — but if status isn't set to `'completed'`, on next restart it tries to schedule an already-past time (croner will not fire it but it wastes a row and causes confusion).
**How to avoid:** On successful execution of a `maxRuns: 1` task (or any one-shot), immediately set `status = 'completed'` in SQLite. On startup, skip rows where `status != 'active'`.

### Pitfall 5: PR Monitor Sends Duplicate Notifications on Restart
**What goes wrong:** Bot restarts while a PR has already-detected changes. On next PR poll, `updated_on` comparison correctly shows no new change — but if `pr_states` table wasn't updated before the notification was sent, or if the bot crashes after sending but before updating the table, the same notification fires again.
**Why it happens:** Non-atomic notify-then-update sequence.
**How to avoid:** Update `pr_states` table BEFORE sending the Telegram notification (same pattern as the approval gate: write to SQLite synchronously first, then async notify). If the notification fails, the state is already saved — no duplicate.

### Pitfall 6: Morning Briefing Blocks Agent Loop for All Other Users
**What goes wrong:** The briefing runs the full agent loop (Calendar + Gmail + PRs + web search) which can take 30-60 seconds. During this time, if another user message arrives, the agent loop is blocked.
**Why it happens:** Sequential execution (locked decision) — tasks queue. This is the correct behavior, but users should know why Jarvis is slow.
**How to avoid:** This is expected behavior by design (sequential execution decision). Mitigate by keeping briefing `maxIterations` capped (e.g., 5 instead of 10) and by ensuring the briefing prompt instructs the LLM to be efficient with tool calls.

---

## Code Examples

Verified patterns from project code + croner docs:

### SQLite Migration v5 — scheduled_tasks + pr_states
```typescript
// Add to runMigrations() in src/memory/db.ts
if (currentVersion < 5) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL DEFAULT 'task',  -- 'reminder' | 'task' | 'briefing' | 'pr-monitor'
      cron_expression TEXT NOT NULL,               -- cron string OR ISO datetime for one-shot
      prompt        TEXT NOT NULL,                 -- message sent to agent (or reminder text)
      timezone      TEXT NOT NULL DEFAULT 'local',
      status        TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'completed' | 'failed'
      pre_approved  INTEGER NOT NULL DEFAULT 0,    -- 1 = approved at creation (shell tasks)
      run_count     INTEGER NOT NULL DEFAULT 0,
      last_run_at   TEXT,
      last_error    TEXT,
      retry_after   TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS pr_states (
      pr_id           INTEGER PRIMARY KEY,
      workspace       TEXT NOT NULL,
      repo_slug       TEXT NOT NULL,
      last_updated_on TEXT NOT NULL,
      last_state      TEXT NOT NULL,          -- 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'
      last_commit_hash TEXT,
      participant_states TEXT NOT NULL DEFAULT '{}',  -- JSON: {username: 'approved'|'changes-requested'}
      checked_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.pragma("user_version = 5");
}
```

### croner — Register Job from DB Row
```typescript
// Source: croner docs (croner.56k.guru)
import { Cron } from "croner";

const activeJobs = new Map<string, Cron>();

function registerJob(task: ScheduledTaskRow, executeTask: (t: ScheduledTaskRow) => Promise<void>): void {
  if (activeJobs.has(task.id)) {
    activeJobs.get(task.id)!.stop();
  }
  const job = new Cron(
    task.cron_expression,
    {
      name: task.id,
      timezone: task.timezone === "local" ? undefined : task.timezone,
      protect: true,       // Skip tick if previous run is still in progress
      paused: task.status === "paused",
    },
    async () => {
      await executeTask(task);
    }
  );
  activeJobs.set(task.id, job);
}

function stopAll(): void {
  for (const [, job] of activeJobs) {
    job.stop();
  }
  activeJobs.clear();
}
```

### Briefing Prompt Template
```typescript
// Sent as synthetic agent message — LLM receives this as "userMessage"
const briefingPrompt = (topics: string) =>
  `Generate the morning briefing. Use these tools in order:
1. google_calendar: action=list_events for today
2. google_gmail: action=list with is:unread filter
3. bitbucket_prs: action=list_prs state=OPEN
4. web_search: query="latest news ${topics}"

Format the briefing as a single message with exactly these sections:
📅 *Agenda*
📧 *Emails*
🔀 *PRs*
📰 *Noticias*

Keep total under 300 words. Be concise and direct.`;
```

### Tool: create_scheduled_task (Agent-Facing)
```typescript
// Registered in toolRegistry — called by LLM after extracting cron + prompt
const createScheduledTaskTool: Tool = {
  definition: {
    name: "create_scheduled_task",
    description: "Create a scheduled task or reminder. The LLM must extract cron expression from user natural language before calling this.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable task name" },
        type: { type: "string", description: "Task type: 'reminder' | 'task'", enum: ["reminder", "task"] },
        cron_expression: { type: "string", description: "Standard cron expression (6 fields: sec min hour day month weekday) OR ISO datetime for one-shot" },
        prompt: { type: "string", description: "What to execute: reminder text or agent instruction" },
        timezone: { type: "string", description: "IANA timezone, e.g. 'America/Bogota'. Defaults to system timezone." },
      },
      required: ["name", "type", "cron_expression", "prompt"],
    },
  },
  async execute(args, context): Promise<ToolResult> {
    // ... validate, insert into scheduled_tasks, register croner job
  },
};
```

### BitbucketClient Extension — getPRActivity
```typescript
// Add to src/tools/bitbucket-api.ts
export interface BitbucketActivity {
  update?: { state: string; changes?: { status?: { old: string; new: string } } };
  approval?: { user: { display_name: string } };
  comment?: { content: { raw: string }; user: { display_name: string } };
}

async getPRActivity(prId: string, workspace?: string, repoSlug?: string): Promise<{ values: BitbucketActivity[] }> {
  const ws = resolveWorkspace(workspace);
  const repo = resolveRepo(repoSlug);
  const res = await request(`/repositories/${ws}/${repo}/pullrequests/${prId}/activity`);
  return res.json() as Promise<{ values: BitbucketActivity[] }>;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| node-cron (CommonJS-only) | croner (ESM-first, dual CJS/ESM) | croner v5+ | Full ESM compatibility for projects using `"type": "module"` |
| Custom setTimeout for one-shot | croner ISO datetime expression | croner v8+ | Restart-safe with SQLite, no manual ms calculation |
| Polling with setInterval directly | croner with protect:true | Always best practice | Prevents concurrent overlapping task execution automatically |

**Deprecated/outdated:**
- `node-cron` v4.x: No `.pause()`, no `nextRun()`, no ESM-native support — adequate but croner is strictly better for this stack.

---

## Open Questions

1. **Bitbucket Activity Endpoint — Exact Response Schema**
   - What we know: `/repositories/{ws}/{repo}/pullrequests/{id}/activity` exists and returns events for comments, approvals, updates, commits (confirmed from multiple Atlassian community posts and Bitbucket docs references)
   - What's unclear: The exact JSON shape of "commit pushed" events vs "approval" events vs "state update" events. The existing `BitbucketClient` will need empirical testing against a real PR to validate the activity response fields before the `getPRActivity` method can be finalized.
   - Recommendation: Add `getPRActivity` returning raw JSON initially; implementer should `console.log` a real response against a known PR to confirm fields, then add typed interfaces. This is LOW risk — if the endpoint structure differs, only the change-detection logic needs updating, not the scheduler itself.

2. **Direct Mention Detection in PR Comments**
   - What we know: PR comments include `content.raw` text. A user mention in Bitbucket is `@username`.
   - What's unclear: Bitbucket's mention format in the API — whether mentions are `@username`, `@{uuid}`, or `@display_name` in raw text.
   - Recommendation: Implement mention detection as a string search for `@` + the configured `BITBUCKET_EMAIL` prefix or display name. The CONTEXT.md marks this as "Claude's Discretion" — implement as best-effort string match and refine if needed.

3. **Timezone Handling for Morning Briefing**
   - What we know: croner accepts IANA timezone strings. The briefing time is configurable.
   - What's unclear: Where the user's timezone is stored. No timezone config exists in `config.ts` yet.
   - Recommendation: Add `SCHEDULER_TIMEZONE` env var to `config.ts` (default: system timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`). The built-in briefing task reads this env var at startup.

---

## Validation Architecture

`nyquist_validation` is enabled (per `.planning/config.json`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test files or config found |
| Config file | none — Wave 0 must create |
| Quick run command | `npx tsx --test src/**/*.test.ts` (Node built-in test runner via tsx) |
| Full suite command | `npm run typecheck && npx tsx --test src/**/*.test.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCHED-01 | `create_scheduled_task` tool inserts row + registers croner job | unit | `npx tsx --test src/scheduler/scheduler-manager.test.ts` | ❌ Wave 0 |
| SCHED-01 | Scheduler reloads tasks from DB on restart | unit | `npx tsx --test src/scheduler/scheduler-manager.test.ts` | ❌ Wave 0 |
| SCHED-02 | One-shot task sets `status='completed'` after firing | unit | `npx tsx --test src/scheduler/scheduler-manager.test.ts` | ❌ Wave 0 |
| SCHED-02 | Reminder sends direct Telegram message (no agent loop) | unit | `npx tsx --test src/scheduler/scheduler-manager.test.ts` | ❌ Wave 0 |
| SCHED-03 | Briefing built-in task exists in DB after startup | integration | `npx tsx --test src/scheduler/scheduler-manager.test.ts` | ❌ Wave 0 |
| SCHED-03 | Briefing prompt includes all 4 section headers | unit | `npx tsx --test src/scheduler/briefing.test.ts` | ❌ Wave 0 |
| SCHED-04 | PR state change detection fires notification | unit | `npx tsx --test src/scheduler/pr-monitor.test.ts` | ❌ Wave 0 |
| SCHED-04 | Failed task sends Telegram error notification | unit | `npx tsx --test src/scheduler/scheduler-manager.test.ts` | ❌ Wave 0 |

*Note: The project has no test infrastructure yet. These tests use Node.js built-in test runner (available since Node 18) invoked via tsx for TypeScript support — zero new test-framework dependencies.*

### Sampling Rate
- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run typecheck && npx tsx --test src/scheduler/*.test.ts`
- **Phase gate:** All tests green + live Telegram smoke test before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/scheduler/scheduler-manager.test.ts` — covers SCHED-01, SCHED-02, SCHED-04 error handling
- [ ] `src/scheduler/briefing.test.ts` — covers SCHED-03 prompt structure
- [ ] `src/scheduler/pr-monitor.test.ts` — covers SCHED-04 change detection logic
- [ ] No `vitest.config.*` or `jest.config.*` needed — using Node built-in test runner

---

## Sources

### Primary (HIGH confidence)
- croner.56k.guru — API, features, ESM support, TypeScript types, `maxRuns`, timezone, `.stop()`/`.pause()`
- `npm view croner` registry — version 10.0.1, published 2026-02-21
- `src/memory/db.ts` (project source) — migration pattern, existing schema through v4
- `src/agent/agent.ts` (project source) — `runAgent()` signature for scheduler invocation
- `src/channels/telegram.ts` (project source) — `sendMessage()`, `broadcast()` API
- `src/tools/bitbucket-api.ts` (project source) — `BitbucketClient` for extension

### Secondary (MEDIUM confidence)
- BetterStack "Best Node.js schedulers" — croner vs node-cron vs node-schedule comparison
- Atlassian community threads — `/pullrequests/{id}/activity` endpoint existence and content types (comments, approvals, updates, commits confirmed)
- reintech.io Bitbucket API guide — `updated_on` field as change detection key

### Tertiary (LOW confidence)
- Bitbucket activity response JSON schema — not directly verified; inferred from community docs + API reference structure. Implementer must validate empirically against live API.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — croner version verified via npm registry, library API verified via official docs
- Architecture patterns: HIGH — patterns derived from existing project code + croner official docs
- SQLite schema: HIGH — follows established migration pattern from db.ts
- PR monitoring: MEDIUM — `updated_on` polling strategy confirmed; activity endpoint field schema not directly observed (LOW for field names specifically)
- Pitfalls: HIGH — derived from reading actual project code and understanding the existing patterns

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (croner stable, Bitbucket API stable)
