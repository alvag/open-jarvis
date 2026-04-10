import type { AgentContext, AgentResponse, ChatMessage } from "../types.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { MemoryManager } from "../memory/memory-manager.js";
import { buildSystemPrompt } from "./context-builder.js";
import { classifyComplexity } from "../llm/model-router.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent");

export async function runAgent(
  context: AgentContext,
  llm: LLMProvider,
  toolRegistry: ToolRegistry,
  memoryManager: MemoryManager,
  soulContent: string,
  maxIterations: number,
): Promise<AgentResponse> {
  const startTime = Date.now();
  const toolsUsed: string[] = [];
  const images: string[] = [];

  // Build system prompt with personality + memories
  const systemMessage = buildSystemPrompt(
    soulContent,
    context.userId,
    context.userMessage,
    memoryManager,
    context.hasMcpTools ?? false,
  );

  // Load session history
  const sessionHistory = memoryManager.getSessionMessages(context.sessionId);

  // Build user content with attachment info
  let userContent = context.userMessage;
  if (context.attachments && context.attachments.length > 0) {
    const attachmentInfo = context.attachments
      .map((a) => `[Archivo adjunto: ${a.fileName}, guardado en ${a.filePath}]`)
      .join("\n");
    userContent = `${attachmentInfo}\n\n${userContent}`;
  }

  // Build messages array
  const messages: ChatMessage[] = [
    systemMessage,
    ...sessionHistory,
    { role: "user", content: userContent },
  ];

  // Save user message to session
  memoryManager.saveSessionMessage(context.sessionId, {
    role: "user",
    content: userContent,
  });

  // Get tool definitions
  const toolDefs = toolRegistry.getDefinitions();

  // Classify message complexity for model routing
  const complexity = classifyComplexity(
    context.userMessage,
    toolDefs.length > 0,
  );

  // Agent loop
  for (let i = 0; i < maxIterations; i++) {
    // Use complexity for first call, then "complex" for tool follow-ups
    const tier = i === 0 ? complexity : "complex";
    const { message: response, model } = await llm.chat(messages, toolDefs, tier);

    if (i === 0) {
      log.info({ userId: context.userId, userName: context.userName, complexity, model }, `${complexity} → ${model}`);
    }

    messages.push(response);
    memoryManager.saveSessionMessage(context.sessionId, response);

    // No tool calls — we have the final answer
    if (!response.tool_calls || response.tool_calls.length === 0) {
      log.info({ userId: context.userId, durationMs: Date.now() - startTime, toolsUsed, iterations: i + 1 }, "response complete");
      return {
        text: response.content || "I have nothing to say.",
        toolsUsed,
        images: images.length > 0 ? images : undefined,
      };
    }

    // Execute each tool call
    for (const toolCall of response.tool_calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      const result = await toolRegistry.execute(
        toolCall.function.name,
        args,
        { userId: context.userId, sessionId: context.sessionId },
      );

      const toolMessage: ChatMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      };

      messages.push(toolMessage);
      memoryManager.saveSessionMessage(context.sessionId, toolMessage);
      toolsUsed.push(toolCall.function.name);

      // Collect image paths from tool results
      const resultData = result.data as Record<string, unknown> | null;
      if (resultData?.imagePath) {
        images.push(resultData.imagePath as string);
      }
    }
  }

  // Hit max iterations
  return {
    text: "I got stuck in a loop. Let me try a different approach.",
    toolsUsed,
    images: images.length > 0 ? images : undefined,
  };
}
