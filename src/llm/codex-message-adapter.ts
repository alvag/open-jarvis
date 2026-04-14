import type { ChatMessage, ToolCall } from "../types.js";
import type { ToolDefinition } from "../tools/tool-types.js";

// --- Responses API types ---

interface ResponsesInputText {
  type: "input_text";
  text: string;
}

interface ResponsesOutputText {
  type: "output_text";
  text: string;
}

interface ResponsesMessage {
  type: "message";
  role: "developer" | "user" | "assistant";
  content: (ResponsesInputText | ResponsesOutputText)[];
}

interface ResponsesFunctionCall {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
}

interface ResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ResponsesInputItem =
  | ResponsesMessage
  | ResponsesFunctionCall
  | ResponsesFunctionCallOutput;

interface ResponsesOutputMessage {
  type: "message";
  content: { type: "output_text"; text: string }[];
}

interface ResponsesOutputFunctionCall {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
}

export type ResponsesOutputItem =
  | ResponsesOutputMessage
  | ResponsesOutputFunctionCall;

// --- Conversion functions ---

/**
 * Converts ChatMessage[] to Responses API input items.
 * System messages are returned separately as `instructions`.
 */
export function chatMessagesToResponsesInput(messages: ChatMessage[]): {
  instructions: string | undefined;
  input: ResponsesInputItem[];
} {
  let instructions: string | undefined;
  const input: ResponsesInputItem[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
        // Concatenate system messages into instructions
        if (msg.content) {
          instructions = instructions
            ? `${instructions}\n\n${msg.content}`
            : msg.content;
        }
        break;

      case "user":
        input.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: msg.content ?? "" }],
        });
        break;

      case "assistant": {
        // Add text content as message if present
        if (msg.content) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: msg.content }],
          });
        }
        // Add each tool call as a separate function_call item
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            input.push({
              type: "function_call",
              name: tc.function.name,
              arguments: tc.function.arguments,
              call_id: tc.id,
            });
          }
        }
        break;
      }

      case "tool":
        input.push({
          type: "function_call_output",
          call_id: msg.tool_call_id ?? "",
          output: msg.content ?? "",
        });
        break;
    }
  }

  return { instructions, input };
}

/**
 * Converts Responses API output items back to a ChatMessage.
 */
export function responsesOutputToChatMessage(
  output: ResponsesOutputItem[],
): ChatMessage {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const item of output) {
    if (item.type === "message") {
      for (const c of item.content) {
        if (c.type === "output_text" && c.text) {
          textParts.push(c.text);
        }
      }
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments,
        },
      });
    }
  }

  return {
    role: "assistant",
    content: textParts.length > 0 ? textParts.join("\n") : null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

/**
 * Converts ToolDefinition[] to the Responses API function tool format.
 */
export function toolDefsToResponsesFormat(
  tools: ToolDefinition[],
): { type: "function"; name: string; description: string; parameters: unknown }[] {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
