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

export interface MemoryManager {
  saveMemory(
    userId: string,
    key: string,
    content: string,
    category?: string,
  ): Memory;
  searchMemories(userId: string, query: string, limit?: number): Memory[];
  getRecentMemories(userId: string, limit?: number): Memory[];
  deleteMemory(id: number): boolean;
  getSessionMessages(sessionId: string): ChatMessage[];
  saveSessionMessage(sessionId: string, message: ChatMessage): void;
  resolveSession(
    userId: string,
    channelId: string,
    timeoutMinutes: number,
  ): string;
}

export function createMemoryManager(db: Database.Database): MemoryManager {
  const stmts = {
    insertMemory: db.prepare(`
      INSERT INTO memories (user_id, key, content, category)
      VALUES (?, ?, ?, ?)
    `),
    updateMemory: db.prepare(`
      UPDATE memories SET content = ?, updated_at = datetime('now')
      WHERE user_id = ? AND key = ?
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
    recentMemories: db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    deleteMemory: db.prepare(`DELETE FROM memories WHERE id = ?`),
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
  };

  return {
    saveMemory(userId, key, content, category = "fact") {
      const existing = stmts.findMemoryByKey.get(userId, key) as
        | Memory
        | undefined;
      if (existing) {
        stmts.updateMemory.run(content, userId, key);
        return { ...existing, content, updated_at: new Date().toISOString() };
      }
      const result = stmts.insertMemory.run(userId, key, content, category);
      return {
        id: Number(result.lastInsertRowid),
        user_id: userId,
        key,
        content,
        category,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },

    searchMemories(userId, query, limit = 10) {
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

    deleteMemory(id) {
      const result = stmts.deleteMemory.run(id);
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
