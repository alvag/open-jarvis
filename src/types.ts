export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentContext {
  userId: string;
  userName: string;
  channelId: string;
  sessionId: string;
  userMessage: string;
  attachments?: { filePath: string; fileName: string }[];
  hasMcpTools?: boolean;
  /**
   * When true, tools that normally require user approval (risky shell commands)
   * will execute directly without sending an approval request. Used for
   * scheduled tasks marked pre_approved. "Blocked" commands still never run.
   */
  preApproved?: boolean;
}

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
  images?: string[];
}
