import type { Tool, ToolContext, ToolDefinition, ToolResult } from "./tool-types.js";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" already registered`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, data: null, error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.execute(args, context);
    } catch (err) {
      return {
        success: false,
        data: null,
        error: `Tool error: ${(err as Error).message}`,
      };
    }
  }
}
