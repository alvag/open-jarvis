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

  if (currentVersion < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id   INTEGER NOT NULL,
        user_id     TEXT NOT NULL,
        key         TEXT NOT NULL,
        old_content TEXT NOT NULL,
        new_content TEXT NOT NULL,
        changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_memory_history_memory ON memory_history(memory_id);
    `);
    db.pragma("user_version = 3");
  }

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

  if (currentVersion < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        name          TEXT NOT NULL,
        type          TEXT NOT NULL DEFAULT 'task',
        cron_expression TEXT NOT NULL,
        prompt        TEXT NOT NULL,
        timezone      TEXT NOT NULL DEFAULT 'local',
        status        TEXT NOT NULL DEFAULT 'active',
        pre_approved  INTEGER NOT NULL DEFAULT 0,
        run_count     INTEGER NOT NULL DEFAULT 0,
        last_run_at   TEXT,
        last_error    TEXT,
        retry_after   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_user ON scheduled_tasks(user_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);

      CREATE TABLE IF NOT EXISTS pr_states (
        pr_id           INTEGER PRIMARY KEY,
        workspace       TEXT NOT NULL,
        repo_slug       TEXT NOT NULL,
        last_updated_on TEXT NOT NULL,
        last_state      TEXT NOT NULL,
        last_commit_hash TEXT,
        participant_states TEXT NOT NULL DEFAULT '{}',
        checked_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.pragma("user_version = 5");
  }

  if (currentVersion < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lists (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_user_name ON lists(user_id, name);

      CREATE TABLE IF NOT EXISTS list_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        text        TEXT NOT NULL,
        completed   INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
    `);
    db.pragma("user_version = 6");
  }

  if (currentVersion < 7) {
    // Migrate list_items: replace completed INTEGER with status TEXT
    db.exec(`
      ALTER TABLE list_items RENAME TO list_items_old;

      CREATE TABLE list_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id     INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        text        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending',
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO list_items (id, list_id, text, status, position, created_at, updated_at)
        SELECT id, list_id, text,
          CASE WHEN completed = 1 THEN 'completed' ELSE 'pending' END,
          position, created_at, updated_at
        FROM list_items_old;

      DROP TABLE list_items_old;

      CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
    `);
    db.pragma("user_version = 7");
  }

  if (currentVersion < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS codebase_index (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL,
        entry_type  TEXT NOT NULL,
        key         TEXT NOT NULL,
        summary     TEXT NOT NULL,
        evidence    TEXT NOT NULL DEFAULT '[]',
        confidence  TEXT NOT NULL DEFAULT 'high',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_codebase_user_key
        ON codebase_index(user_id, entry_type, key);

      CREATE VIRTUAL TABLE IF NOT EXISTS codebase_fts USING fts5(
        key,
        summary,
        content=codebase_index,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS codebase_fts_insert AFTER INSERT ON codebase_index BEGIN
        INSERT INTO codebase_fts(rowid, key, summary) VALUES (new.id, new.key, new.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS codebase_fts_delete AFTER DELETE ON codebase_index BEGIN
        INSERT INTO codebase_fts(codebase_fts, rowid, key, summary) VALUES ('delete', old.id, old.key, old.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS codebase_fts_update AFTER UPDATE ON codebase_index BEGIN
        INSERT INTO codebase_fts(codebase_fts, rowid, key, summary) VALUES ('delete', old.id, old.key, old.summary);
        INSERT INTO codebase_fts(rowid, key, summary) VALUES (new.id, new.key, new.summary);
      END;
    `);
    db.pragma("user_version = 8");
  }

  if (currentVersion < 9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS backlog_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        category        TEXT NOT NULL CHECK (category IN ('bug','refactor','improvement')),
        severity        TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
        confidence      TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
        status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','pr_created','merged','dismissed')),
        source_tool     TEXT,
        source_finding_id TEXT,
        files           TEXT NOT NULL DEFAULT '[]',
        evidence        TEXT NOT NULL DEFAULT '[]',
        pr_number       INTEGER,
        pr_url          TEXT,
        branch_name     TEXT,
        worktree_path   TEXT,
        dismiss_reason  TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_backlog_user_status ON backlog_items(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_backlog_severity ON backlog_items(severity);
    `);
    db.pragma("user_version = 9");
  }

  if (currentVersion < 10) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS code_review_log (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path        TEXT NOT NULL UNIQUE,
        last_reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_file_hash   TEXT,
        last_modified_at TEXT,
        findings_count   INTEGER NOT NULL DEFAULT 0,
        skills_run       TEXT NOT NULL DEFAULT '[]',
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_code_review_log_path ON code_review_log(file_path);
      CREATE INDEX IF NOT EXISTS idx_code_review_log_reviewed ON code_review_log(last_reviewed_at);
    `);
    db.pragma("user_version = 10");
  }

  if (currentVersion < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS intent_usage (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        TEXT NOT NULL,
        category       TEXT NOT NULL,
        canonical_key  TEXT NOT NULL,
        raw_text       TEXT NOT NULL,
        created_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_intent_usage_user_key
        ON intent_usage(user_id, canonical_key, created_at);

      CREATE TABLE IF NOT EXISTS intent_suggestions (
        user_id           TEXT NOT NULL,
        canonical_key     TEXT NOT NULL,
        category          TEXT NOT NULL,
        last_suggested_at TEXT,
        last_dismissed_at TEXT,
        accepted_at       TEXT,
        PRIMARY KEY (user_id, canonical_key)
      );
    `);
    db.pragma("user_version = 11");
  }

  if (currentVersion < 12) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entities (
        id                     TEXT PRIMARY KEY,
        user_id                TEXT NOT NULL,
        entity_type            TEXT NOT NULL,
        canonical_name         TEXT NOT NULL,
        slug                   TEXT NOT NULL,
        search_text            TEXT NOT NULL DEFAULT '',
        aliases_json           TEXT NOT NULL DEFAULT '[]',
        attributes_json        TEXT NOT NULL DEFAULT '{}',
        notes_json             TEXT NOT NULL DEFAULT '[]',
        tags_json              TEXT NOT NULL DEFAULT '[]',
        confidence             TEXT,
        created_at             TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_user_slug
        ON knowledge_entities(user_id, slug);
      CREATE INDEX IF NOT EXISTS idx_ke_user_type
        ON knowledge_entities(user_id, entity_type);
      CREATE INDEX IF NOT EXISTS idx_ke_user_canonical
        ON knowledge_entities(user_id, canonical_name);
      CREATE INDEX IF NOT EXISTS idx_ke_search
        ON knowledge_entities(user_id, search_text);

      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        from_entity_id  TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        relation_type   TEXT NOT NULL,
        to_entity_id    TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        attributes_json TEXT NOT NULL DEFAULT '{}',
        notes_json      TEXT NOT NULL DEFAULT '[]',
        confidence      TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_kr_unique
        ON knowledge_relations(user_id, from_entity_id, relation_type, to_entity_id);
      CREATE INDEX IF NOT EXISTS idx_kr_from
        ON knowledge_relations(from_entity_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_kr_to
        ON knowledge_relations(to_entity_id, relation_type);

      CREATE TABLE IF NOT EXISTS knowledge_entity_memories (
        entity_id  TEXT NOT NULL REFERENCES knowledge_entities(id) ON DELETE CASCADE,
        memory_id  INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (entity_id, memory_id)
      );

      CREATE INDEX IF NOT EXISTS idx_kem_memory
        ON knowledge_entity_memories(memory_id);
    `);
    db.pragma("user_version = 12");
  }
}
