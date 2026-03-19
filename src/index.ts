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
import restartServerTool from "./tools/built-in/restart-server.js";
import webSearchTool from "./tools/built-in/web-search.js";
import webScrapeTool from "./tools/built-in/web-scrape.js";
import executeCommandTool, {
  setApprovalGate,
  setSendApproval,
  setSendResult,
} from "./tools/built-in/execute-command.js";
import { createApprovalGate } from "./security/approval-gate.js";
import {
  createScheduledTaskTool,
  listScheduledTasksTool,
  deleteScheduledTaskTool,
  manageScheduledTaskTool,
} from "./scheduler/scheduler-tools.js";
import {
  startScheduler,
  stopAll as stopScheduler,
  createTask,
  listTasks,
} from "./scheduler/scheduler-manager.js";
import type { SchedulerDeps } from "./scheduler/types.js";
import { getPendingRestart } from "./restart-signal.js";
import { loadToolManifest, setManifestApprovalGate, setManifestSendApproval, setManifestSendResult } from "./tools/manifest-loader.js";
import { loadMcpConfig } from "./tools/mcp-config-loader.js";
import { McpManager } from "./mcp/mcp-manager.js";

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
  toolRegistry.register(restartServerTool);

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

  // Web tools (conditional on API keys)
  if (config.tavily.enabled) {
    toolRegistry.register(webSearchTool);
    log("info", "startup", "Web search tool enabled (Tavily)");
  }
  if (config.firecrawl.enabled) {
    toolRegistry.register(webScrapeTool);
    log("info", "startup", "Web scrape tool enabled (Firecrawl)");
  }

  // Shell execution tool (always registered — security handled inside the tool)
  toolRegistry.register(executeCommandTool);
  log("info", "startup", "Shell execution tool enabled (execute_command)");

  // Scheduler tools (always registered — scheduler handles enabled/disabled internally)
  toolRegistry.register(createScheduledTaskTool);
  toolRegistry.register(listScheduledTasksTool);
  toolRegistry.register(deleteScheduledTaskTool);
  toolRegistry.register(manageScheduledTaskTool);
  log("info", "startup", "Scheduler tools enabled (create, list, delete, manage)");

  const builtInCount = toolRegistry.getDefinitions().length;

  // Load manifest tools (after built-ins — built-ins have collision priority)
  loadToolManifest(toolRegistry);

  const manifestCount = toolRegistry.getDefinitions().length - builtInCount;

  // Connect MCP servers via McpManager (parallel startup)
  const mcpConfigs = loadMcpConfig();
  const mcpManager = new McpManager(mcpConfigs);
  const mcpSummary = await mcpManager.connectAll(toolRegistry);

  // SEC-05: Per-source tool count logging
  const totalCount = toolRegistry.getDefinitions().length;
  log("info", "startup", `Tools registered: ${builtInCount} built-in, ${manifestCount} manifest, ${mcpSummary.toolsRegistered} MCP = ${totalCount} total`);

  if (totalCount > 30) {
    log("warn", "startup", `Tool count exceeds 30 (${totalCount}) — context window budget may be impacted`);
  }

  // Derive hasMcpTools from actual registered tools (not config count)
  const hasMcpTools = mcpSummary.toolsRegistered > 0;

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

  // Wire approval gate for shell command approvals
  const approvalGate = createApprovalGate(db);
  telegram.setApprovalGate(approvalGate);
  setApprovalGate(approvalGate);
  setSendApproval((userId, text, approvalId) =>
    telegram.sendApprovalMessage(userId, text, approvalId),
  );
  setSendResult((userId, text) =>
    telegram.sendMessage(userId, text),
  );

  // Wire approval gate for manifest tool approvals (same gate as execute_command)
  setManifestApprovalGate(approvalGate);
  setManifestSendApproval((userId, text, approvalId) =>
    telegram.sendApprovalMessage(userId, text, approvalId),
  );
  setManifestSendResult((userId, text) =>
    telegram.sendMessage(userId, text),
  );

  // In-flight agent tracking for graceful shutdown (SUP-01)
  let inFlightCount = 0;
  let shutdownRequested = false;
  let inFlightDone: () => void = () => {};

  await telegram.start(async (msg) => {
    inFlightCount++;
    try {
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
          hasMcpTools,
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
    } finally {
      inFlightCount--;
      if (shutdownRequested && inFlightCount === 0) {
        inFlightDone();
      }
    }
  });

  log("info", "startup", "Jarvis is online. Listening for Telegram messages...");
  await telegram.broadcast("Jarvis está online ✅");

  // Recover any pending approvals from before restart
  approvalGate.recoverPendingOnStartup(async (userId, message) => {
    await telegram.sendMessage(userId, message);
  });

  // 7. Initialize scheduler
  const schedulerDeps: SchedulerDeps = {
    db,
    sendMessage: (userId: string, text: string) => telegram.sendMessage(userId, text),
    runAgent,
    llm,
    toolRegistry,
    memoryManager,
    soulContent,
    maxIterations: config.agent.maxIterations,
  };
  startScheduler(schedulerDeps);

  // Seed built-in tasks on first startup
  function seedBuiltInTasks(): void {
    const firstUserId = String(config.telegram.allowedUserIds[0]);

    // Morning briefing — seed if not already in DB
    if (config.scheduler.briefingEnabled) {
      const existing = listTasks(firstUserId).find(t => t.type === "briefing");
      if (!existing) {
        const [hours, minutes] = config.scheduler.briefingTime.split(":").map(Number);
        const cronExpr = `${minutes} ${hours} * * *`;
        createTask({
          userId: firstUserId,
          name: "Morning Briefing",
          type: "briefing",
          cronExpression: cronExpr,
          prompt: `Generate the morning briefing. Use these tools in order:
1. google_calendar: action=list_events for today
2. google_gmail: action=list with is:unread filter
3. bitbucket_prs: action=list_prs state=OPEN
4. web_search: search for latest news on user's topics of interest (check memories for "news topics" or "temas de noticias")

Format the briefing as a single message with exactly these sections:
📅 *Agenda*
📧 *Emails*
🔀 *PRs*
📰 *Noticias*

Keep total under 300 words. Be concise and direct. If a tool fails or is unavailable, note it briefly and continue with the other sections.`,
          timezone: config.scheduler.timezone,
        });
        log("info", "scheduler", "Seeded morning briefing task", { time: config.scheduler.briefingTime, timezone: config.scheduler.timezone });
      }
    }

    // PR monitor — seed if not already in DB
    if (config.scheduler.prMonitorEnabled && config.bitbucket.enabled) {
      const existing = listTasks(firstUserId).find(t => t.type === "pr-monitor");
      if (!existing) {
        const interval = config.scheduler.prPollIntervalMinutes;
        const cronExpr = `*/${interval} * * * *`;
        createTask({
          userId: firstUserId,
          name: "PR Monitor",
          type: "pr-monitor",
          cronExpression: cronExpr,
          prompt: "Check Bitbucket PRs for changes and notify user of new commits, state changes, or direct mentions.",
          timezone: config.scheduler.timezone,
        });
        log("info", "scheduler", "Seeded PR monitor task", { intervalMinutes: interval });
      }
    }
  }
  seedBuiltInTasks();

  // IPC heartbeat — signals supervisor that bot is alive
  // process.send exists only when spawned with IPC channel (via supervisor)
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  if (process.send) {
    heartbeatInterval = setInterval(() => {
      process.send!({ type: "heartbeat", ts: Date.now() });
    }, 10_000);
    log("info", "startup", "IPC heartbeat started (10s interval)");
  }

  // Graceful shutdown (SUP-01): 15s timeout, in-flight tracking
  const shutdown = async () => {
    if (shutdownRequested) return; // Prevent double-shutdown
    shutdownRequested = true;
    log("info", "shutdown", "Shutting down Jarvis...");

    // 1. Clear heartbeat interval first (prevent "channel closed" errors)
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // 2. Notify Telegram
    await telegram.broadcast("Jarvis reiniciando...").catch(() => {});

    // 3. Stop scheduler (no new tasks will fire)
    stopScheduler();

    // 3b. Disconnect MCP servers
    await mcpManager.disconnectAll();

    // 4. Wait for in-flight agent runs (up to 15 seconds)
    if (inFlightCount > 0) {
      log("info", "shutdown", `Waiting for ${inFlightCount} in-flight agent run(s)...`);
      await Promise.race([
        new Promise<void>((resolve) => { inFlightDone = resolve; }),
        new Promise<void>((resolve) => setTimeout(resolve, 15_000)),
      ]);
    }

    // 5. Stop Telegram polling
    await telegram.stop().catch(() => {});

    // 6. Close database
    db.close();

    // 7. Exit with pending restart code or clean
    const code = getPendingRestart() ?? 0;
    log("info", "shutdown", `Exiting with code ${code}`);
    process.exit(code);
  };

  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}

process.on("uncaughtException", (err) => {
  log("error", "fatal", "Uncaught exception", { error: err.message, stack: err.stack });
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  log("error", "fatal", "Unhandled rejection", { error: msg, stack });
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

main().catch((err) => {
  log("error", "fatal", "Fatal error in main", { error: err.message, stack: err.stack });
  console.error("Fatal error:", err);
  process.exit(1);
});
