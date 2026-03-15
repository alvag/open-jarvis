import { spawn, execSync } from "node:child_process";
import { EXIT_CLEAN, EXIT_RESTART, EXIT_UPDATE } from "./exit-codes.js";

const MAX_BACKOFF = 60_000;
const STABLE_THRESHOLD = 30_000;

let backoff = 1000;
let lastStartTime = 0;

function startBot(): void {
  lastStartTime = Date.now();
  console.log("[supervisor] Starting bot process...");

  const child = spawn("node", ["--import", "tsx", "src/index.ts"], {
    stdio: "inherit",
    env: process.env,
  });

  const forwardSignal = (signal: NodeJS.Signals) => {
    child.kill(signal);
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code) => {
    const uptime = Date.now() - lastStartTime;

    // Remove signal listeners to avoid stacking on restart
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");

    switch (code) {
      case EXIT_CLEAN:
        console.log("[supervisor] Bot exited cleanly. Shutting down.");
        process.exit(0);
        break;

      case EXIT_RESTART:
        console.log("[supervisor] Restart requested. Restarting immediately...");
        backoff = 1000;
        startBot();
        break;

      case EXIT_UPDATE:
        console.log("[supervisor] Update requested. Pulling latest code...");
        try {
          execSync("git pull", { stdio: "inherit" });
        } catch (err) {
          console.error("[supervisor] git pull failed, restarting with existing code:", (err as Error).message);
        }
        backoff = 1000;
        startBot();
        break;

      default:
        // Crash or unexpected exit
        if (uptime > STABLE_THRESHOLD) {
          backoff = 1000;
        }
        console.log(`[supervisor] Bot crashed (exit code ${code}). Restarting in ${backoff / 1000}s...`);
        setTimeout(() => {
          startBot();
        }, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
        break;
    }
  });
}

startBot();
