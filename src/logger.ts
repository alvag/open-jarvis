import pino from "pino";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_PATH = process.env.LOG_PATH || "./data/jarvis.log";
const LOG_LEVEL = process.env.LOG_LEVEL || "debug";
const isDev = process.env.NODE_ENV !== "production";

// Ensure log directory exists
mkdirSync(dirname(LOG_PATH), { recursive: true });

const targets: pino.TransportTargetOptions[] = [
  // Always write to file with daily rotation, 7-day retention
  {
    target: "pino-roll",
    options: {
      file: LOG_PATH,
      frequency: "daily",
      mkdir: true,
      limit: { count: 7 },
    },
  },
];

if (isDev) {
  // Dev: pretty-printed, colorized output to stdout
  targets.push({
    target: "pino-pretty",
    options: {
      destination: 1,
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname",
    },
  });
} else {
  // Prod: raw JSON to stdout
  targets.push({
    target: "pino/file",
    options: { destination: 1 },
  });
}

const transport = pino.transport({ targets });

const rootLogger = pino({ level: LOG_LEVEL }, transport);

/**
 * Create a child logger scoped to a component.
 *
 * Usage:
 *   const log = createLogger("telegram");
 *   log.info("Polling started");
 *   log.error({ error: err.message }, "Download failed");
 */
export function createLogger(component: string): pino.Logger {
  return rootLogger.child({ component });
}

export default rootLogger;
