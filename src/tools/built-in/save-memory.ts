import type { Tool, ToolResult } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";

let memoryManagerRef: MemoryManager | null = null;

export function setMemoryManager(mm: MemoryManager): void {
  memoryManagerRef = mm;
}

const saveMemoryTool: Tool = {
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
    if (!memoryManagerRef) {
      return { success: false, data: null, error: "Memory manager not initialized" };
    }

    const key = args.key as string;
    const content = args.content as string;
    const category = (args.category as string) || "fact";

    const memory = memoryManagerRef.saveMemory(
      context.userId,
      key,
      content,
      category,
    );

    return {
      success: true,
      data: { id: memory.id, key: memory.key, content: memory.content },
    };
  },
};

export default saveMemoryTool;
