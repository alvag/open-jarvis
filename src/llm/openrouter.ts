import type { ChatMessage } from "../types.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { LLMChatResult, LLMProvider } from "./llm-provider.js";
import { type Complexity, selectModel } from "./model-router.js";

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private models: Record<Complexity, string>;

  constructor(apiKey: string, models: Record<Complexity, string>) {
    this.apiKey = apiKey;
    this.models = models;
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    complexity: Complexity = "moderate",
  ): Promise<LLMChatResult> {
    const model = selectModel(complexity, this.models);

    const body: Record<string, unknown> = {
      model,
      messages,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/open-jarvis",
        "X-Title": "Jarvis",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ChatMessage["tool_calls"];
        };
      }>;
    };

    const choice = data.choices[0].message;

    return {
      message: {
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls ?? undefined,
      },
      model,
    };
  }
}
