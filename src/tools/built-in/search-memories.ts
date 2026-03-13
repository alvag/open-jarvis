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
        action: {
          type: "string",
          description:
            "Action: 'search' (default) or 'history' (show change history for a memory key)",
          enum: ["search", "history"],
        },
        query: {
          type: "string",
          description: "Search query to find relevant memories",
        },
        key: {
          type: "string",
          description:
            "Memory key to get history for (required for 'history' action)",
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

    const action = (args.action as string) || "search";

    if (action === "history") {
      const key = args.key as string;
      if (!key) {
        return {
          success: false,
          data: null,
          error: "key is required for 'history' action",
        };
      }

      const memories = memoryManagerRef.searchMemories(
        context.userId,
        key,
        1,
      );
      if (memories.length === 0) {
        return { success: true, data: { count: 0, history: [] } };
      }

      const history = memoryManagerRef.getMemoryHistory(memories[0].id, 10);
      return {
        success: true,
        data: {
          key,
          current: memories[0].content,
          count: history.length,
          history,
        },
      };
    }

    // Default: search action
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
