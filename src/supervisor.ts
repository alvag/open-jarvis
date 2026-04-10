import { spawn, execSync, type ChildProcess } from "node:child_process";
import pino from "pino";
import { mkdirSync } from "node:fs";
import { EXIT_CLEAN, EXIT_RESTART, EXIT_UPDATE } from "./exit-codes.js";

// --- Constants ---
const MAX_BACKOFF = 60_000;
const STABLE_THRESHOLD = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const GIT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const SUPERVISOR_LOG = "./data/supervisor.log";
const isDev = process.env.NODE_ENV !== "production";

// Ensure data directory exists at module load
mkdirSync("./data", { recursive: true });

// --- Structured logging (SUP-04) ---

const targets: pino.TransportTargetOptions[] = [
  {
    target: "pino-roll",
    options: {
      file: SUPERVISOR_LOG,
      frequency: "daily",
      mkdir: true,
      limit: { count: 7 },
    },
  },
];

if (isDev) {
  targets.push({
    target: "pino-pretty",
    options: { destination: 1, colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
  });
} else {
  targets.push({ target: "pino/file", options: { destination: 1 } });
}

const rootLog = pino({ level: "info" }, pino.transport({ targets }));
const supLog = rootLog.child({ component: "supervisor" });
const watchdogLog = rootLog.child({ component: "watchdog" });
const autoupdateLog = rootLog.child({ component: "autoupdate" });
const telegramLog = rootLog.child({ component: "telegram" });

// --- Telegram notifications (for SUP-02 and SUP-03) ---

async function notifyTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const userIds = (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || userIds.length === 0) return;

  for (const userId of userIds) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: userId, text }),
      });
    } catch (err) {
      telegramLog.warn({ error: (err as Error).message }, "Failed to send Telegram notification");
    }
  }
}

// --- Module-level state ---

let backoff = 1000;
let lastStartTime = 0;
let pendingAutoUpdate = false;
let needsNpmInstall = false;
let updateInProgress = false;
let heartbeatDeadline: ReturnType<typeof setTimeout> | null = null;
let gitPollInterval: ReturnType<typeof setInterval> | null = null;

// --- Heartbeat watchdog (SUP-02) ---

function resetHeartbeatWatchdog(child: ChildProcess): void {
  if (heartbeatDeadline) clearTimeout(heartbeatDeadline);
  heartbeatDeadline = setTimeout(() => {
    watchdogLog.warn("Heartbeat timeout — bot appears hung. Killing and restarting.");
    void notifyTelegram("Jarvis parece colgado. Reiniciando...");
    child.kill("SIGKILL");
  }, HEARTBEAT_TIMEOUT_MS);
}

// --- Git polling for auto-update (SUP-03) ---

function pollForUpdates(child: ChildProcess): void {
  try {
    if (updateInProgress) return;

    execSync("git fetch", { stdio: "pipe" });

    const localHead = execSync("git rev-parse HEAD", {
      encoding: "utf8",
    }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    const remoteHead = execSync(`git rev-parse origin/${branch}`, {
      encoding: "utf8",
    }).trim();

    if (localHead !== remoteHead) {
      updateInProgress = true;
      autoupdateLog.info(`New commit detected: ${remoteHead.slice(0, 8)}. Applying update.`);

      const changedFiles = execSync(
        `git diff --name-only ${localHead} ${remoteHead}`,
        { encoding: "utf8" },
      );
      needsNpmInstall = changedFiles.split("\n").includes("package.json");
      pendingAutoUpdate = true;

      if (gitPollInterval) {
        clearInterval(gitPollInterval);
        gitPollInterval = null;
      }

      void notifyTelegram("Nueva actualización detectada. Reiniciando...");
      child.kill("SIGTERM");
    }
  } catch (err) {
    autoupdateLog.warn({ error: (err as Error).message }, "git fetch failed");
  }
}

// --- Main bot process management ---

function startBot(): void {
  lastStartTime = Date.now();
  supLog.info("Starting bot process...");

  const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: process.env,
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  // IPC heartbeat listener (SUP-02)
  child.on("message", (msg: { type: string }) => {
    if (msg.type === "heartbeat") {
      resetHeartbeatWatchdog(child);
    }
  });

  // Start watchdog immediately (first 30s window)
  resetHeartbeatWatchdog(child);

  // Start git polling (SUP-03)
  gitPollInterval = setInterval(() => pollForUpdates(child), GIT_POLL_INTERVAL_MS);
  // Also check on startup
  pollForUpdates(child);

  child.on("exit", (code) => {
    // Clear heartbeat watchdog FIRST to prevent false positive
    if (heartbeatDeadline) {
      clearTimeout(heartbeatDeadline);
      heartbeatDeadline = null;
    }

    // Clear git poll interval
    if (gitPollInterval) {
      clearInterval(gitPollInterval);
      gitPollInterval = null;
    }

    // Remove signal listeners to avoid stacking on restart
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");

    const uptime = Date.now() - lastStartTime;

    // Handle pending auto-update (SUP-03)
    if (pendingAutoUpdate) {
      pendingAutoUpdate = false;
      autoupdateLog.info("Applying git pull...");
      try {
        execSync("git pull", { stdio: "inherit" });
        if (needsNpmInstall) {
          autoupdateLog.info("package.json changed — running npm install");
          execSync("npm install", { stdio: "inherit" });
        }
        const newHead = execSync("git rev-parse HEAD", {
          encoding: "utf8",
        }).trim();
        autoupdateLog.info(`Update complete. New commit: ${newHead.slice(0, 8)}`);
        void notifyTelegram(
          `Actualización aplicada. Reiniciando con commit ${newHead.slice(0, 8)}...`,
        );
      } catch (err) {
        autoupdateLog.warn({ error: (err as Error).message }, "git pull failed during auto-update");
      }
      needsNpmInstall = false;
      updateInProgress = false;
      backoff = 1000;
      startBot();
      return;
    }

    switch (code) {
      case EXIT_CLEAN:
        supLog.info("Bot exited cleanly. Shutting down.");
        process.exit(0);
        break;

      case EXIT_RESTART:
        supLog.info("Restart requested. Restarting immediately...");
        backoff = 1000;
        startBot();
        break;

      case EXIT_UPDATE:
        supLog.info("Update requested. Pulling latest code...");
        try {
          // Check what changed before pulling
          const localHead = execSync("git rev-parse HEAD", {
            encoding: "utf8",
          }).trim();
          execSync("git pull", { stdio: "inherit" });
          const newHead = execSync("git rev-parse HEAD", {
            encoding: "utf8",
          }).trim();
          if (localHead !== newHead) {
            const changedFiles = execSync(
              `git diff --name-only ${localHead} ${newHead}`,
              { encoding: "utf8" },
            );
            if (changedFiles.split("\n").includes("package.json")) {
              supLog.info("package.json changed — running npm install");
              execSync("npm install", { stdio: "inherit" });
            }
          }
        } catch (err) {
          supLog.warn({ error: (err as Error).message }, "git pull failed, restarting with existing code");
        }
        backoff = 1000;
        startBot();
        break;

      default:
        // Crash or unexpected exit
        if (uptime > STABLE_THRESHOLD) {
          backoff = 1000;
        }
        supLog.warn({ code, uptimeMs: uptime }, `Bot crashed (exit code ${code}). Restarting in ${backoff / 1000}s...`);
        void notifyTelegram(`Jarvis se cayó (código ${code}). Reiniciando en ${backoff / 1000}s...`);
        setTimeout(() => {
          startBot();
        }, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
        break;
    }
  });
}

// Entry point
supLog.info("Supervisor started");
startBot();
