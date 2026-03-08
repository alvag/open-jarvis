import type { Tool, ToolResult } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";

let memoryManagerRef: MemoryManager | null = null;

export function setMemoryManager(mm: MemoryManager): void {
  memoryManagerRef = mm;
}

const searchMemoriesTool: Tool = {
  definition: {
    name: "search_memories",
    description:
      "Search through saved memories about the user. Returns matching facts, preferences, events, and notes.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find relevant memories",
        },
        limit: {
          type: "string",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
  },

  async execute(args, context): Promise<ToolResult> {
    if (!memoryManagerRef) {
      return { success: false, data: null, error: "Memory manager not initialized" };
    }

    const query = args.query as string;
    const limit = parseInt((args.limit as string) || "5", 10);

    const memories = memoryManagerRef.searchMemories(
      context.userId,
      query,
      limit,
    );

    return {
      success: true,
      data: {
        count: memories.length,
        memories: memories.map((m) => ({
          key: m.key,
          content: m.content,
          category: m.category,
          updated_at: m.updated_at,
        })),
      },
    };
  },
};

export default searchMemoriesTool;
