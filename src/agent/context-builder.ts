import { readFileSync } from "node:fs";
import type { ChatMessage } from "../types.js";
import type { MemoryManager } from "../memory/memory-manager.js";

function loadAgentRules(): string {
  try {
    return readFileSync("./AGENTS.md", "utf-8");
  } catch {
    return "";
  }
}

const agentRules = loadAgentRules();

export function buildSystemPrompt(
  soulContent: string,
  userId: string,
  userMessage: string,
  memoryManager: MemoryManager,
): ChatMessage {
  const parts: string[] = [soulContent];

  // Agent rules
  if (agentRules) {
    parts.push("\n" + agentRules);
  }

  // Current date/time
  parts.push(
    `\n## Current Context\n- Date: ${new Date().toLocaleDateString("en-US", { dateStyle: "full" })}\n- Time: ${new Date().toLocaleTimeString("en-US", { timeStyle: "short" })}`,
  );

  // Relevant memories
  const relevant = memoryManager.searchMemories(userId, userMessage, 5);
  const recent = memoryManager.getRecentMemories(userId, 5);

  // Deduplicate by id
  const seen = new Set<number>();
  const allMemories = [...relevant, ...recent].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  if (allMemories.length > 0) {
    parts.push("\n## What you know about this user");
    for (const m of allMemories) {
      parts.push(`- **${m.key}**: ${m.content}`);
    }
  }

  return {
    role: "system",
    content: parts.join("\n"),
  };
}
