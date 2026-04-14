import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ChatMessage } from "../types.js";

export interface Memory {
  id: number;
  user_id: string;
  key: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryHistoryEntry {
  old_content: string;
  new_content: string;
  changed_at: string;
}

export interface MemoryManager {
  saveMemory(
    userId: string,
    key: string,
    content: string,
    category?: string,
  ): Memory;
  searchMemories(userId: string, query: string, limit?: number): Memory[];
  getRecentMemories(userId: string, limit?: number): Memory[];
  getAllMemories(userId: string): Memory[];
  getMemoryByKey(userId: string, key: string): Memory | undefined;
  getTodaySessionMessages(userId: string): ChatMessage[];
  getMemoryHistory(memoryId: number, limit?: number): MemoryHistoryEntry[];
  deleteMemory(id: number, userId: string): boolean;
  getSessionMessages(sessionId: string): ChatMessage[];
  saveSessionMessage(sessionId: string, message: ChatMessage): void;
  cleanupOldSessions(retentionDays: number): number;
  resolveSession(
    userId: string,
    channelId: string,
    timeoutMinutes: number,
  ): string;
}

export function createMemoryManager(db: Database.Database): MemoryManager {
  const stmts = {
    upsertMemory: db.prepare(`
      INSERT INTO memories (user_id, key, content, category)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET
        content = ?,
        category = ?,
        updated_at = datetime('now')
    `),
    findMemoryByKey: db.prepare(`
      SELECT * FROM memories WHERE user_id = ? AND key = ?
    `),
    searchMemories: db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND (key LIKE ? OR content LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    searchMemoriesFts: db.prepare(`
      SELECT m.* FROM memories m
      JOIN memories_fts fts ON m.id = fts.rowid
      WHERE fts.memories_fts MATCH ?
      AND m.user_id = ?
      ORDER BY rank
      LIMIT ?
    `),
    insertHistory: db.prepare(`
      INSERT INTO memory_history (memory_id, user_id, key, old_content, new_content)
      VALUES (?, ?, ?, ?, ?)
    `),
    getMemoryHistory: db.prepare(`
      SELECT old_content, new_content, changed_at
      FROM memory_history
      WHERE memory_id = ?
      ORDER BY changed_at DESC
      LIMIT ?
    `),
    recentMemories: db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    allMemories: db.prepare(`
      SELECT * FROM memories WHERE user_id = ? ORDER BY category, key
    `),
    todaySessionMessages: db.prepare(`
      SELECT sm.content FROM session_messages sm
      JOIN sessions s ON sm.session_id = s.id
      WHERE s.user_id = ? AND sm.role = 'user'
      AND sm.created_at >= date('now', 'start of day')
      ORDER BY sm.created_at ASC
    `),
    deleteMemory: db.prepare(`DELETE FROM memories WHERE id = ? AND user_id = ?`),
    getSessionMessages: db.prepare(`
      SELECT role, content, tool_calls, tool_call_id
      FROM session_messages
      WHERE session_id = ?
      ORDER BY id ASC
    `),
    insertSessionMessage: db.prepare(`
      INSERT INTO session_messages (session_id, role, content, tool_calls, tool_call_id)
      VALUES (?, ?, ?, ?, ?)
    `),
    getLatestSession: db.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ? AND channel_id = ?
      ORDER BY last_active DESC
      LIMIT 1
    `),
    createSession: db.prepare(`
      INSERT INTO sessions (id, user_id, channel_id) VALUES (?, ?, ?)
    `),
    touchSession: db.prepare(`
      UPDATE sessions SET last_active = datetime('now') WHERE id = ?
    `),
    deleteOldSessionMessages: db.prepare(`
      DELETE FROM session_messages
      WHERE session_id IN (
        SELECT id FROM sessions WHERE last_active < datetime('now', '-' || ? || ' days')
      )
    `),
    deleteOldSessions: db.prepare(`
      DELETE FROM sessions WHERE last_active < datetime('now', '-' || ? || ' days')
    `),
  };

  return {
    saveMemory(userId, key, content, category = "fact") {
      const existing = stmts.findMemoryByKey.get(userId, key) as
        | Memory
        | undefined;

      // Save history if updating
      if (existing && existing.content !== content) {
        stmts.insertHistory.run(
          existing.id,
          userId,
          key,
          existing.content,
          content,
        );
      }

      stmts.upsertMemory.run(userId, key, content, category, content, category);
      return stmts.findMemoryByKey.get(userId, key) as Memory;
    },

    searchMemories(userId, query, limit = 10) {
      // Sanitize query for FTS5: escape special chars, add prefix matching
      const ftsQuery = query
        .replace(/['"*():\-]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((term) => `"${term}"*`)
        .join(" OR ");

      if (ftsQuery) {
        try {
          const ftsResults = stmts.searchMemoriesFts.all(
            ftsQuery,
            userId,
            limit,
          ) as Memory[];
          if (ftsResults.length > 0) {
            return ftsResults;
          }
        } catch {
          // Fallback to LIKE if FTS query fails
        }
      }

      // Fallback: LIKE-based search
      const pattern = `%${query}%`;
      return stmts.searchMemories.all(
        userId,
        pattern,
        pattern,
        limit,
      ) as Memory[];
    },

    getRecentMemories(userId, limit = 10) {
      return stmts.recentMemories.all(userId, limit) as Memory[];
    },

    getAllMemories(userId) {
      return stmts.allMemories.all(userId) as Memory[];
    },

    getMemoryByKey(userId, key) {
      return stmts.findMemoryByKey.get(userId, key) as Memory | undefined;
    },

    getTodaySessionMessages(userId) {
      const rows = stmts.todaySessionMessages.all(userId) as Array<{ content: string | null }>;
      return rows
        .filter((r) => r.content)
        .map((r) => ({ role: "user" as const, content: r.content }));
    },

    getMemoryHistory(memoryId, limit = 10) {
      return stmts.getMemoryHistory.all(
        memoryId,
        limit,
      ) as MemoryHistoryEntry[];
    },

    deleteMemory(id, userId) {
      const result = stmts.deleteMemory.run(id, userId);
      return result.changes > 0;
    },

    getSessionMessages(sessionId) {
      const rows = stmts.getSessionMessages.all(sessionId) as Array<{
        role: string;
        content: string | null;
        tool_calls: string | null;
        tool_call_id: string | null;
      }>;

      return rows.map((row) => {
        const msg: ChatMessage = {
          role: row.role as ChatMessage["role"],
          content: row.content,
        };
        if (row.tool_calls) {
          msg.tool_calls = JSON.parse(row.tool_calls);
        }
        if (row.tool_call_id) {
          msg.tool_call_id = row.tool_call_id;
        }
        return msg;
      });
    },

    saveSessionMessage(sessionId, message) {
      stmts.insertSessionMessage.run(
        sessionId,
        message.role,
        message.content,
        message.tool_calls ? JSON.stringify(message.tool_calls) : null,
        message.tool_call_id ?? null,
      );
      stmts.touchSession.run(sessionId);
    },

    cleanupOldSessions(retentionDays) {
      stmts.deleteOldSessionMessages.run(retentionDays);
      const result = stmts.deleteOldSessions.run(retentionDays);
      return result.changes;
    },

    resolveSession(userId, channelId, timeoutMinutes) {
      const latest = stmts.getLatestSession.get(userId, channelId) as
        | { id: string; last_active: string }
        | undefined;

      if (latest) {
        const lastActive = new Date(latest.last_active + "Z");
        const elapsed =
          (Date.now() - lastActive.getTime()) / 1000 / 60;
        if (elapsed < timeoutMinutes) {
          stmts.touchSession.run(latest.id);
          return latest.id;
        }
      }

      const newId = randomUUID();
      stmts.createSession.run(newId, userId, channelId);
      return newId;
    },
  };
}
