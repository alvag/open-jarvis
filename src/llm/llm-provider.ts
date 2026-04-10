import type { ChatMessage } from "../types.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { Complexity } from "./model-router.js";

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LLMChatResult {
  message: ChatMessage;
  model: string;
  usage?: TokenUsage;
}

export interface LLMProvider {
  chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    complexity?: Complexity,
  ): Promise<LLMChatResult>;
}
