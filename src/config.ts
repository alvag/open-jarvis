import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const VALID_LLM_PROVIDERS = ["openrouter", "codex"] as const;
type LlmProvider = (typeof VALID_LLM_PROVIDERS)[number];

const rawProvider = process.env.LLM_PROVIDER || "openrouter";
if (!VALID_LLM_PROVIDERS.includes(rawProvider as LlmProvider)) {
  console.error(`Invalid LLM_PROVIDER="${rawProvider}". Must be one of: ${VALID_LLM_PROVIDERS.join(", ")}`);
  process.exit(1);
}
const llmProvider = rawProvider as LlmProvider;

export const config = {
  llmProvider,
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    allowedUserIds: requireEnv("TELEGRAM_ALLOWED_USER_IDS")
      .split(",")
      .map((id) => parseInt(id.trim(), 10)),
  },
  openrouter: {
    apiKey: llmProvider === "openrouter" ? requireEnv("OPENROUTER_API_KEY") : (process.env.OPENROUTER_API_KEY || ""),
    models: {
      simple:
        process.env.OPENROUTER_MODEL_SIMPLE ||
        "deepseek/deepseek-chat-v3-0324",
      moderate:
        process.env.OPENROUTER_MODEL_MODERATE ||
        "deepseek/deepseek-v3.2",
      complex:
        process.env.OPENROUTER_MODEL_COMPLEX ||
        "anthropic/claude-sonnet-4.6",
    },
  },
  codex: {
    models: {
      simple: process.env.CODEX_MODEL_SIMPLE || "gpt-5.4-mini",
      moderate: process.env.CODEX_MODEL_MODERATE || "gpt-5.4",
      complex: process.env.CODEX_MODEL_COMPLEX || "gpt-5.4",
    },
  },
  agent: {
    maxIterations: parseInt(process.env.AGENT_MAX_ITERATIONS || "10", 10),
    sessionTimeoutMinutes: parseInt(
      process.env.SESSION_TIMEOUT_MINUTES || "30",
      10,
    ),
    sessionRetentionDays: parseInt(
      process.env.SESSION_RETENTION_DAYS || "30",
      10,
    ),
    primaryUserId: String(
      (process.env.PRIMARY_USER_ID || process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",")[0].trim(),
    ),
  },
  google: {
    enabled: {
      drive: process.env.GWS_DRIVE_ENABLED === "true",
      gmail: process.env.GWS_GMAIL_ENABLED === "true",
      calendar: process.env.GWS_CALENDAR_ENABLED === "true",
      sheets: process.env.GWS_SHEETS_ENABLED === "true",
    },
    driveFolderIds: process.env.GWS_DRIVE_FOLDER_IDS
      ? process.env.GWS_DRIVE_FOLDER_IDS.split(",").map((id) => id.trim()).filter(Boolean)
      : [],
  },
  bitbucket: {
    enabled: !!(process.env.BITBUCKET_EMAIL && process.env.BITBUCKET_API_TOKEN),
    email: process.env.BITBUCKET_EMAIL || "",
    apiToken: process.env.BITBUCKET_API_TOKEN || "",
    defaultWorkspace: process.env.BITBUCKET_WORKSPACE || "",
    defaultRepoSlug: process.env.BITBUCKET_REPO_SLUG || "",
  },
  tavily: {
    enabled: !!process.env.TAVILY_API_KEY,
    apiKey: process.env.TAVILY_API_KEY || "",
  },
  firecrawl: {
    enabled: !!process.env.FIRECRAWL_API_KEY,
    apiKey: process.env.FIRECRAWL_API_KEY || "",
  },
  transcription: {
    enabled: !!process.env.GROQ_API_KEY,
    apiKey: process.env.GROQ_API_KEY || "",
    language: process.env.TRANSCRIPTION_LANGUAGE || "es",
  },
  paths: {
    database: process.env.DB_PATH || "./data/jarvis.db",
    soul: process.env.SOUL_PATH || "./soul.md",
  },
  scheduler: {
    timezone: process.env.SCHEDULER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
    briefingTime: process.env.BRIEFING_TIME || "07:00",
    briefingEnabled: process.env.BRIEFING_ENABLED !== "false",
    prPollIntervalMinutes: parseInt(process.env.PR_POLL_INTERVAL_MINUTES || "15", 10),
    prMonitorEnabled: process.env.PR_MONITOR_ENABLED !== "false",
    consolidationEnabled: process.env.CONSOLIDATION_ENABLED !== "false",
    consolidationTime: process.env.CONSOLIDATION_TIME || "23:00",
  },
  codebase: {
    enabled: process.env.CODEBASE_ENABLED !== "false",
    root: process.env.CODEBASE_ROOT || process.cwd(),
    maxFileSize: parseInt(process.env.CODEBASE_MAX_FILE_SIZE || "102400", 10),
    maxOutputChars: parseInt(process.env.CODEBASE_MAX_OUTPUT || "6000", 10),
    ignorePatterns: (process.env.CODEBASE_IGNORE || "node_modules,.git,dist,data,.env,*.db,codex-tokens.json,mcp_config.json,.worktrees").split(",").map(s => s.trim()),
  },
  workflow: {
    enabled: process.env.WORKFLOW_ENABLED === "true",
    defaultBranch: process.env.WORKFLOW_DEFAULT_BRANCH || "main",
    worktreesDir: process.env.WORKFLOW_WORKTREES_DIR || ".worktrees",
    branchPrefix: process.env.WORKFLOW_BRANCH_PREFIX || "jarvis",
    validationCommands: (process.env.WORKFLOW_VALIDATION_COMMANDS || "").split(",").map(s => s.trim()).filter(Boolean),
    autoCleanupWorktree: process.env.WORKFLOW_AUTO_CLEANUP_WORKTREE !== "false",
  },
  extraSafeCommands: (process.env.EXTRA_SAFE_COMMANDS || "").split(",").map(s => s.trim()).filter(Boolean),
  codeReview: {
    enabled: process.env.CODE_REVIEW_ENABLED === "true",
    times: (process.env.CODE_REVIEW_TIMES || "14:00").split(",").map(s => s.trim()).filter(Boolean),
    maxBacklogFiles: parseInt(process.env.CODE_REVIEW_MAX_BACKLOG_FILES || "3", 10),
  },
} as const;
