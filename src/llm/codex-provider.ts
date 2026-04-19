import type { ChatMessage } from "../types.js";
import type { ToolDefinition } from "../tools/tool-types.js";
import type { LLMChatResult, LLMProvider, TokenUsage } from "./llm-provider.js";
import { type Complexity, selectModel } from "./model-router.js";
import { loadTokens, saveTokens, type CodexTokens } from "./codex-token-store.js";
import { refreshAccessToken, decodeAccountId } from "./codex-oauth.js";
import {
  chatMessagesToResponsesInput,
  responsesOutputToChatMessage,
  toolDefsToResponsesFormat,
  type ResponsesOutputItem,
} from "./codex-message-adapter.js";
import { createLogger } from "../logger.js";

const log = createLogger("codex");

const CODEX_API_URL = "https://chatgpt.com/backend-api/codex/responses";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 120_000; // Codex requests can take longer
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const TOKEN_REFRESH_BUFFER_MS = 60_000; // Refresh 1 minute before expiry

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CodexProvider implements LLMProvider {
  private models: Record<Complexity, string>;
  private cachedTokens: CodexTokens | null = null;
  private cachedAccountId: string | null = null;
  private refreshInFlight: Promise<{ accessToken: string; accountId: string }> | null = null;

  constructor(models: Record<Complexity, string>) {
    this.models = models;

    // Verify tokens exist at startup
    const tokens = loadTokens();
    if (!tokens) {
      throw new Error(
        "Codex tokens not found. Run `npm run auth:codex` to authenticate with your ChatGPT subscription.",
      );
    }
    this.cachedTokens = tokens;
    this.cachedAccountId = decodeAccountId(tokens.access);
    log.info("Codex provider initialized");
  }

  private async ensureValidTokens(): Promise<{
    accessToken: string;
    accountId: string;
  }> {
    const tokens = this.cachedTokens ?? loadTokens();

    if (!tokens) {
      throw new Error(
        "Codex tokens not found. Run `npm run auth:codex` to re-authenticate.",
      );
    }

    // Refresh if expired or about to expire
    if (tokens.expires < Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      return this.doSerializedRefresh(tokens);
    }

    this.cachedTokens = tokens;
    const accountId = this.cachedAccountId ?? decodeAccountId(tokens.access);
    this.cachedAccountId = accountId;

    return { accessToken: tokens.access, accountId };
  }

  /**
   * Force a token refresh regardless of expiry time.
   * Used when the server returns 401 (revocation, logout, server-side invalidation).
   */
  private async forceTokenRefresh(): Promise<{
    accessToken: string;
    accountId: string;
  }> {
    const tokens = this.cachedTokens ?? loadTokens();
    if (!tokens) {
      throw new Error(
        "Codex tokens not found. Run `npm run auth:codex` to re-authenticate.",
      );
    }
    return this.doSerializedRefresh(tokens);
  }

  /**
   * Serializes concurrent refresh attempts so only one refresh hits the server.
   * Subsequent callers reuse the in-flight promise.
   */
  private async doSerializedRefresh(tokens: CodexTokens): Promise<{
    accessToken: string;
    accountId: string;
  }> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        log.info("Refreshing access token...");
        const refreshed = await refreshAccessToken(tokens.refresh);
        saveTokens(refreshed);
        this.cachedTokens = refreshed;
        this.cachedAccountId = decodeAccountId(refreshed.access);
        log.info("Token refreshed successfully");
        return { accessToken: refreshed.access, accountId: this.cachedAccountId };
      } catch (err) {
        throw new Error(
          `Token refresh failed: ${(err as Error).message}. Run \`npm run auth:codex\` to re-authenticate.`,
        );
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    model: string,
    allowAuthRetry = true,
  ): Promise<Response> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
        const delayMs =
          Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
        log.info(
          {
            attempt: attempt + 1,
            maxRetries: MAX_RETRIES,
            error: (err as Error).message,
            delayMs: Math.round(delayMs),
            model,
          },
          `Fetch failed, retrying in ${Math.round(delayMs)}ms`,
        );
        await sleep(delayMs);
        continue;
      }

      if (res.ok) return res;

      // 401: force token refresh (server-side revocation, logout, etc.) and retry once
      if (res.status === 401 && allowAuthRetry) {
        log.warn("Received 401, forcing token refresh...");
        const { accessToken, accountId } = await this.forceTokenRefresh();
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${accessToken}`);
        headers.set("chatgpt-account-id", accountId);
        return this.fetchWithRetry(
          url,
          { ...init, headers },
          model,
          false, // Don't retry auth again
        );
      }

      // 404 with usage limit — treat as rate limit
      if (res.status === 404) {
        const text = await res.text();
        if (text.includes("usage") || text.includes("limit")) {
          throw new Error(
            "ChatGPT usage limit reached. Check your subscription tier (Plus: 5hrs/week, Pro: higher limits).",
          );
        }
        throw new Error(`Codex API error 404: ${text}`);
      }

      if (!RETRYABLE_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
        const errorText = await res.text();
        throw new Error(`Codex API error ${res.status}: ${errorText}`);
      }

      let delayMs: number;
      const retryAfter = res.headers.get("retry-after");
      if (res.status === 429 && retryAfter) {
        delayMs = (parseInt(retryAfter, 10) || 1) * 1000;
      } else {
        delayMs =
          Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 500;
      }

      log.info(
        {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          status: res.status,
          delayMs: Math.round(delayMs),
          model,
        },
        `Retrying in ${Math.round(delayMs)}ms`,
      );
      await sleep(delayMs);
    }

    throw new Error("Retry loop exhausted");
  }

  /**
   * Consume an SSE stream from the Codex API and return the completed response.
   * Parses SSE blocks (separated by blank lines) and looks for `response.completed`.
   */
  private async consumeSSEStream(res: Response): Promise<{
    output: ResponsesOutputItem[];
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  }> {
    const text = (await res.text()).replaceAll("\r\n", "\n");

    // Parse SSE into blocks: each block is separated by \n\n
    const blocks = text.split("\n\n").filter((b) => b.trim());

    interface SSEBlock {
      event: string;
      data: string;
    }

    const parsedBlocks: SSEBlock[] = [];
    for (const block of blocks) {
      let event = "";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) {
          event = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          dataLines.push(line.slice(6));
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5));
        }
      }
      if (dataLines.length > 0) {
        parsedBlocks.push({ event, data: dataLines.join("") });
      }
    }

    const uniqueEvents = [...new Set(parsedBlocks.map((b) => b.event))];

    // Collect completed output items from response.output_item.done events
    const outputItems: ResponsesOutputItem[] = [];
    for (const block of parsedBlocks) {
      if (block.event === "response.output_item.done") {
        try {
          const itemData = JSON.parse(block.data);
          // The item is inside itemData.item
          const item = itemData.item ?? itemData;
          outputItems.push(item as ResponsesOutputItem);
        } catch {
          log.warn({ event: block.event }, "Failed to parse output_item.done data");
        }
      }
    }

    // Extract usage from response.completed
    let usage: { input_tokens: number; output_tokens: number; total_tokens: number } | undefined;
    const completedBlock = parsedBlocks.find((b) => b.event === "response.completed");
    if (completedBlock) {
      try {
        const raw = JSON.parse(completedBlock.data);
        const resp = raw.response ?? raw;
        usage = resp.usage;
        // If response.completed has non-empty output, use it instead
        if (resp.output && Array.isArray(resp.output) && resp.output.length > 0) {
          return { output: resp.output, usage };
        }
      } catch {
        log.warn("Failed to parse response.completed data");
      }
    }

    log.debug({ collectedItems: outputItems.length }, "Collected output items from stream");

    if (outputItems.length === 0) {
      throw new Error(
        `No output items found in SSE stream. Events: [${uniqueEvents.join(", ")}]`,
      );
    }

    return { output: outputItems, usage };
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    complexity: Complexity = "moderate",
  ): Promise<LLMChatResult> {
    const model = selectModel(complexity, this.models);
    const { accessToken, accountId } = await this.ensureValidTokens();

    // Convert messages to Responses API format
    const { instructions, input } = chatMessagesToResponsesInput(messages);

    const body: Record<string, unknown> = {
      model,
      store: false,
      stream: true,
      input,
      reasoning: { effort: "medium", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    };

    if (instructions) {
      body.instructions = instructions;
    }

    if (tools && tools.length > 0) {
      body.tools = toolDefsToResponsesFormat(tools);
    }

    const res = await this.fetchWithRetry(
      CODEX_API_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": accountId,
          "Content-Type": "application/json",
          "OpenAI-Beta": "responses=experimental",
          originator: "codex_cli_rs",
        },
        body: JSON.stringify(body),
      },
      model,
    );

    // Parse SSE stream to extract the completed response
    const data = await this.consumeSSEStream(res);

    const message = responsesOutputToChatMessage(data.output);

    const usage: TokenUsage | undefined = data.usage
      ? {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.total_tokens,
        }
      : undefined;

    return { message, model, usage };
  }
}
