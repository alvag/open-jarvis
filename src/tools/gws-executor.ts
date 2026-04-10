import { execFile } from "node:child_process";
import { createLogger } from "../logger.js";

const log = createLogger("gws");

const GWS_TIMEOUT = 30_000;

export async function runGws(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("gws", args, { timeout: GWS_TIMEOUT }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message;
        log.error({ error: msg }, `gws ${args.join(" ")} failed`);

        if (msg.includes("command not found") || msg.includes("ENOENT")) {
          reject(new Error("gws CLI is not installed. Install with: npm i -g @googleworkspace/cli"));
          return;
        }
        if (msg.includes("not authenticated") || msg.includes("token")) {
          reject(new Error("gws is not authenticated. Run: gws auth login"));
          return;
        }
        reject(new Error(`gws error: ${msg}`));
        return;
      }

      const output = stdout.trim();
      if (!output) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(output));
      } catch {
        // gws might return multiple JSON lines (NDJSON) with --page-all
        const lines = output.split("\n").filter(Boolean);
        const parsed = lines.map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return line;
          }
        });
        resolve(parsed.length === 1 ? parsed[0] : parsed);
      }
    });
  });
}
