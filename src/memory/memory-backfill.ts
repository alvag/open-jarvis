import type Database from "better-sqlite3";
import { containsSensitiveData } from "./memory-sanitizer.js";
import { createLogger } from "../logger.js";

const log = createLogger("memory-backfill");

interface BackfillResult {
  skipped: boolean;
  totalMemoriesScanned: number;
  flaggedMemories: Array<{ id: number; key: string }>;
  historyRecordsDeleted: number;
}

export async function runBackfillIfNeeded(
  sqlite: Database.Database,
): Promise<BackfillResult> {
  // 1. Create agent_metadata table if not exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 2. Check flag
  const flag = sqlite.prepare(
    "SELECT value FROM agent_metadata WHERE key = 'backfill_completed'"
  ).get() as { value: string } | undefined;

  if (flag?.value === "true") {
    log.info("Backfill already completed, skipping");
    return { skipped: true, totalMemoriesScanned: 0, flaggedMemories: [], historyRecordsDeleted: 0 };
  }

  log.info("Starting one-time memory security backfill scan");

  // 3. Scan ALL memories (cross-user)
  const allMemories = sqlite.prepare("SELECT id, user_id, key, content FROM memories").all() as Array<{
    id: number; user_id: string; key: string; content: string;
  }>;

  const flaggedMemories: Array<{ id: number; key: string }> = [];

  for (const mem of allMemories) {
    try {
      const keyFlagged = await containsSensitiveData(mem.key);
      const contentFlagged = await containsSensitiveData(mem.content);
      if (keyFlagged || contentFlagged) {
        flaggedMemories.push({ id: mem.id, key: mem.key });
      }
    } catch (err) {
      log.error({ memoryId: mem.id, error: (err as Error).message }, "Error scanning memory, skipping");
    }
  }

  // 4. Scan and delete sensitive memory_history records
  const allHistory = sqlite.prepare(
    "SELECT id, old_content, new_content FROM memory_history"
  ).all() as Array<{ id: number; old_content: string; new_content: string }>;

  const historyIdsToDelete: number[] = [];

  for (const hist of allHistory) {
    try {
      const oldFlagged = await containsSensitiveData(hist.old_content);
      const newFlagged = await containsSensitiveData(hist.new_content);
      if (oldFlagged || newFlagged) {
        historyIdsToDelete.push(hist.id);
      }
    } catch (err) {
      log.error({ historyId: hist.id, error: (err as Error).message }, "Error scanning history, skipping");
    }
  }

  // Delete sensitive history records
  if (historyIdsToDelete.length > 0) {
    const placeholders = historyIdsToDelete.map(() => "?").join(",");
    sqlite.prepare(`DELETE FROM memory_history WHERE id IN (${placeholders})`).run(...historyIdsToDelete);
    log.info({ count: historyIdsToDelete.length }, "Deleted sensitive memory_history records");
  }

  // 5. Set completion flag
  sqlite.prepare(
    "INSERT OR REPLACE INTO agent_metadata (key, value) VALUES ('backfill_completed', 'true')"
  ).run();

  log.info({
    memoriesScanned: allMemories.length,
    memoriesFlagged: flaggedMemories.length,
    historyDeleted: historyIdsToDelete.length,
  }, "Backfill scan complete");

  return {
    skipped: false,
    totalMemoriesScanned: allMemories.length,
    flaggedMemories,
    historyRecordsDeleted: historyIdsToDelete.length,
  };
}
