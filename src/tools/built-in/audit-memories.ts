import type { Tool, ToolResult, ToolContext } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";
import { detectSensitiveData } from "../../memory/memory-sanitizer.js";

export function createAuditMemoriesTool(memoryManager: MemoryManager): Tool {
  return {
    definition: {
      name: "audit_memories",
      description:
        "Scan all stored memories for sensitive data (API keys, tokens, passwords). Returns flagged memory IDs with the type of secret detected — does NOT expose the actual secret content. Use delete_memory(id) to remove flagged entries.",
      parameters: {
        type: "object",
        properties: {},
      },
    },

    async execute(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const allMemories = memoryManager.getAllMemories(context.userId);
      const flagged: Array<{ id: number; key: string; types: string[] }> = [];

      for (const mem of allMemories) {
        const keyResult = await detectSensitiveData(mem.key);
        const contentResult = await detectSensitiveData(mem.content);
        const allTypes = [...new Set([...keyResult.types, ...contentResult.types])];
        if (keyResult.found || contentResult.found) {
          flagged.push({
            id: mem.id,
            key: keyResult.found ? `[REDACTED-${mem.id}]` : mem.key,
            types: allTypes,
          });
        }
      }

      return {
        success: true,
        data: {
          totalScanned: allMemories.length,
          flaggedCount: flagged.length,
          flagged,
          instruction:
            flagged.length > 0
              ? "Use delete_memory(id) to remove flagged memories."
              : "No sensitive data found in stored memories.",
        },
      };
    },
  };
}
