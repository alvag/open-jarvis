import type { Tool, ToolResult } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";

export function createSaveMemoryTool(memoryManager: MemoryManager): Tool {
  return {
    definition: {
    name: "save_memory",
    description:
      "Save a fact or piece of information about the user for future reference. Use a short, searchable key and a detailed content string.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Short label for this memory, e.g. 'birthday', 'favorite_color', 'work_project'",
        },
        content: {
          type: "string",
          description: "The actual information to remember",
        },
        category: {
          type: "string",
          description:
            "Category: 'fact', 'preference', 'event', or 'note'. Defaults to 'fact'.",
          enum: ["fact", "preference", "event", "note"],
        },
      },
      required: ["key", "content"],
    },
  },

  async execute(args, context): Promise<ToolResult> {
    const key = args.key as string;
    const content = args.content as string;
    const category = (args.category as string) || "fact";

    const memory = memoryManager.saveMemory(
      context.userId,
      key,
      content,
      category,
    );

    // Find potentially related memories for consolidation hints
    const related = memoryManager
      .searchMemories(context.userId, key, 5)
      .filter((m) => m.id !== memory.id);

    const result: Record<string, unknown> = {
      id: memory.id,
      key: memory.key,
      content: memory.content,
    };

    if (related.length > 0) {
      result.related_memories = related.map((m) => ({
        id: m.id,
        key: m.key,
        content: m.content,
      }));
      result.consolidation_hint =
        "Review the related memories above. If any are redundant or overlap with what you just saved, consider updating them to consolidate information. Use save_memory with the same key to update, or note that outdated memories may need cleanup.";
    }

    return { success: true, data: result };
  },
  };
}
