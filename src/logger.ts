import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_PATH = process.env.LOG_PATH || "./data/jarvis.log";

// Ensure log directory exists
mkdirSync(dirname(LOG_PATH), { recursive: true });

type LogLevel = "info" | "warn" | "error" | "debug";

export function log(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
  const line = `[${timestamp}] [${level.toUpperCase()}] [${category}] ${message}${dataStr}\n`;

  // Write to file
  try {
    appendFileSync(LOG_PATH, line);
  } catch {
    // Silently fail if we can't write to log file
  }

  // Also print to console
  const consoleFn = level === "error" ? console.error : console.log;
  consoleFn(line.trimEnd());
}
