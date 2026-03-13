import { config } from "./config.js";
import { initDatabase } from "./memory/db.js";
import { createMemoryManager } from "./memory/memory-manager.js";
import { loadSoul } from "./memory/soul.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { OpenRouterProvider } from "./llm/openrouter.js";
import { TelegramChannel } from "./channels/telegram.js";
import { runAgent } from "./agent/agent.js";
import { log } from "./logger.js";

// Built-in tools
import getCurrentTime from "./tools/built-in/get-current-time.js";
import saveMemoryTool, {
  setMemoryManager as setSaveMemoryManager,
} from "./tools/built-in/save-memory.js";
import searchMemoriesTool, {
  setMemoryManager as setSearchMemoryManager,
} from "./tools/built-in/search-memories.js";
import proposeTool from "./tools/built-in/propose-tool.js";
import gwsDriveTool from "./tools/built-in/gws-drive.js";
import gwsGmailTool from "./tools/built-in/gws-gmail.js";
import gwsCalendarTool from "./tools/built-in/gws-calendar.js";
import gwsSheetsTool from "./tools/built-in/gws-sheets.js";
import tableImageTool from "./tools/built-in/table-image.js";
import bitbucketPrsTool from "./tools/built-in/bitbucket-prs.js";

async function main() {
  log("info", "startup", "Starting Jarvis...");

  // 1. Initialize database
  const db = initDatabase(config.paths.database);
  const memoryManager = createMemoryManager(db);

  // Clean up old sessions
  const deletedSessions = memoryManager.cleanupOldSessions(
    config.agent.sessionRetentionDays,
  );
  if (deletedSessions > 0) {
    log(
      "info",
      "startup",
      `Cleaned up ${deletedSessions} old sessions (>${config.agent.sessionRetentionDays} days)`,
    );
  }

  // 2. Load personality
  const soulContent = loadSoul(config.paths.soul);

  // 3. Register tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(getCurrentTime);

  // Wire memory manager into memory tools
  setSaveMemoryManager(memoryManager);
  setSearchMemoryManager(memoryManager);
  toolRegistry.register(saveMemoryTool);
  toolRegistry.register(searchMemoriesTool);
  toolRegistry.register(proposeTool);
  toolRegistry.register(tableImageTool);

  // Google Workspace tools (conditional)
  if (config.google.enabled.drive) {
    toolRegistry.register(gwsDriveTool);
    log("info", "startup", "Google Drive tool enabled");
  }
  if (config.google.enabled.gmail) {
    toolRegistry.register(gwsGmailTool);
    log("info", "startup", "Google Gmail tool enabled");
  }
  if (config.google.enabled.calendar) {
    toolRegistry.register(gwsCalendarTool);
    log("info", "startup", "Google Calendar tool enabled");
  }
  if (config.google.enabled.sheets) {
    toolRegistry.register(gwsSheetsTool);
    log("info", "startup", "Google Sheets tool enabled");
  }

  // Bitbucket tools (conditional)
  if (config.bitbucket.enabled) {
    toolRegistry.register(bitbucketPrsTool);
    log("info", "startup", "Bitbucket PRs tool enabled");
  }

  // 4. Initialize LLM with model tiers
  const llm = new OpenRouterProvider(
    config.openrouter.apiKey,
    config.openrouter.models,
  );

  log("info", "startup", "Model tiers loaded", config.openrouter.models as unknown as Record<string, unknown>);

  // 5. Start Telegram channel
  const telegram = new TelegramChannel(
    config.telegram.botToken,
    config.telegram.allowedUserIds,
  );

  await telegram.start(async (msg) => {
    const sessionId = memoryManager.resolveSession(
      msg.userId,
      msg.channelId,
      config.agent.sessionTimeoutMinutes,
    );

    const result = await runAgent(
      {
        userId: msg.userId,
        userName: msg.userName,
        channelId: msg.channelId,
        sessionId,
        userMessage: msg.text,
        attachments: msg.attachments,
      },
      llm,
      toolRegistry,
      memoryManager,
      soulContent,
      config.agent.maxIterations,
    );

    if (result.toolsUsed.length > 0) {
      log("info", "tools", `${msg.userName} used tools`, {
        tools: result.toolsUsed,
      });
    }

    return { text: result.text, images: result.images };
  });

  log("info", "startup", "Jarvis is online. Listening for Telegram messages...");

  // Graceful shutdown
  const shutdown = () => {
    log("info", "shutdown", "Shutting down Jarvis...");
    telegram.stop();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
