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
  channelId?: string;
  /**
   * True when the invoking context is pre-approved for risky commands
   * (e.g. scheduled tasks flagged with pre_approved=1). "Blocked" commands
   * still never run — security preserves lethal/irreversible operations.
   */
  preApproved?: boolean;
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
