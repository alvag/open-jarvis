import type { AgentContext, AgentResponse } from "../types.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { MemoryManager } from "../memory/memory-manager.js";
import type { SoulContent } from "../memory/soul.js";

export type TaskType = "reminder" | "task" | "briefing" | "pr-monitor" | "consolidation";
export type TaskStatus = "active" | "paused" | "completed" | "failed";

export interface ScheduledTaskRow {
  id: string;
  user_id: string;
  name: string;
  type: TaskType;
  cron_expression: string;
  prompt: string;
  timezone: string;
  status: TaskStatus;
  pre_approved: number;
  run_count: number;
  last_run_at: string | null;
  last_error: string | null;
  retry_after: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchedulerDeps {
  db: import("better-sqlite3").Database;
  sendMessage: (userId: string, text: string) => Promise<void>;
  runAgent: (
    context: AgentContext,
    llm: LLMProvider,
    toolRegistry: ToolRegistry,
    memoryManager: MemoryManager,
    soul: SoulContent,
    maxIterations: number,
  ) => Promise<AgentResponse>;
  llm: LLMProvider;
  toolRegistry: ToolRegistry;
  memoryManager: MemoryManager;
  soul: SoulContent;
  maxIterations: number;
}
