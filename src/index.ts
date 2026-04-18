import { config } from "./config.js";
import { initDatabase } from "./memory/db.js";
import { createMemoryManager } from "./memory/memory-manager.js";
import { loadSoul } from "./memory/soul.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { OpenRouterProvider } from "./llm/openrouter.js";
import { CodexProvider } from "./llm/codex-provider.js";
import { TelegramChannel } from "./channels/telegram.js";
import { GroqTranscriber } from "./transcription/transcriber.js";
import { runAgent } from "./agent/agent.js";
import { createLogger } from "./logger.js";

const log = createLogger("main");

// Built-in tools
import { addSafeCommands } from "./security/command-classifier.js";
import { createGetCurrentTimeTool } from "./tools/built-in/get-current-time.js";
import { createSaveMemoryTool } from "./tools/built-in/save-memory.js";
import { createSearchMemoriesTool } from "./tools/built-in/search-memories.js";
import { createProposeToolTool } from "./tools/built-in/propose-tool.js";
import { createGwsDriveTool } from "./tools/built-in/gws-drive.js";
import { createGwsGmailTool } from "./tools/built-in/gws-gmail.js";
import { createGwsCalendarTool } from "./tools/built-in/gws-calendar.js";
import { createGwsSheetsTool } from "./tools/built-in/gws-sheets.js";
import { createTableImageTool } from "./tools/built-in/table-image.js";
import { createBitbucketPrsTool } from "./tools/built-in/bitbucket-prs.js";
import { createRestartServerTool } from "./tools/built-in/restart-server.js";
import { createWebSearchTool } from "./tools/built-in/web-search.js";
import { createWebScrapeTool } from "./tools/built-in/web-scrape.js";
import { createExecuteCommandTool } from "./tools/built-in/execute-command.js";
import { createDeleteMemoryTool } from "./tools/built-in/delete-memory.js";
import { createListMemoriesTool } from "./tools/built-in/list-memories.js";
import { createAuditMemoriesTool } from "./tools/built-in/audit-memories.js";
import { createManageListsTool } from "./tools/built-in/manage-lists.js";
import { createSearchPersonalKnowledgeTool } from "./tools/built-in/search-personal-knowledge.js";
import { createStructuredMemoryTool } from "./tools/built-in/structured-memory.js";
import { createStructuredMemoryRepository } from "./memory/structured-memory/repository.js";
import { createStructuredMemoryService } from "./memory/structured-memory/service.js";
import { createReadFileTool } from "./tools/built-in/read-file.js";
import { createWriteFileTool } from "./tools/built-in/write-file.js";
import { createListDirectoryTool } from "./tools/built-in/list-directory.js";
import { createSearchCodeTool } from "./tools/built-in/search-code.js";
import { createCodebaseMapTool } from "./tools/built-in/codebase-map.js";
import { createAnalyzeCodebaseTool } from "./tools/built-in/analyze-codebase.js";
import { createFindRefactorCandidatesTool } from "./tools/built-in/find-refactor-candidates.js";
import { createDetectBugsTool } from "./tools/built-in/detect-bugs.js";
import { createManageBacklogTool } from "./tools/built-in/manage-backlog.js";
import { createManageCodeReviewLogTool } from "./tools/built-in/manage-code-review-log.js";
import { createGitWorktreeTool } from "./tools/built-in/git-worktree.js";
import { createGithubPrsTool } from "./tools/built-in/github-prs.js";
import { createClaudeCodeTool } from "./tools/built-in/invoke-claude-code.js";
import { runBackfillIfNeeded } from "./memory/memory-backfill.js";
import { createRepetitionDetector } from "./proactivity/repetition-detector.js";
import type { ApprovalDeps } from "./tools/built-in/approval-deps.js";
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
import { loadToolManifest } from "./tools/manifest-loader.js";
import { loadMcpConfig } from "./tools/mcp-config-loader.js";
import { McpManager } from "./mcp/mcp-manager.js";

async function main() {
  log.info("Starting Jarvis...");

  // 1. Initialize database
  const db = initDatabase(config.paths.database);
  const memoryManager = createMemoryManager(db);
  const repetitionDetector = createRepetitionDetector(db, config.repetition);

  // One-time security backfill scan
  const backfillResult = await runBackfillIfNeeded(db);
  if (!backfillResult.skipped && backfillResult.flaggedMemories.length > 0) {
    log.warn({ flagged: backfillResult.flaggedMemories.length }, "Backfill found memories with sensitive data — use audit_memories tool to review");
  }

  // Clean up old sessions
  const deletedSessions = memoryManager.cleanupOldSessions(
    config.agent.sessionRetentionDays,
  );
  if (deletedSessions > 0) {
    log.info(`Cleaned up ${deletedSessions} old sessions (>${config.agent.sessionRetentionDays} days)`);
  }

  // 2. Load personality
  const soul = loadSoul(config.paths.soul);

  // 3. Initialize Telegram channel + approval gate (needed before tool registration)
  const telegram = new TelegramChannel(
    config.telegram.botToken,
    config.telegram.allowedUserIds,
  );

  const approvalGate = createApprovalGate(db);
  telegram.setApprovalGate(approvalGate);

  if (config.transcription.enabled) {
    telegram.setTranscriber(
      new GroqTranscriber(config.transcription.apiKey, config.transcription.language)
    );
    log.info({ language: config.transcription.language }, "Voice transcription enabled (Groq Whisper)");
  }

  const approvalDeps: ApprovalDeps = {
    approvalGate,
    sendApproval: (userId, text, approvalId) =>
      telegram.sendApprovalMessage(userId, text, approvalId),
    sendResult: (userId, text) =>
      telegram.sendMessage(userId, text),
  };

  // 3b. Register extra safe commands
  if (config.extraSafeCommands.length > 0) {
    addSafeCommands(config.extraSafeCommands);
    log.info({ commands: config.extraSafeCommands }, "Extra safe commands registered");
  }

  if (config.workflow.enabled && config.workflow.validationCommands.length > 0) {
    const workflowExecutables = [...new Set(
      config.workflow.validationCommands.map(cmd => cmd.split(/\s+/)[0]),
    )];
    addSafeCommands(workflowExecutables);
    log.info({ commands: workflowExecutables }, "Workflow validation executables added to safe commands");
  }

  // 4. Register tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(createGetCurrentTimeTool());
  toolRegistry.register(createSaveMemoryTool(memoryManager));
  toolRegistry.register(createSearchMemoriesTool(memoryManager));
  toolRegistry.register(createDeleteMemoryTool(memoryManager));
  toolRegistry.register(createListMemoriesTool(memoryManager));
  toolRegistry.register(createAuditMemoriesTool(memoryManager));
  toolRegistry.register(createManageListsTool(db));
  toolRegistry.register(createSearchPersonalKnowledgeTool(memoryManager, db));

  const structuredMemoryRepo = createStructuredMemoryRepository(db);
  const structuredMemoryService = createStructuredMemoryService(
    structuredMemoryRepo,
    memoryManager,
  );
  toolRegistry.register(createStructuredMemoryTool(structuredMemoryService));
  toolRegistry.register(createProposeToolTool());
  toolRegistry.register(createTableImageTool());
  toolRegistry.register(createRestartServerTool());

  // Google Workspace tools (conditional)
  if (config.google.enabled.drive) {
    toolRegistry.register(createGwsDriveTool(config.google.driveFolderIds));
    log.info("Google Drive tool enabled");
  }
  if (config.google.enabled.gmail) {
    toolRegistry.register(createGwsGmailTool());
    log.info("Google Gmail tool enabled");
  }
  if (config.google.enabled.calendar) {
    toolRegistry.register(createGwsCalendarTool());
    log.info("Google Calendar tool enabled");
  }
  if (config.google.enabled.sheets) {
    toolRegistry.register(createGwsSheetsTool());
    log.info("Google Sheets tool enabled");
  }

  // Bitbucket tools (conditional)
  if (config.bitbucket.enabled) {
    toolRegistry.register(createBitbucketPrsTool());
    log.info("Bitbucket PRs tool enabled");
  }

  // Web tools (conditional on API keys)
  if (config.tavily.enabled) {
    toolRegistry.register(createWebSearchTool(config.tavily.apiKey));
    log.info("Web search tool enabled (Tavily)");
  }
  if (config.firecrawl.enabled) {
    toolRegistry.register(createWebScrapeTool(config.firecrawl.apiKey));
    log.info("Web scrape tool enabled (Firecrawl)");
  }

  // Codebase analysis tools (conditional)
  if (config.codebase.enabled) {
    toolRegistry.register(createReadFileTool(config.codebase));
    toolRegistry.register(createWriteFileTool(config.codebase));
    toolRegistry.register(createListDirectoryTool(config.codebase));
    toolRegistry.register(createSearchCodeTool(config.codebase));
    toolRegistry.register(createCodebaseMapTool(db));
    toolRegistry.register(createAnalyzeCodebaseTool(config.codebase));
    toolRegistry.register(createFindRefactorCandidatesTool(config.codebase));
    toolRegistry.register(createDetectBugsTool(config.codebase));
    log.info("Codebase analysis tools enabled");

    // Backlog management (always available when codebase is enabled)
    toolRegistry.register(createManageBacklogTool(db));
    log.info("Backlog management tool enabled");

    // Code review log (tracks proactive review progress)
    toolRegistry.register(createManageCodeReviewLogTool(db));
    log.info("Code review log tool enabled");
  }

  // Workflow tools (worktree + GitHub PRs)
  if (config.workflow.enabled && config.codebase.enabled) {
    toolRegistry.register(createGitWorktreeTool(config.codebase));
    toolRegistry.register(createGithubPrsTool(config.codebase.root, db));
    log.info("Workflow tools enabled (git worktree + GitHub PRs)");
  }

  // Claude Code CLI invocation (opt-in via CLAUDE_CODE_ENABLED)
  if (config.claudeCode.enabled) {
    toolRegistry.register(createClaudeCodeTool({
      approvalDeps,
      config: config.claudeCode,
    }));
    log.info(
      { allowedDirs: config.claudeCode.allowedDirs, defaultModel: config.claudeCode.defaultModel },
      "Claude Code invocation tool enabled (invoke_claude_code)",
    );
  }

  // Shell execution tool (always registered — security handled inside the tool)
  toolRegistry.register(createExecuteCommandTool(approvalDeps));
  log.info("Shell execution tool enabled (execute_command)");

  // Scheduler tools (always registered — scheduler handles enabled/disabled internally)
  toolRegistry.register(createScheduledTaskTool);
  toolRegistry.register(listScheduledTasksTool);
  toolRegistry.register(deleteScheduledTaskTool);
  toolRegistry.register(manageScheduledTaskTool);
  log.info("Scheduler tools enabled (create, list, delete, manage)");

  const builtInCount = toolRegistry.getDefinitions().length;

  // Load manifest tools (after built-ins — built-ins have collision priority)
  loadToolManifest(toolRegistry, approvalDeps);

  const manifestCount = toolRegistry.getDefinitions().length - builtInCount;

  // Connect MCP servers via McpManager (parallel startup)
  const mcpConfigs = loadMcpConfig();
  const mcpManager = new McpManager(mcpConfigs);
  const mcpSummary = await mcpManager.connectAll(toolRegistry);

  // SEC-05: Per-source tool count logging
  const totalCount = toolRegistry.getDefinitions().length;
  log.info(`Tools registered: ${builtInCount} built-in, ${manifestCount} manifest, ${mcpSummary.toolsRegistered} MCP = ${totalCount} total`);

  if (totalCount > 30) {
    log.warn(`Tool count exceeds 30 (${totalCount}) — context window budget may be impacted`);
  }

  // Derive hasMcpTools from actual registered tools (not config count)
  const hasMcpTools = mcpSummary.toolsRegistered > 0;

  // 5. Initialize LLM with model tiers
  const llm = config.llmProvider === "codex"
    ? new CodexProvider(config.codex.models)
    : new OpenRouterProvider(config.openrouter.apiKey, config.openrouter.models);

  const activeModels = config.llmProvider === "codex" ? config.codex.models : config.openrouter.models;
  log.info({ provider: config.llmProvider, models: activeModels }, "LLM provider loaded");

  // In-flight agent tracking for graceful shutdown (SUP-01)
  let inFlightCount = 0;
  let shutdownRequested = false;
  let inFlightDone: () => void = () => {};

  await telegram.start(async (msg) => {
    inFlightCount++;
    try {
      const canonicalUserId = config.agent.primaryUserId;
      const sessionId = memoryManager.resolveSession(
        canonicalUserId,
        msg.channelId,
        config.agent.sessionTimeoutMinutes,
      );

      const result = await runAgent(
        {
          userId: canonicalUserId,
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
        soul,
        config.agent.maxIterations,
        repetitionDetector,
      );

      if (result.toolsUsed.length > 0) {
        log.info({ tools: result.toolsUsed }, `${msg.userName} used tools`);
      }

      return { text: result.text, images: result.images };
    } finally {
      inFlightCount--;
      if (shutdownRequested && inFlightCount === 0) {
        inFlightDone();
      }
    }
  });

  log.info("Jarvis is online. Listening for Telegram messages...");
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
    soul,
    maxIterations: config.agent.maxIterations,
  };
  startScheduler(schedulerDeps);

  // Seed built-in tasks on first startup
  function seedBuiltInTasks(): void {
    const firstUserId = config.agent.primaryUserId;

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
        log.info({ time: config.scheduler.briefingTime, timezone: config.scheduler.timezone }, "Seeded morning briefing task");
      }
    }

    // Memory consolidation — seed if not already in DB
    if (config.scheduler.consolidationEnabled) {
      const existing = listTasks(firstUserId).find(t => t.type === "consolidation");
      if (!existing) {
        const [hours, minutes] = config.scheduler.consolidationTime.split(":").map(Number);
        const cronExpr = `${minutes} ${hours} * * *`;
        createTask({
          userId: firstUserId,
          name: "Memory Consolidation",
          type: "consolidation",
          cronExpression: cronExpr,
          prompt: "Run daily memory consolidation",
          timezone: config.scheduler.timezone,
        });
        log.info({ time: config.scheduler.consolidationTime, timezone: config.scheduler.timezone }, "Seeded memory consolidation task");
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
        log.info({ intervalMinutes: interval }, "Seeded PR monitor task");
      }
    }

    // GitHub PR monitor — cleanup worktrees + rename branches after MERGED/CLOSED
    if (config.workflow.enabled && config.codebase.enabled) {
      const existing = listTasks(firstUserId).find(t => t.type === "github-pr-monitor");
      if (!existing) {
        const interval = config.workflow.prPollIntervalMinutes;
        const cronExpr = `*/${interval} * * * *`;
        createTask({
          userId: firstUserId,
          name: "GitHub PR Monitor",
          type: "github-pr-monitor",
          cronExpression: cronExpr,
          prompt: "Poll GitHub PRs tracked in backlog, clean up worktrees/branches after MERGED or CLOSED.",
          timezone: config.scheduler.timezone,
        });
        log.info({ intervalMinutes: interval }, "Seeded GitHub PR monitor task");
      }
    }

    // Proactive code review — seed if not already in DB
    if (config.codeReview.enabled && config.codebase.enabled) {
      const existingReviews = listTasks(firstUserId).filter(t => t.type === "code-review");
      if (existingReviews.length === 0) {
        for (const time of config.codeReview.times) {
          const [hours, minutes] = time.split(":").map(Number);
          const cronExpr = `${minutes} ${hours} * * *`;
          createTask({
            userId: firstUserId,
            name: `Proactive Code Review (${time})`,
            type: "code-review",
            cronExpression: cronExpr,
            prompt: "Run proactive code review",
            timezone: config.scheduler.timezone,
            preApproved: config.codeReview.autoApprove,
          });
          log.info(
            { time, timezone: config.scheduler.timezone, preApproved: config.codeReview.autoApprove },
            "Seeded proactive code review task",
          );
        }
      } else {
        // Sync pre_approved on every code-review task to the current config value.
        // Config is the source of truth: flipping CODE_REVIEW_AUTO_APPROVE to false
        // must re-enable the approval gate on already-seeded tasks.
        const targetValue = config.codeReview.autoApprove ? 1 : 0;
        const sync = db.prepare(
          "UPDATE scheduled_tasks SET pre_approved = ?, updated_at = datetime('now') WHERE id = ?",
        );
        for (const task of existingReviews) {
          const current = task.pre_approved ? 1 : 0;
          if (current !== targetValue) {
            sync.run(targetValue, task.id);
            log.info(
              { taskId: task.id, taskName: task.name, from: current, to: targetValue },
              "Synced code-review pre_approved to CODE_REVIEW_AUTO_APPROVE",
            );
          }
        }
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
    log.info("IPC heartbeat started (10s interval)");
  }

  // Graceful shutdown (SUP-01): 15s timeout, in-flight tracking
  const shutdown = async () => {
    if (shutdownRequested) return; // Prevent double-shutdown
    shutdownRequested = true;
    log.info("Shutting down Jarvis...");

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
      log.info(`Waiting for ${inFlightCount} in-flight agent run(s)...`);
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
    log.info(`Exiting with code ${code}`);
    process.exit(code);
  };

  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}

function fatalExit(err: Error, evt: string): void {
  log.fatal({ error: err.message, stack: err.stack }, evt);
  // Flush async pino transport before exiting
  log.flush(() => process.exit(1));
  // Safety net: exit anyway after 2s if flush hangs
  setTimeout(() => process.exit(1), 2000).unref();
}

process.on("uncaughtException", (err) => {
  fatalExit(err, "Uncaught exception");
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  fatalExit(err, "Unhandled rejection");
});

main().catch((err) => {
  fatalExit(err, "Fatal error in main");
});
