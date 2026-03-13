import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function initDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     TEXT NOT NULL,
      key         TEXT NOT NULL,
      content     TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'fact',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
    CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(user_id, key);

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      channel_id  TEXT NOT NULL,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_active TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS session_messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      role         TEXT NOT NULL,
      content      TEXT,
      tool_calls   TEXT,
      tool_call_id TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_session_messages ON session_messages(session_id);
  `);

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  const currentVersion =
    (db.pragma("user_version", { simple: true }) as number) || 0;

  if (currentVersion < 1) {
    // Dedup existing memories before adding unique constraint
    db.exec(`
      DELETE FROM memories WHERE id NOT IN (
        SELECT MIN(id) FROM memories GROUP BY user_id, key
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_key ON memories(user_id, key);
    `);
    db.pragma("user_version = 1");
  }

  if (currentVersion < 2) {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        key,
        content,
        content=memories,
        content_rowid=id
      );

      -- Populate FTS index from existing data
      INSERT INTO memories_fts(memories_fts) VALUES('rebuild');

      -- Keep FTS in sync with memories table
      CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, key, content) VALUES (new.id, new.key, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, content) VALUES ('delete', old.id, old.key, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, content) VALUES ('delete', old.id, old.key, old.content);
        INSERT INTO memories_fts(rowid, key, content) VALUES (new.id, new.key, new.content);
      END;
    `);
    db.pragma("user_version = 2");
  }
}
