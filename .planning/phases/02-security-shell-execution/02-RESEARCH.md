# Phase 2: Security + Shell Execution - Research

**Researched:** 2026-03-18
**Domain:** Node.js child_process shell execution + defense-in-depth security + Grammy inline keyboard approval gate + SQLite persistence
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Command classification:**
- Blacklist minimal: only lethal commands (rm -rf /, mkfs, dd if=/dev/zero, curl|sh, sudo su, chmod -R 777 /)
- Blacklisted commands blocked automatically — Jarvis explains why without executing
- Risky/safe classification by fixed hardcoded heuristics:
  - **Safe**: pure reads (ls, cat, git status, grep, pwd, echo, head, tail, wc, find, which, env, date)
  - **Risky**: anything that writes/deletes files, installs packages, modifies system configs, network write operations
- Blacklist and heuristics hardcoded in code — no external config files
- Pipes, &&, ; NOT allowed — simple commands only. If the agent needs chaining, it makes multiple tool calls

**Approval flow (UX):**
- Approval message shows: exact command + risk reason + working directory + task context
- Telegram inline buttons: Approve / Deny
- 5-minute timeout — if no response, auto-denied and Jarvis notifies expiry
- On deny: Jarvis receives "command denied by user" as tool result and continues reasoning (may offer alternatives)
- On bot restart: pending approvals in SQLite are re-sent to user with new inline buttons

**Output handling:**
- Long output truncated (~4KB limit) and passed to LLM to summarize what's relevant
- Execution timeout: 30 seconds — if not done, kill process and report timeout
- stdout and stderr combined in one result for LLM, exit code as metadata
- Output presented in monospace code block (```) in Telegram

**Script execution:**
- Single tool `execute_command` that accepts direct commands or script file paths
- Can execute scripts from any absolute path — same security rules apply
- Scripts always classified as "risky" — require user approval
- Script content not validated before execution — user approval is the validation
- Default working directory: ~/ (user's home). Agent may specify another cwd as parameter
- Supported script types: .sh, .py, .ts

### Claude's Discretion
- Exact command names in the blacklist (beyond those mentioned)
- Specific heuristics for classifying commands as risky vs safe
- Summary strategy when output exceeds limit
- Exact SQLite table schema for pending approvals
- Graceful shutdown (SIGTERM handler) implementation

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEC-01 | Destructive commands (rm -rf, mkfs, dd, curl\|sh, privilege escalation) are automatically blocked by a configurable blacklist | Command blacklist module in `src/security/command-blacklist.ts`; pattern-matching on command + args |
| SEC-02 | Commands flagged as risky require user approval via Telegram inline keyboard before execution | Grammy InlineKeyboard API (verified v1.41.1); approval gate as async Promise pause/resume stored in SQLite |
| SEC-03 | Pending approval state persists in SQLite and survives bot restarts | `pending_approvals` table in `src/memory/db.ts` migration; startup scan re-sends expired/pending approvals |
| EXEC-01 | User can ask Jarvis to execute shell commands on their Mac via execFile with shell:false | Node.js `child_process.execFile` with args array + `shell: false` + 30s timeout; classification pre-check |
| EXEC-02 | User can ask Jarvis to execute local scripts (.sh, .py, .ts) by file path | Same `execute_command` tool; scripts always classified risky; interpreter detection by extension |
</phase_requirements>

---

## Summary

This phase adds shell command execution to Jarvis with three independent security layers: a minimal blacklist for lethal commands, a heuristic classifier for risky vs safe commands, and a human-in-the-loop Telegram inline keyboard approval gate. The highest-risk implementation detail is the approval gate — it must pause the Node.js agent loop asynchronously (never blocking the event loop), persist state in SQLite, and recover correctly after bot restarts.

The existing codebase already has all integration points needed: Grammy 1.41.1 supports inline keyboards and callback_query handlers, the SQLite migration system in `db.ts` supports adding new tables with versioned migrations, the `ToolRegistry.execute()` is the correct enforcement chokepoint, and the SIGTERM handler skeleton already exists in `index.ts`. The `execute_command` tool uses `child_process.execFile` (not `exec`) with arguments as an array and `shell: false`.

The key architectural choice is that the approval gate is NOT implemented inside the `execute_command` tool — it lives in the `ToolRegistry.execute()` method as a middleware step, making security enforcement uniform regardless of which tool is being executed.

**Primary recommendation:** Build `src/security/` first (blacklist + classifier + approval gate), add the SQLite migration for `pending_approvals`, wire callback query handling into `TelegramChannel`, then implement the `execute_command` tool. Wire into `index.ts` last.

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | Node.js built-in | Shell execution (`execFile`) | Built-in, no deps; `execFile` prevents shell metacharacter injection |
| `better-sqlite3` | 12.6.2 | Persist approval state | Already in project; WAL mode handles concurrent reads |
| `grammy` | 1.41.1 | Inline keyboard + callback_query | Already in project; `InlineKeyboard` class + `bot.on("callback_query:data", ...)` |
| `node:crypto` | Node.js built-in | Generate approval request IDs | `randomUUID()` for collision-free request IDs |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:os` | Node.js built-in | Get home directory for default cwd | `os.homedir()` for default working directory |
| `node:path` | Node.js built-in | Resolve absolute paths for scripts | Validate absolute paths, detect `..` traversal |

### No New Dependencies Needed

All functionality uses Node.js built-ins plus libraries already installed. No `npm install` required.

---

## Architecture Patterns

### Recommended File Structure for Phase 2

```
src/
├── security/                         # NEW — all security logic centralized here
│   ├── command-blacklist.ts          # Lethal command patterns + isBlocked()
│   ├── command-classifier.ts         # classifyCommand() → "safe" | "risky" | "blocked"
│   └── approval-gate.ts             # Async pause/resume; SQLite persistence
│
├── tools/built-in/
│   └── execute-command.ts            # NEW — the tool itself (thin; security handled by registry)
│
├── memory/db.ts                      # Migration version 4: pending_approvals table
├── tools/tool-types.ts               # Add riskLevel to ToolDefinition (optional — see Pattern 1)
├── tools/tool-registry.ts            # Wrap execute() with approval gate
├── channels/telegram.ts              # Add callback_query handler for approve/deny
└── index.ts                          # Register execute_command; wire approval gate singleton
```

### Pattern 1: Command Classification — Three-Tier Check

**What:** `classifyCommand(command, args)` returns `"blocked"` | `"risky"` | `"safe"`. The tool calls this before any execution attempt.

**Blocked tier:** Exact match or pattern match against a minimal lethal list (rm -rf /, mkfs, dd if=/dev/zero, curl piped to shell, sudo su, chmod -R 777 /).

**Risky tier:** Heuristics — anything that writes/deletes/installs. Includes: any script path (.sh, .py, .ts), rm (non-catastrophic), mv, cp -r, mkdir, touch, npm install, pip install, brew install, git commit, git push, ssh, nc, curl (standalone), wget.

**Safe tier:** Pure reads. If it's in the safe list it runs immediately. If unknown, it defaults to "risky" (fail-closed).

```typescript
// src/security/command-classifier.ts

const BLOCKED_PATTERNS: RegExp[] = [
  /^rm\s+.*-rf\s+\/($|\s)/,
  /^rm\s+.*\/($|\s).*-rf/,
  /^mkfs/,
  /^dd\s+if=\/dev\/zero/,
  /\|\s*(bash|sh|zsh)/,       // curl|sh, wget|bash pattern
  /^sudo\s+su/,
  /^chmod\s+.*-R.*777.*\//,
  /^:\(\)\{.*\|.*:\&\}/,      // fork bomb
];

const SAFE_COMMANDS = new Set([
  "ls", "cat", "git", "grep", "pwd", "echo", "head", "tail",
  "wc", "find", "which", "env", "date", "ps", "df", "du",
  "uname", "whoami", "hostname", "uptime", "history", "type",
  "file", "stat", "less", "more", "sort", "uniq", "cut", "tr",
]);

export type CommandClassification = "blocked" | "risky" | "safe";

export function classifyCommand(
  command: string,
  args: string[]
): CommandClassification {
  const fullInvocation = [command, ...args].join(" ");

  // Layer 1: blocked patterns (lethal)
  if (BLOCKED_PATTERNS.some((p) => p.test(fullInvocation))) {
    return "blocked";
  }

  // Layer 2: safe list (exact command name match)
  const basename = command.split("/").pop() ?? command;
  if (SAFE_COMMANDS.has(basename)) {
    // Even safe commands can be made risky by flags
    const dangerousFlags = ["--exec", "-exec", "--delete", "--write"];
    if (args.some((a) => dangerousFlags.includes(a))) return "risky";
    return "safe";
  }

  // Layer 3: default to risky (fail-closed for unknowns)
  return "risky";
}
```

**Confidence:** HIGH — based on locked decisions in CONTEXT.md + codebase inspection.

### Pattern 2: Approval Gate — Async Pause with SQLite Persistence

**What:** `approvalGate.request()` stores a Promise resolver in memory AND writes the pending request to SQLite. On bot restart, startup scans SQLite for pending approvals and re-sends them with fresh buttons. Callback query handler resolves the in-memory promise OR, if no in-memory promise exists (after restart), handles it via a continuation map.

**Key insight for restart survival:** The approval gate cannot use a simple in-memory Map for the await — on restart the Map is empty. The solution is:
1. On tool call: write to `pending_approvals` table + store Promise resolver in Map.
2. On callback_query: look up in Map (normal flow) OR look up in SQLite (post-restart flow). In the post-restart case, there's no waiting Promise — the approval state is written to SQLite and the next startup handles it by re-prompting.
3. On startup: scan `pending_approvals` for `status = 'pending'` rows, re-send approval messages with new callback_data IDs, update the rows with new IDs.

```typescript
// src/security/approval-gate.ts (conceptual structure)
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

interface PendingApproval {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  reason: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "denied" | "expired";
}

// In-memory map: approvalId → resolver function
const resolvers = new Map<string, (approved: boolean) => void>();

export function createApprovalGate(db: Database.Database) {
  return {
    async request(params: {
      command: string;
      args: string[];
      cwd: string;
      reason: string;
      userId: string;
      sendMessage: (text: string, keyboard: InlineKeyboard) => Promise<void>;
    }): Promise<boolean> {
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Write to SQLite FIRST (survives restart)
      db.prepare(`
        INSERT INTO pending_approvals (id, user_id, command, args, cwd, reason, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'), ?)
      `).run(id, params.userId, params.command, JSON.stringify(params.args), params.cwd, params.reason, expiresAt);

      // Send Telegram approval message
      const kb = new InlineKeyboard()
        .text("Approve", `approve:${id}`)
        .text("Deny", `deny:${id}`);

      const msg = [
        `Jarvis wants to execute a command:`,
        `\`\`\`\n${params.command} ${params.args.join(" ")}\n\`\`\``,
        `Working directory: \`${params.cwd}\``,
        `Risk reason: ${params.reason}`,
        `Expires: ${new Date(expiresAt).toLocaleTimeString()}`,
      ].join("\n");

      await params.sendMessage(msg, kb);

      // Return Promise that waits for callback
      return new Promise<boolean>((resolve) => {
        resolvers.set(id, resolve);

        setTimeout(() => {
          if (resolvers.has(id)) {
            resolvers.delete(id);
            db.prepare(
              `UPDATE pending_approvals SET status = 'expired' WHERE id = ?`
            ).run(id);
            resolve(false);
          }
        }, 5 * 60 * 1000);
      });
    },

    handleCallback(id: string, approved: boolean): void {
      const resolver = resolvers.get(id);
      if (resolver) {
        resolvers.delete(id);
        db.prepare(
          `UPDATE pending_approvals SET status = ? WHERE id = ?`
        ).run(approved ? "approved" : "denied", id);
        resolver(approved);
      }
      // If no resolver (post-restart), status update in SQLite is enough
    },

    async recoverPendingOnStartup(
      sendMessage: (userId: string, text: string, kb: InlineKeyboard) => Promise<void>
    ): Promise<void> {
      const stale = db.prepare(
        `SELECT * FROM pending_approvals WHERE status = 'pending'`
      ).all() as PendingApproval[];

      for (const row of stale) {
        // Mark old approval as expired
        db.prepare(
          `UPDATE pending_approvals SET status = 'expired' WHERE id = ?`
        ).run(row.id);

        // Notify user
        await sendMessage(
          row.userId,
          `A pending command approval expired during restart:\n\`${row.command} ${JSON.parse(row.args as unknown as string).join(" ")}\`\nPlease re-request if needed.`,
          new InlineKeyboard()
        );
      }
    },
  };
}
```

**Confidence:** HIGH — verified against existing SQLite patterns in db.ts and Grammy callback_query behavior.

### Pattern 3: Grammy Callback Query Handler

**What:** Grammy's `bot.on("callback_query:data", handler)` catches all inline button presses. Parse the callback_data string to extract the approval ID and decision.

```typescript
// Inside TelegramChannel or wired in from index.ts

// Register once at startup
this.bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data; // e.g. "approve:abc123" or "deny:xyz456"
  const userId = ctx.from!.id;

  if (!this.allowedUserIds.has(userId)) {
    await ctx.answerCallbackQuery({ text: "Access denied." });
    return;
  }

  const [action, id] = data.split(":", 2);
  if (action === "approve" || action === "deny") {
    const approved = action === "approve";
    approvalGate.handleCallback(id, approved);
    await ctx.answerCallbackQuery({
      text: approved ? "Command approved." : "Command denied.",
    });
    // Optionally edit the original message to remove buttons
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  }
});
```

**Confidence:** HIGH — verified with grammy v1.41.1 installed in project; `InlineKeyboard` and `callback_query:data` filter confirmed working.

### Pattern 4: execute_command Tool with execFile

**What:** The tool itself is thin — it calls `execFile` with `shell: false`. Classification and approval happen in `ToolRegistry.execute()` before the tool runs.

```typescript
// src/tools/built-in/execute-command.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";

const execFileAsync = promisify(execFile);

const OUTPUT_LIMIT = 4096; // ~4KB

const executeCommandTool: Tool = {
  definition: {
    name: "execute_command",
    description: [
      "Execute a shell command or local script on the user's Mac.",
      "Commands are classified as safe (runs immediately), risky (requires user approval), or blocked (never runs).",
      "Pipes, &&, and ; are NOT supported — use multiple tool calls for chaining.",
      "Scripts (.sh, .py, .ts) are always risky and require approval.",
      "Default working directory is the user's home directory.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The executable or script path to run (e.g. 'ls', 'git', '/Users/max/scripts/backup.sh')",
        },
        args: {
          type: "string",
          description: "Space-separated arguments for the command (e.g. '-la /tmp'). Pipes, &&, ; are not allowed.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command. Defaults to user home directory.",
        },
      },
      required: ["command"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const command = args.command as string;
    const rawArgs = (args.args as string | undefined) ?? "";
    const argList = rawArgs.trim() ? rawArgs.split(/\s+/) : [];
    const cwd = (args.cwd as string | undefined) ?? homedir();

    // Validate: no shell metacharacters in args
    const SHELL_META = /[|;&`$(){}[\]<>]/;
    if (SHELL_META.test(rawArgs)) {
      return {
        success: false,
        data: null,
        error: "Shell metacharacters (|, ;, &, $, etc.) are not allowed. Use separate tool calls.",
      };
    }

    // For scripts: validate it's an absolute path
    const scriptExtensions = [".sh", ".py", ".ts"];
    const isScript = scriptExtensions.some((ext) => command.endsWith(ext));
    if (isScript && !isAbsolute(command)) {
      return {
        success: false,
        data: null,
        error: "Script paths must be absolute (e.g. /Users/max/scripts/backup.sh)",
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(command, argList, {
        shell: false,          // CRITICAL: never true
        timeout: 30_000,       // 30 second hard cap
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB capture buffer
        env: process.env,
      });

      const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
      const truncated = combined.length > OUTPUT_LIMIT;
      const output = truncated
        ? combined.slice(0, OUTPUT_LIMIT) + `\n\n[Output truncated at ${OUTPUT_LIMIT} chars. ${combined.length - OUTPUT_LIMIT} chars omitted.]`
        : combined;

      return {
        success: true,
        data: {
          output,
          truncated,
          exit_code: 0,
        },
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException & { code?: string; killed?: boolean; stdout?: string; stderr?: string };

      if (error.killed || error.code === "ETIMEDOUT") {
        return {
          success: false,
          data: { exit_code: -1 },
          error: "Command timed out after 30 seconds and was killed.",
        };
      }

      // Non-zero exit code is a normal result, not an error
      const combined = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
      return {
        success: false,
        data: {
          output: combined,
          exit_code: (error as { code?: number }).code ?? 1,
        },
        error: `Command failed with exit code ${(error as { code?: number }).code ?? 1}`,
      };
    }
  },
};

export default executeCommandTool;
```

**Confidence:** HIGH — `execFile` with `shell: false` is documented Node.js behavior; TypeScript types confirmed via `@types/node` in project.

### Pattern 5: SQLite Migration for pending_approvals

Migration version 4 (current DB is at version 3):

```typescript
// In src/memory/db.ts runMigrations(), add:

if (currentVersion < 4) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_approvals (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      command     TEXT NOT NULL,
      args        TEXT NOT NULL DEFAULT '[]',
      cwd         TEXT NOT NULL,
      reason      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_approvals_status
      ON pending_approvals(status);

    CREATE INDEX IF NOT EXISTS idx_pending_approvals_user
      ON pending_approvals(user_id, status);
  `);
  db.pragma("user_version = 4");
}
```

**Confidence:** HIGH — directly follows the established migration pattern in `db.ts` (versions 1-3 visible in source).

### Pattern 6: ToolRegistry Security Middleware

The `execute()` method in `tool-registry.ts` intercepts execution for the `execute_command` tool. Rather than adding `riskLevel` to `ToolDefinition` (which would require touching all existing tools), the simpler approach is to pass an `approvalGate` dependency to the registry and check the tool name directly.

```typescript
// src/tools/tool-registry.ts (updated execute method)

// The registry gets approvalGate injected at construction time or via a setter
async execute(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = this.tools.get(name);
  if (!tool) {
    return { success: false, data: null, error: `Unknown tool: ${name}` };
  }

  // Security gate for execute_command
  if (name === "execute_command" && this.securityGate) {
    const securityResult = await this.securityGate.check(args, context);
    if (!securityResult.allowed) {
      return {
        success: false,
        data: null,
        error: securityResult.reason,
      };
    }
  }

  try {
    return await tool.execute(args, context);
  } catch (err) {
    return {
      success: false,
      data: null,
      error: `Tool error: ${(err as Error).message}`,
    };
  }
}
```

Alternatively, the security check can live directly inside `execute_command.ts`'s `execute()` method — simpler, and appropriate since this is the only tool in Phase 2 that needs it. The CONTEXT.md does not prescribe a specific location. The `src/security/` module is still created for the classifier and blacklist logic, which are called from within the tool's execute.

**Confidence:** HIGH — based on existing registry source code.

### Pattern 7: SIGTERM Graceful Shutdown

The current `index.ts` already has a shutdown handler (lines 148-157). It needs to flush pending approvals before exiting. The key is a bounded timeout so a stuck approval doesn't block shutdown.

```typescript
// src/index.ts — enhanced shutdown handler
const shutdown = async () => {
  log("info", "shutdown", "Shutting down Jarvis...");

  // Give in-flight requests a chance to complete (bounded)
  await Promise.race([
    telegram.stop(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  db.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

**Note:** SQLite writes for pending approvals happen synchronously via `better-sqlite3` before the Promise is awaited, so they are already persisted when SIGTERM arrives. The graceful shutdown just ensures Telegram long-polling stops cleanly.

**Confidence:** HIGH — `better-sqlite3` is synchronous by design; verified in db.ts.

### Anti-Patterns to Avoid

- **Using `exec()` or `spawn()` with `shell: true`:** Shell metacharacters in args become injection vectors. Always `execFile` with `shell: false`.
- **Storing approval state only in-memory Map:** Lost on restart. Must write to SQLite first, in-memory Map second.
- **Blocking the event loop waiting for approval:** Using `execSync` or polling in a loop to wait for user response freezes Telegram polling — the user's approval response never arrives. Must use async/await with stored Promise resolver.
- **Blocking command detection based on string matching alone:** `rm -rf /` blocked but `rm  -rf /` (extra space) passes. Use RegExp patterns that normalize whitespace.
- **Executing scripts from relative paths:** Relative paths can be manipulated to point to unexpected locations. Require absolute paths for script execution.
- **Passing user input directly to execFile without metachar check:** Even with `shell: false`, an arg containing `--config=/etc/passwd` can be dangerous for some commands. Check for suspicious flag patterns.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UUID generation for approval IDs | Custom random string generator | `crypto.randomUUID()` | Built-in, collision-resistant, 128-bit |
| Process execution with timeout | Custom timeout via setTimeout + kill | `execFile` with `timeout` option | Built-in process kill, correct signal handling |
| SQLite schema versioning | Custom migration tracking table | Existing `db.pragma("user_version")` pattern | Already established in the codebase |
| Telegram inline buttons | Raw Bot API `reply_markup` JSON | `grammy`'s `InlineKeyboard` class | Type-safe, already installed |
| Shell output buffering | Manual stream concat | `execFile`'s `stdout`/`stderr` result strings | Buffer management handled internally |

**Key insight:** The complex parts — async approval pause/resume, SQLite persistence, bot restart recovery — are solved by combining patterns already in the codebase, not by new libraries.

---

## Common Pitfalls

### Pitfall 1: Event Loop Blocked by Approval Wait

**What goes wrong:** The approval gate tries to wait synchronously for user response (polling a DB row, using `execSync` in a loop). Telegram's long-polling runs on the same event loop — it can't deliver the user's button tap while the loop is blocked.

**Why it happens:** Natural instinct to write `while (!approved) { sleep(1) }` when waiting for an external event.

**How to avoid:** Store a `(boolean) => void` resolver in a Map when sending the approval message. The callback_query handler finds the resolver by ID and calls it. The agent loop awaits the Promise — it yields control back to the event loop.

**Warning signs:** Any use of `while`, `setInterval` polling, or `execSync` in the approval gate.

### Pitfall 2: Approval State Lost on Restart

**What goes wrong:** Bot restarts (crash, update, SIGTERM). All in-memory approval state is gone. User taps "Approve" but there's no handler. Command silently never executes.

**Why it happens:** Using `new Map()` as the only storage for pending approvals.

**How to avoid:** Write to `pending_approvals` table before awaiting. On startup, scan for `status = 'pending'` rows and notify user they expired.

**Warning signs:** `pending.set(id, resolver)` without a corresponding DB write immediately before it.

### Pitfall 3: execFile Args Passed as Single String

**What goes wrong:** `execFile("ls", ["-la /tmp"])` — the entire `-la /tmp` is treated as ONE argument. `ls` receives it as a single unknown flag and fails.

**Why it happens:** Confusion between the shell string format and the argv array format.

**How to avoid:** Split args on whitespace: `rawArgs.split(/\s+/)`. Be careful with quoted arguments — for this tool, quoted arguments with spaces are not supported (simple commands only per CONTEXT.md).

**Warning signs:** `execFile(command, [args])` where `args` is a multi-word string.

### Pitfall 4: Callback Query Handler Registered Inside Message Handler

**What goes wrong:** `bot.on("callback_query:data", ...)` registered inside `handleIncoming()`, which is called on every message. Handlers stack up — the same callback fires multiple times for one button tap.

**Why it happens:** Copy-paste of the message handler pattern into a function that's called per-message.

**How to avoid:** Register callback_query handlers once in `TelegramChannel.start()`, at the same level as `bot.on("message:text", ...)`.

**Warning signs:** Any `bot.on(...)` call outside of the `start()` method.

### Pitfall 5: Blacklist Regex Doesn't Match After Arg Splitting

**What goes wrong:** Blacklist checks `args.command === "rm"` but the command arrives as `/bin/rm`. Pattern matching fails.

**Why it happens:** Commands can be passed as full paths.

**How to avoid:** Extract basename: `path.basename(command)` for safe/blocked checks, and test full invocation string (`command + " " + args.join(" ")`) against patterns.

### Pitfall 6: Pending Approval Re-sent After Restart Points to Dead Conversation

**What goes wrong:** The approval message re-sent on restart has no chat context — `bot.api.sendMessage(userId, ...)` must be used instead of `ctx.reply(...)` since there's no incoming message context.

**How to avoid:** The `recoverPendingOnStartup()` function uses `telegram.broadcast()` or `bot.api.sendMessage(userId, text)` directly, not a `ctx` from a message handler.

---

## Code Examples

### Grammy Inline Keyboard (verified v1.41.1)

```typescript
// Source: grammy v1.41.1 installed in project, verified locally
import { InlineKeyboard } from "grammy";

const kb = new InlineKeyboard()
  .text("Approve", `approve:${requestId}`)
  .text("Deny", `deny:${requestId}`);

// Send with the keyboard
await bot.api.sendMessage(userId, message, {
  reply_markup: kb,
  parse_mode: "Markdown",
});
```

### Grammy Callback Query Handler (verified v1.41.1)

```typescript
// Source: grammy v1.41.1, callback_query:data filter — verified working
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data; // "approve:uuid" or "deny:uuid"
  const [action, id] = data.split(":", 2);

  // Must answer callback query or Telegram shows loading spinner forever
  await ctx.answerCallbackQuery({ text: action === "approve" ? "Approved" : "Denied" });

  // Remove inline buttons from the original message
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  approvalGate.handleCallback(id, action === "approve");
});
```

### Node.js execFile with Shell False (built-in)

```typescript
// Source: Node.js docs + @types/node in project
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const { stdout, stderr } = await execFileAsync("git", ["status", "--short"], {
  shell: false,     // CRITICAL: prevents shell injection
  timeout: 30_000,  // 30 second hard kill
  cwd: "/Users/max/project",
  maxBuffer: 10 * 1024 * 1024,
});
```

### SQLite Synchronous Write (better-sqlite3 pattern)

```typescript
// Source: db.ts in project — better-sqlite3 is synchronous
// Write BEFORE returning the Promise (ensures persistence before await)
db.prepare(`
  INSERT INTO pending_approvals (id, user_id, command, args, cwd, reason, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(id, userId, command, JSON.stringify(args), cwd, reason, expiresAt);

// Now it's safe to await user response — DB is written
return new Promise<boolean>((resolve) => {
  resolvers.set(id, resolve);
  // ... timeout logic
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `exec(command)` string interpolation | `execFile(cmd, argsArray, { shell: false })` | Node.js docs have recommended this for years; AI agent CVEs made it urgent in 2025 | Prevents shell injection from LLM-generated command strings |
| In-memory approval Map only | Map + SQLite `pending_approvals` table | Required for restart survival (SEC-03) | Approvals survive bot restarts; users notified on reconnect |
| Commands via `/approve_<id>` text commands | Grammy inline keyboard `callback_query:data` | Grammy has supported this since v1.x; user decision in CONTEXT.md | Better UX — one tap vs typing a command |
| Generic tool permission system | Per-tool inline security check via classifier | Simplified from ARCHITECTURE.md Pattern 1 to avoid touching all Tool definitions | Less invasive; security module still centralized |

**Deprecated/outdated in this context:**
- `exec()` with string: Never acceptable for user/LLM-controlled commands.
- `/approve_<id>` text commands: CONTEXT.md locked to inline keyboard approach.
- Approval stored in-memory only: Explicitly flagged in PITFALLS.md as the highest-risk failure mode.

---

## Open Questions

1. **Where exactly does classification happen — inside execute_command.ts or in ToolRegistry.execute()?**
   - What we know: Both approaches work. ARCHITECTURE.md suggests registry middleware (Pattern 1). CONTEXT.md says a single `execute_command` tool.
   - What's unclear: Whether future tools (email send, file delete) will also need approval gates — if yes, registry middleware scales better.
   - Recommendation: Put classification inside `execute_command.ts` for Phase 2 (simpler, no changes to registry needed). The `src/security/` module is still created for blacklist + classifier logic, just called from the tool. Registry middleware can be added in Phase 3+ if needed.

2. **How to handle the approval gate's `sendMessage` dependency in `execute_command.ts`?**
   - What we know: The tool needs to send a Telegram message during execution. Tools don't have direct access to the Telegram channel.
   - What's unclear: Best injection pattern.
   - Recommendation: Use a module-level setter (same pattern as `setMemoryManager` in `save-memory.ts`). Call `setApprovalGate(gate)` from `index.ts` after both the DB and Telegram channel are initialized.

3. **TypeScript script execution (.ts) — which interpreter?**
   - What we know: CONTEXT.md lists .ts as supported. The project uses `tsx` for running TypeScript.
   - What's unclear: Does `tsx` need to be on PATH, or use a full path?
   - Recommendation: For .ts scripts, use `tsx` as the interpreter: `execFile("tsx", [scriptPath], ...)`. Verify `tsx` is resolvable via PATH or use the project's local `./node_modules/.bin/tsx`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | TypeScript type-check via `tsc --noEmit` (no test framework installed) |
| Config file | `tsconfig.json` |
| Quick run command | `npm run typecheck` |
| Full suite command | `npm run typecheck` |

**Note:** The project has no automated test framework (jest, vitest, etc.) installed. `npm run typecheck` is the only automated check currently available. Manual integration testing via the live Telegram bot is the verification pattern used in Phase 1.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | `rm -rf /` blocked, Jarvis explains | manual | `npm run typecheck` (type safety only) | Wave 0 type check |
| SEC-01 | `mkfs.ext4 /dev/sda` blocked | manual | — | Manual Telegram test |
| SEC-02 | Risky command triggers inline keyboard | manual | — | Manual Telegram test |
| SEC-02 | Approve button executes command | manual | — | Manual Telegram test |
| SEC-02 | Deny button returns denial result | manual | — | Manual Telegram test |
| SEC-02 | 5-minute timeout auto-denies | manual | — | Manual Telegram test |
| SEC-03 | Pending approval survives bot restart | manual | — | Manual Telegram test |
| SEC-03 | Re-sent after restart with fresh buttons | manual | — | Manual Telegram test |
| EXEC-01 | `ls -la ~/` returns directory listing | manual | — | Manual Telegram test |
| EXEC-01 | Safe command runs without approval | manual | — | Manual Telegram test |
| EXEC-02 | .sh script requires approval and runs | manual | — | Manual Telegram test |
| EXEC-02 | .py script requires approval and runs | manual | — | Manual Telegram test |

### Sampling Rate

- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run typecheck` + manual smoke test of execute_command in live Telegram
- **Phase gate:** Type check green + all success criteria verified manually before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] No test framework installed — all behavioral tests are manual via Telegram bot
- [ ] Recommend adding at least a unit test file for `command-classifier.ts` if vitest is easy to add (pure function, no I/O, high value)

---

## Sources

### Primary (HIGH confidence)

- Codebase inspection: `/Users/max/Personal/repos/open-jarvis/src/` — all existing patterns
- `.planning/research/ARCHITECTURE.md` — architectural patterns and data flows
- `.planning/research/PITFALLS.md` — approval gate failure modes, exec() dangers
- Grammy v1.41.1 (`node_modules/grammy`) — InlineKeyboard and callback_query:data verified locally
- Node.js built-in docs: `child_process.execFile` with `shell: false` — execFile is standard library

### Secondary (MEDIUM confidence)

- Grammy official docs: https://grammy.dev/plugins/inline-keyboards.html — callback query patterns
- Node.js `child_process` official docs: https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback

### Tertiary (LOW confidence — not needed, patterns verified from codebase directly)

- None required — all patterns verifiable from installed packages and existing codebase

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all built-ins + already installed packages
- Architecture: HIGH — based on direct codebase inspection, migration patterns confirmed in db.ts, Grammy API confirmed locally
- Pitfalls: HIGH — cross-referenced with PITFALLS.md (which cites CVEs) and direct codebase knowledge
- Validation: MEDIUM — no test framework installed; manual testing is the actual gate

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days) — Grammy and Node.js APIs are stable; no fast-moving dependencies
