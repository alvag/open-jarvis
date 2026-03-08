import type { ChatMessage } from "../types.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { Complexity } from "./model-router.js";

export interface LLMChatResult {
  message: ChatMessage;
  model: string;
}

export interface LLMProvider {
  chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    complexity?: Complexity,
  ): Promise<LLMChatResult>;
}
