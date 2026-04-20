import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "../logger.js";

const log = createLogger("uploads-cleanup");

const UPLOADS_DIR = "./data/uploads";

/**
 * Delete files in ./data/uploads older than `retentionDays`. Runs silently —
 * no Telegram notification. Voice/audio/photo/document uploads accumulate
 * across sessions; this keeps disk usage bounded.
 */
export async function cleanupUploads(retentionDays: number): Promise<void> {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = readdirSync(UPLOADS_DIR);
  } catch (err) {
    log.warn({ error: (err as Error).message, dir: UPLOADS_DIR }, "uploads dir unreadable, skipping cleanup");
    return;
  }

  let removed = 0;
  let skipped = 0;
  let bytesFreed = 0;

  for (const name of entries) {
    const filePath = join(UPLOADS_DIR, name);
    try {
      const s = statSync(filePath);
      if (!s.isFile()) continue;
      if (s.mtimeMs >= cutoffMs) {
        skipped++;
        continue;
      }
      unlinkSync(filePath);
      removed++;
      bytesFreed += s.size;
    } catch (err) {
      log.warn({ error: (err as Error).message, filePath }, "failed to process upload entry");
    }
  }

  log.info(
    { removed, skipped, bytesFreed, retentionDays },
    "uploads cleanup complete",
  );
}
