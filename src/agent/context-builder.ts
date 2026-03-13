import { readFileSync } from "node:fs";
import type { ChatMessage } from "../types.js";
import type { Memory, MemoryManager } from "../memory/memory-manager.js";

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

  // Relevant memories via FTS5 (ranked by relevance)
  const relevant = memoryManager.searchMemories(userId, userMessage, 7);

  // Recent memories (temporal context)
  const recent = memoryManager.getRecentMemories(userId, 5);

  // Deduplicate by id
  const seen = new Set<number>();
  const allMemories = [...relevant, ...recent].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  if (allMemories.length > 0) {
    // Group by category for better organization
    const grouped: Record<string, Memory[]> = {};
    for (const m of allMemories) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    }

    parts.push("\n## What you know about this user");

    const categoryLabels: Record<string, string> = {
      preference: "Preferences",
      fact: "Facts",
      event: "Events",
      note: "Notes",
    };

    for (const [cat, memories] of Object.entries(grouped)) {
      const label = categoryLabels[cat] || cat;
      parts.push(`\n### ${label}`);
      for (const m of memories) {
        parts.push(`- **${m.key}**: ${m.content}`);
      }
    }
  }

  return {
    role: "system",
    content: parts.join("\n"),
  };
}
