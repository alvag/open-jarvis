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
}

export interface AgentResponse {
  text: string;
  toolsUsed: string[];
}
