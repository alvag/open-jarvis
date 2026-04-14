import type { Tool, ToolResult, ToolContext } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";

export function createDeleteMemoryTool(memoryManager: MemoryManager): Tool {
  return {
    definition: {
      name: "delete_memory",
      description:
        "Delete a specific memory by its numeric ID. Use list_memories or audit_memories to find IDs.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "The numeric ID of the memory to delete" },
        },
        required: ["id"],
      },
    },

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const id = Number(args.id);
      if (!Number.isInteger(id) || id <= 0) {
        return { success: false, data: null, error: "Valid positive integer 'id' is required" };
      }
      const deleted = memoryManager.deleteMemory(id, context.userId);
      return deleted
        ? { success: true, data: { deleted: true, id } }
        : { success: false, data: null, error: `No memory found with id ${id}` };
    },
  };
}
