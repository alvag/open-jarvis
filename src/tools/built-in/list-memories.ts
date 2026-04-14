import type { Tool, ToolResult, ToolContext } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";

export function createListMemoriesTool(memoryManager: MemoryManager): Tool {
  return {
    definition: {
      name: "list_memories",
      description:
        "List all stored memories for the current user, optionally filtered by category. Returns id, key, content, category, and last update date.",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by category. Omit to list all.",
            enum: ["fact", "preference", "event", "note"],
          },
        },
      },
    },

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      let memories = memoryManager.getAllMemories(context.userId);

      const category = args.category as string | undefined;
      if (category) {
        memories = memories.filter((m) => m.category === category);
      }

      return {
        success: true,
        data: {
          count: memories.length,
          memories: memories.map((m) => ({
            id: m.id,
            key: m.key,
            content: m.content,
            category: m.category,
            updated_at: m.updated_at,
          })),
        },
      };
    },
  };
}
