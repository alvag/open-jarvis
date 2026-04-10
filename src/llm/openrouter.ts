import type { ChatMessage } from "../types.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { LLMChatResult, LLMProvider, TokenUsage } from "./llm-provider.js";
import { type Complexity, selectModel } from "./model-router.js";
import { createLogger } from "../logger.js";

const log = createLogger("openrouter");

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private models: Record<Complexity, string>;

  constructor(apiKey: string, models: Record<Complexity, string>) {
    this.apiKey = apiKey;
    this.models = models;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    model: string,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        // Network error, timeout, DNS failure, socket reset
        if (attempt === MAX_RETRIES) throw err;
        const delayMs = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
        log.warn({ attempt: attempt + 1, maxRetries: MAX_RETRIES, error: (err as Error).message, delayMs: Math.round(delayMs), model }, `Fetch failed, retrying in ${Math.round(delayMs)}ms`);
        await sleep(delayMs);
        continue;
      }

      if (res.ok) return res;

      if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
        const errorText = await res.text();
        throw new Error(`OpenRouter error ${res.status}: ${errorText}`);
      }

      // Compute delay: respect retry-after on 429, otherwise exponential backoff + jitter
      let delayMs: number;
      const retryAfter = res.headers.get("retry-after");
      if (res.status === 429 && retryAfter) {
        delayMs = (parseInt(retryAfter, 10) || 1) * 1000;
      } else {
        delayMs = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
      }

      log.warn({ attempt: attempt + 1, maxRetries: MAX_RETRIES, status: res.status, delayMs: Math.round(delayMs), model }, `Retrying in ${Math.round(delayMs)}ms`);
      await sleep(delayMs);
    }

    // Unreachable, but TypeScript needs it
    throw new Error("Retry loop exhausted");
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

    const res = await this.fetchWithRetry(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/open-jarvis",
          "X-Title": "Jarvis",
        },
        body: JSON.stringify(body),
      },
      model,
    );

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ChatMessage["tool_calls"];
        };
      }>;
      usage?: TokenUsage;
    };

    const choice = data.choices[0].message;

    return {
      message: {
        role: "assistant",
        content: choice.content ?? null,
        tool_calls: choice.tool_calls ?? undefined,
      },
      model,
      usage: data.usage,
    };
  }
}
