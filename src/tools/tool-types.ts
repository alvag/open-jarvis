export interface JsonSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
    }
  >;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ToolContext {
  userId: string;
  sessionId: string;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
}

export interface Tool {
  definition: ToolDefinition;
  execute(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult>;
}
