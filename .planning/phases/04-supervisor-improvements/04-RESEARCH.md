# Phase 04: Supervisor Improvements - Research

**Researched:** 2026-03-18
**Domain:** Node.js process supervision, IPC, git polling, graceful shutdown, file logging
**Confidence:** HIGH (all findings grounded in Node.js v22 official docs and existing codebase)

## Summary

This phase is pure infrastructure hardening of the existing `src/supervisor.ts`. All four requirements (SUP-01 through SUP-04) are improvements to a single file plus additions to `src/index.ts`. The codebase already has the right primitives: exit codes, spawn, signal forwarding, and a logger pattern. The work is extending those patterns — not introducing new architectural concepts.

The key technical decisions are all locked: Node.js IPC for heartbeat (no HTTP, no files), `git fetch` polling every 5 minutes, 15-second graceful shutdown timeout, and a separate `data/supervisor.log` using the same format as `src/logger.ts`. Claude's discretion covers the IPC message format, git comparison implementation, in-flight tracking mechanism, and supervisor log function implementation.

**Primary recommendation:** Add IPC channel to the spawn call, implement heartbeat in the bot, add a git polling loop in the supervisor, extend the shutdown sequence to 15s, and write a standalone supervisor log function mirroring `src/logger.ts`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Heartbeat & hang detection (SUP-02)**
- Use Node.js IPC channel (`process.send()`) between supervisor and bot — no HTTP server, no files
- Bot sends heartbeat every 10 seconds
- Supervisor considers bot hung after 30 seconds without heartbeat (3 missed beats)
- On hang detection: supervisor kills the bot process and restarts it
- Supervisor sends Telegram notification when a hang is detected and the bot is restarted

**Auto-update strategy (SUP-03)**
- Supervisor polls with `git fetch` every 5 minutes
- Compares local HEAD vs remote HEAD for the current branch only
- If remote is ahead: graceful shutdown bot → `git pull` → restart
- If `package.json` changed in the diff: run `npm install` before restarting
- No branch filtering — always tracks whatever branch the bot is running on

**Graceful shutdown (SUP-01)**
- Bounded timeout of 15 seconds for in-flight operations (current 3s is too short)
- Shutdown sequence: notify Telegram ("Jarvis reiniciando...") → stop scheduler → wait for in-flight agent runs → stop Telegram → close DB
- Pending approval gates persist in SQLite (SEC-03) and recover on restart via `recoverPendingOnStartup()` — no change needed, already works
- After 15s timeout: force exit regardless of in-flight state

**Lifecycle logging (SUP-04)**
- Separate log file: `data/supervisor.log` (not mixed with bot's `data/jarvis.log`)
- Same format as `src/logger.ts`: `[timestamp] [LEVEL] [category] message`
- No log rotation for now — supervisor events are infrequent enough
- Events to log: start, crash (with exit code), restart, hang-detected, auto-update-started, auto-update-complete (with commit hash), shutdown, npm-install (if triggered)

### Claude's Discretion
- IPC message format and protocol details
- Exact implementation of the git fetch comparison
- How to track in-flight agent runs for graceful shutdown
- Supervisor log function implementation (can reuse logger.ts pattern or be standalone)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SUP-01 | Bot completes in-flight operations before restarting (graceful shutdown with bounded timeout) | In-flight counter pattern in `runAgent`; 15s timeout replacing existing 3s; shutdown sequence defined |
| SUP-02 | Supervisor detects hung bot (alive but unresponsive) via heartbeat and restarts automatically | Node.js IPC via `stdio: ['inherit','inherit','inherit','ipc']`; `process.send()` in bot; `setInterval` heartbeat; `clearTimeout` watchdog in supervisor |
| SUP-03 | Supervisor detects git changes automatically and updates without manual /update command | `execSync('git fetch')` + `git rev-parse` comparison; `package.json` presence in diff; existing EXIT_UPDATE path reusable |
| SUP-04 | Supervisor writes persistent log of each crash, restart, and update with timestamp and reason | Standalone `supLog()` function mirroring `src/logger.ts`; `appendFileSync` to `data/supervisor.log` |
</phase_requirements>

---

## Standard Stack

### Core — Already in Use (no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | built-in (Node 22) | `spawn` with IPC, `execSync` for git | Already used in supervisor.ts |
| `node:fs` | built-in (Node 22) | `appendFileSync` for supervisor.log | Already used in logger.ts |
| `node:path` | built-in (Node 22) | Path construction for log file | Already used throughout codebase |

No new `npm install` required. All needed APIs are built into Node.js v22.

### Supporting — Native fetch for Telegram notifications

| API | Version | Purpose | When to Use |
|-----|---------|---------|-------------|
| `fetch` (global) | Node 22 built-in | Supervisor sends Telegram messages directly | Supervisor process is separate from bot, can't use grammy instance |

Node.js 22 has `fetch` globally available — no `node-fetch` needed. The Telegram Bot API endpoint is `https://api.telegram.org/bot{TOKEN}/sendMessage`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| IPC via `process.send()` | File-based heartbeat | IPC is lower latency, no disk I/O, real-time; files add fsync complexity |
| IPC via `process.send()` | HTTP health endpoint | HTTP requires opening a port; IPC is zero-config between parent/child |
| `git fetch` + `rev-parse` | `git log` or GitHub webhooks | `rev-parse` is cheapest read; webhooks require inbound HTTP server |
| `execSync` for git | `execa` or `child_process.exec` | `execSync` already used in supervisor; no reason to add async complexity |

---

## Architecture Patterns

### Recommended Changes by File

```
src/
├── supervisor.ts          # Major changes: IPC, heartbeat watchdog, git polling, supLog()
├── index.ts               # Minor changes: IPC heartbeat emitter, in-flight counter, shutdown sequence
└── exit-codes.ts          # No changes needed
    restart-signal.ts      # No changes needed
    logger.ts              # No changes needed (supervisor gets its own log function)
```

### Pattern 1: Node.js IPC Between Parent and Child

**What:** Add `'ipc'` as the 4th stdio stream. Parent calls `child.send()`, child calls `process.send()`. Child listens with `process.on('message')`, parent listens with `child.on('message')`.

**When to use:** Whenever supervisor ↔ bot communication is needed without network sockets.

**Spawn change in supervisor.ts:**
```typescript
// Source: Node.js v22 official docs — child_process.spawn
const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  env: process.env,
});
```

**Heartbeat emitter in index.ts:**
```typescript
// Bot sends heartbeat every 10 seconds
// Guard: process.send exists only when spawned with IPC
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
if (process.send) {
  heartbeatInterval = setInterval(() => {
    process.send!({ type: "heartbeat", ts: Date.now() });
  }, 10_000);
}
```

**Watchdog in supervisor.ts:**
```typescript
// Supervisor resets deadline each time a heartbeat arrives
let heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;

function resetHeartbeatWatchdog(): void {
  if (heartbeatDeadline) clearTimeout(heartbeatDeadline);
  heartbeatDeadline = setTimeout(() => {
    supLog("warn", "watchdog", "Heartbeat timeout — bot appears hung. Killing and restarting.");
    notifyTelegram("Jarvis parece colgado. Reiniciando...");
    child.kill("SIGKILL");   // force kill — SIGTERM may not wake a hung process
  }, 30_000);
}

child.on("message", (msg: { type: string }) => {
  if (msg.type === "heartbeat") resetHeartbeatWatchdog();
});
```

**Important:** The heartbeat watchdog timer must be cleared in the `child.on("exit")` handler to avoid firing after the process has already exited cleanly or crashed.

### Pattern 2: Git Polling Loop

**What:** A `setInterval` in the supervisor that runs `git fetch` then compares local vs remote HEAD. If they differ, trigger an update.

**Implementation:**
```typescript
// Source: Node.js child_process docs + git plumbing commands
function pollForUpdates(): void {
  try {
    execSync("git fetch", { stdio: "pipe" });   // stdio: "pipe" suppresses output

    const localHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const remoteHead = execSync(`git rev-parse origin/${branch}`, { encoding: "utf8" }).trim();

    if (localHead !== remoteHead) {
      supLog("info", "autoupdate", `New commit detected: ${remoteHead.slice(0, 8)}. Applying update.`);
      // Check if package.json changed
      const changedFiles = execSync(
        `git diff --name-only ${localHead} ${remoteHead}`,
        { encoding: "utf8" }
      ).trim();
      const needsInstall = changedFiles.split("\n").includes("package.json");

      triggerAutoUpdate(needsInstall);
    }
  } catch (err) {
    supLog("warn", "autoupdate", "git fetch failed", { error: (err as Error).message });
  }
}

const gitPollInterval = setInterval(pollForUpdates, 5 * 60 * 1000);
```

**Key detail:** `git fetch` with `stdio: "pipe"` suppresses the noisy output. Use plumbing commands (`rev-parse`) not porcelain (`git status`) for reliable scripting.

**`triggerAutoUpdate` flow:**
1. Stop the git poll interval (avoid double-trigger)
2. Signal child for graceful shutdown (send `{ type: "shutdown" }` via IPC, or SIGTERM)
3. Wait for `child.on("exit")` with timeout
4. `execSync("git pull", { stdio: "pipe" })`
5. If `needsInstall`: `execSync("npm install", { stdio: "inherit" })`
6. Call `startBot()` again

**Coexistence with existing EXIT_UPDATE path:** The existing `restart_server` tool with `mode: 'update'` sends EXIT_UPDATE. The `child.on("exit")` handler already handles EXIT_UPDATE by running `git pull` and restarting. The auto-update polling path can reuse the same logic — or it can manage itself separately. The simplest approach: when auto-update detects a new commit, just kill the child (after graceful shutdown). The exit handler will see EXIT_CLEAN (or SIGTERM exit) and the auto-update function resumes control after `child.on("exit")` fires. However, to distinguish from normal exits, it's cleaner to set a flag:

```typescript
let pendingAutoUpdate = false;   // set true before killing for auto-update
let needsNpmInstall = false;

// In child.on("exit"):
if (pendingAutoUpdate) {
  pendingAutoUpdate = false;
  supLog("info", "autoupdate", "Applying git pull...");
  try {
    execSync("git pull", { stdio: "inherit" });
    if (needsNpmInstall) {
      supLog("info", "autoupdate", "package.json changed — running npm install");
      execSync("npm install", { stdio: "inherit" });
    }
    const newHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    supLog("info", "autoupdate", `Update complete. New commit: ${newHead.slice(0, 8)}`);
  } catch (err) { ... }
  startBot();
  return;
}
```

### Pattern 3: In-Flight Tracking for Graceful Shutdown (SUP-01)

**What:** Count active `runAgent` calls. Shutdown waits until count reaches zero or 15-second timeout fires.

**The problem:** `runAgent` is async and can take seconds (LLM round trips). Shutdown currently uses a 3-second `Promise.race` on `telegram.stop()` only — this doesn't track active agent executions.

**Recommended approach — module-level counter in `index.ts`:**
```typescript
// In index.ts — simple counter, no complex tracking needed
let inFlightCount = 0;
let shutdownRequested = false;

// Wrap the telegram message handler:
await telegram.start(async (msg) => {
  inFlightCount++;
  try {
    // ... existing runAgent call ...
  } finally {
    inFlightCount--;
    // If shutdown is waiting, check if we're done
    if (shutdownRequested && inFlightCount === 0) {
      inFlightDone();   // resolve a promise
    }
  }
});

// Graceful shutdown:
const shutdown = async () => {
  shutdownRequested = true;
  log("info", "shutdown", "Shutting down Jarvis...");

  // 1. Notify Telegram
  await telegram.broadcast("Jarvis reiniciando...").catch(() => {});

  // 2. Stop scheduler
  stopScheduler();

  // 3. Wait for in-flight agents (with 15s timeout)
  if (inFlightCount > 0) {
    await Promise.race([
      new Promise<void>(resolve => { inFlightDone = resolve; }),
      new Promise<void>(resolve => setTimeout(resolve, 15_000)),
    ]);
  }

  // 4. Stop Telegram
  await telegram.stop().catch(() => {});

  // 5. Close DB
  db.close();

  // 6. Exit
  const code = getPendingRestart() ?? 0;
  process.exit(code);
};
```

**Note on `inFlightDone`:** Declare as `let inFlightDone: () => void = () => {};` at module scope. The finally block calls it only when `shutdownRequested && inFlightCount === 0`.

**Alternative (simpler, acceptable):** Use a `Set<Promise>` to track active agent runs, then `Promise.all` on them with a timeout. The counter approach above is simpler and sufficient.

### Pattern 4: Supervisor Log Function (SUP-04)

**What:** A standalone function in supervisor.ts that mirrors `src/logger.ts` but writes to `data/supervisor.log` instead of `data/jarvis.log`. Self-contained to avoid circular imports (supervisor cannot import from the bot's module tree).

```typescript
// In supervisor.ts — standalone, no imports from bot modules
import { appendFileSync, mkdirSync } from "node:fs";

const SUPERVISOR_LOG = "./data/supervisor.log";
mkdirSync("./data", { recursive: true });

type SupLogLevel = "info" | "warn" | "error";

function supLog(level: SupLogLevel, category: string, message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
  const line = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${dataStr}\n`;
  try {
    appendFileSync(SUPERVISOR_LOG, line);
  } catch { /* ignore */ }
  console.log(line.trimEnd());
}
```

All existing `console.log("[supervisor] ...")` calls in supervisor.ts get replaced with `supLog(...)`.

### Pattern 5: Supervisor → Telegram Notifications

**What:** Supervisor sends Telegram messages directly via HTTP without grammy. Used for hang-detected notifications and update notifications.

```typescript
// In supervisor.ts
async function notifyTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const userIds = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (!token || userIds.length === 0) return;

  for (const userId of userIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: userId, text }),
      });
    } catch { /* non-fatal */ }
  }
}
```

**Confidence:** HIGH — `fetch` is global in Node 22, Telegram Bot API `sendMessage` is the simplest endpoint.

### Anti-Patterns to Avoid

- **Stacking signal listeners:** The existing code already removes and re-adds SIGINT/SIGTERM on each restart. With IPC, also ensure the `child.on("message")` listener doesn't stack. Use a single `child` reference per `startBot()` call.
- **Clearing the heartbeat interval before process.exit:** The bot should clear the heartbeat `setInterval` in its shutdown handler to avoid "process.send on closed channel" errors after the IPC channel closes.
- **`git fetch` with `stdio: "inherit"`:** This prints remote tracking output to supervisor stdout on every poll. Use `stdio: "pipe"` to suppress.
- **Running `npm install` with `stdio: "pipe"` during update:** npm output is useful to see during installs — use `stdio: "inherit"` for npm, `stdio: "pipe"` for git reads.
- **Not guarding `process.send` in bot:** When running `npm run start:bot` directly (without supervisor), `process.send` is undefined. Always guard with `if (process.send)`.
- **Git polling while an update is already in progress:** Set a boolean flag (`updateInProgress`) before triggering auto-update. Skip the poll if flag is set.
- **Heartbeat watchdog firing during intentional restarts:** When the supervisor initiates a shutdown (SIGTERM forward, or hang kill), cancel the heartbeat watchdog immediately before killing the child.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IPC channel | Custom socket/file protocol | Node.js built-in IPC (`stdio: ['inherit','inherit','inherit','ipc']`) | Built-in, zero deps, works across Node versions |
| Telegram notifications from supervisor | Re-instantiating grammy Bot | Raw `fetch` to Telegram Bot API | grammy brings its own polling loop; supervisor only needs to POST |
| Git version comparison | Parsing `git log` output | `git rev-parse HEAD` / `git rev-parse origin/BRANCH` | Plumbing commands are stable and unaffected by locale/config |
| Log rotation | Custom rotation logic | Just `appendFileSync` for now | Supervisor events are infrequent (decisions says no rotation needed) |

---

## Common Pitfalls

### Pitfall 1: IPC Channel Closed Before Heartbeat Interval Cleared
**What goes wrong:** If the bot process exits and the IPC channel closes, but the bot's heartbeat `setInterval` is still ticking, Node.js throws `Error: channel closed` when `process.send()` is called.
**Why it happens:** The heartbeat interval is set up at startup with no cleanup in the shutdown handler.
**How to avoid:** In the bot's `shutdown()` function, `clearInterval(heartbeatInterval)` before stopping telegram.
**Warning signs:** `Error: channel closed` in bot logs immediately before or during shutdown.

### Pitfall 2: Watchdog Fires After Clean Exit
**What goes wrong:** If the bot exits cleanly (EXIT_CLEAN, EXIT_RESTART, or SIGTERM), but the 30-second watchdog timer was not cancelled, it fires after the process is gone and tries to kill an already-exited child.
**Why it happens:** `child.kill()` on a dead process is a no-op on Linux/macOS (returns false), but the `supLog` and `notifyTelegram` calls still fire, producing a false positive.
**How to avoid:** In `child.on("exit")`, always call `clearTimeout(heartbeatDeadline)` as the first line.

### Pitfall 3: Double Auto-Update Trigger
**What goes wrong:** Git poll fires while an update is already in progress (e.g., `git pull` is running). A second poll detects the same new commit and triggers a second update.
**Why it happens:** `setInterval` doesn't know about async operations in flight.
**How to avoid:** Set `let updateInProgress = false` flag; skip poll body if true. Set to true before triggering, false after `startBot()`.

### Pitfall 4: `git fetch` Fails in Non-Git Environments or Without Remote
**What goes wrong:** `execSync("git fetch")` throws if there's no git remote configured or network is unavailable.
**Why it happens:** `execSync` throws on non-zero exit codes.
**How to avoid:** Wrap in try/catch with `supLog("warn")` — already the pattern for git errors in the existing supervisor. Don't crash the supervisor on transient git fetch failures.

### Pitfall 5: `npm install` Blocking the Event Loop During Update
**What goes wrong:** `execSync("npm install")` blocks the entire supervisor process. If the supervisor has other timers (git poll interval), they won't fire until install completes.
**Why it happens:** `execSync` is synchronous. npm install can take 30+ seconds.
**How to avoid:** This is acceptable since the bot is already dead during the update. The git poll interval should be cleared before running `npm install` and reinstated after (or just let `startBot()` handle restarting).

### Pitfall 6: 15s Shutdown Timeout Race with `process.exit`
**What goes wrong:** If the shutdown handler calls `process.exit()` unconditionally after the timeout, and the in-flight counter reaches zero just before the timeout fires, two `process.exit()` calls can race.
**Why it happens:** `Promise.race` resolves on whichever promise wins — both the in-flight-done promise and the timeout promise resolve, but `Promise.race` only gives you the first. Only one `process.exit()` call happens.
**How to avoid:** `Promise.race` already handles this correctly — only the first resolution matters. Node.js also handles multiple `process.exit()` calls gracefully (first one wins).

### Pitfall 7: Signal Listener Stacking on Restart
**What goes wrong:** Each `startBot()` call adds new SIGINT/SIGTERM listeners. After N restarts, the process has N listeners per signal, causing warnings and multiple handler invocations.
**Why it happens:** The existing code already handles this with `process.removeAllListeners("SIGINT")` in the exit handler. The IPC message handler on `child` doesn't need removal since `child` is a new object each restart.
**Warning signs:** `MaxListenersExceededWarning` in supervisor stdout.

---

## Code Examples

### Verified Pattern: Node.js IPC Spawn

```typescript
// Source: https://nodejs.org/api/child_process.html#optionsstdio (Node 22)
// The 4th element 'ipc' creates the IPC channel
const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
  stdio: ["inherit", "inherit", "inherit", "ipc"],
  env: process.env,
});

// Parent receives messages from child
child.on("message", (msg: unknown) => {
  // msg is the object passed to process.send() in the child
});

// Child sends message to parent
// In src/index.ts:
if (process.send) {
  process.send({ type: "heartbeat", ts: Date.now() });
}
```

### Verified Pattern: Git Plumbing Commands

```typescript
// Source: git documentation — plumbing commands are stable for scripting
const localHead  = execSync("git rev-parse HEAD",            { encoding: "utf8" }).trim();
const branch     = execSync("git rev-parse --abbrev-ref HEAD",{ encoding: "utf8" }).trim();
const remoteHead = execSync(`git rev-parse origin/${branch}`, { encoding: "utf8" }).trim();
const diff       = execSync(`git diff --name-only ${localHead} ${remoteHead}`, { encoding: "utf8" });
```

### Verified Pattern: Telegram Bot API via fetch

```typescript
// Source: https://core.telegram.org/bots/api#sendmessage (stable API, no version changes)
// Node 22 fetch is global — no import needed
await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: userId, text: message }),
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `stdio: "inherit"` for child | `stdio: ['inherit','inherit','inherit','ipc']` | Phase 4 | Enables bidirectional parent↔child messaging |
| 3s shutdown timeout | 15s timeout with in-flight counter | Phase 4 | Prevents killing mid-tool executions |
| Manual `/update` only | Auto-polling every 5 min | Phase 4 | Zero-touch deployments |
| `console.log("[supervisor]")` | `supLog()` to `data/supervisor.log` | Phase 4 | Persistent, queryable lifecycle history |

**No deprecated approaches to remove** — all existing patterns (exit codes, backoff, signal forwarding) remain valid and are extended, not replaced.

---

## Open Questions

1. **IPC message types: typed union or duck typing?**
   - What we know: Only `{ type: "heartbeat" }` is needed now; CONTEXT.md mentions supervisor can also send messages to bot
   - What's unclear: Whether to define a shared types file for IPC messages (adds cross-module coupling) or duck-type in each file
   - Recommendation: Define `type IpcMessage = { type: "heartbeat"; ts: number } | { type: "shutdown" }` inline in supervisor.ts and index.ts separately — avoids coupling. Supervisor.ts cannot import from index.ts anyway.

2. **Should the supervisor also listen for IPC messages FROM the supervisor TO the bot?**
   - What we know: CONTEXT.md says "Supervisor sends Telegram notification" (direct fetch), not via IPC to bot
   - What's unclear: Whether there's value in sending a graceful shutdown request via IPC (`{ type: "shutdown" }`) instead of SIGTERM for the auto-update flow
   - Recommendation: Use SIGTERM for shutdown signals (already forwarded correctly); reserve IPC for bot→supervisor (heartbeat only). SIGTERM is more universally handled in Node.js than custom IPC messages.

3. **Heartbeat during scheduler task execution**
   - What we know: Scheduler tasks call `runAgent` which can take 10-30 seconds per LLM call
   - What's unclear: Does a long-running `runAgent` call in the scheduler block the heartbeat interval?
   - Recommendation: No — `setInterval` in Node.js is event-loop based. The heartbeat fires on the event loop regardless of async work in progress, as long as the process is not truly hung (infinite loop, blocked I/O). A hung process (truly stuck) would not fire the interval, which is exactly what heartbeat detection is designed to catch.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — no test framework in project |
| Config file | none |
| Quick run command | `npm run typecheck` |
| Full suite command | `npm run typecheck && npm run build` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SUP-01 | Graceful shutdown completes in-flight ops within 15s | manual-only | n/a — requires live Telegram interaction | N/A |
| SUP-02 | Hang detection kills and restarts bot after 30s no heartbeat | manual-only | n/a — requires process inspection | N/A |
| SUP-03 | Auto-update triggers on new git commit without /update | manual-only | n/a — requires pushing to remote and waiting | N/A |
| SUP-04 | Lifecycle events written to data/supervisor.log | manual-only | n/a — requires running supervisor and inspecting file | N/A |

**Manual-only justification:** All four requirements are supervisor/process lifecycle behaviors. They require spawning real child processes, real git remotes, real signal handling, and real Telegram connections. Unit tests without these would be testing mocks, not the actual behavior. Verification is via `tail -f data/supervisor.log` and Telegram observation.

**Type-safety gate (automated):** `npm run typecheck` catches structural errors before manual testing.

### Sampling Rate
- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm run typecheck && npm run build`
- **Phase gate:** Both green + manual Telegram verification before `/gsd:verify-work`

### Wave 0 Gaps
None — no test framework to scaffold. Typecheck is the only automated gate.

---

## Sources

### Primary (HIGH confidence)
- Node.js v22 docs — `child_process.spawn` with `stdio: ['inherit','inherit','inherit','ipc']` and IPC semantics: https://nodejs.org/api/child_process.html#optionsstdio
- Node.js v22 docs — `process.send()` and `process.on('message')`: https://nodejs.org/api/process.html#processsendmessage-sendhandle-options-callback
- Telegram Bot API — `sendMessage` endpoint: https://core.telegram.org/bots/api#sendmessage
- Existing codebase — `src/supervisor.ts`, `src/logger.ts`, `src/exit-codes.ts`, `src/index.ts`, `src/restart-signal.ts` (read directly)

### Secondary (MEDIUM confidence)
- git plumbing commands (`rev-parse`, `diff --name-only`) — standard scripting practice, stable across git versions
- Node 22 global `fetch` — verified via `node --version` showing v22.14.0 (fetch global since Node 18)

### Tertiary (LOW confidence)
None — no unverified WebSearch findings used.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies are Node.js built-ins already in use
- Architecture: HIGH — patterns derived directly from existing code + official Node.js docs
- Pitfalls: HIGH — derived from reading actual code paths in the codebase
- IPC details: HIGH — Node.js IPC is stable API since Node 0.5

**Research date:** 2026-03-18
**Valid until:** 2026-09-18 (stable Node.js built-in APIs; no external library versions to expire)
