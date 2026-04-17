import "dotenv/config";
import { z } from "zod";

const BoolFromString = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const IntFromString = z
  .string()
  .regex(/^-?\d+$/, "must be an integer")
  .transform((v) => parseInt(v, 10));

const CsvList = z
  .string()
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const IntCsvList = z.string().transform((v, ctx) => {
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    ctx.addIssue({ code: "custom", message: "must contain at least one value" });
    return z.NEVER;
  }
  const ids: number[] = [];
  for (const part of parts) {
    if (!/^-?\d+$/.test(part)) {
      ctx.addIssue({
        code: "custom",
        message: `"${part}" is not a valid integer`,
      });
      return z.NEVER;
    }
    ids.push(parseInt(part, 10));
  }
  return ids;
});

const TimeHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");

const TimesCsvList = z.string().transform((v, ctx) => {
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p)) {
      ctx.addIssue({
        code: "custom",
        message: `"${p}" is not a valid HH:MM time`,
      });
      return z.NEVER;
    }
  }
  return parts;
});

const envSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    TELEGRAM_ALLOWED_USER_IDS: IntCsvList,
    PRIMARY_USER_ID: z.string().optional(),

    LLM_PROVIDER: z.enum(["openrouter", "codex"]).default("openrouter"),

    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL_SIMPLE: z.string().default("deepseek/deepseek-chat-v3-0324"),
    OPENROUTER_MODEL_MODERATE: z.string().default("deepseek/deepseek-v3.2"),
    OPENROUTER_MODEL_COMPLEX: z.string().default("anthropic/claude-sonnet-4.6"),

    CODEX_MODEL_SIMPLE: z.string().default("gpt-5.4-mini"),
    CODEX_MODEL_MODERATE: z.string().default("gpt-5.4"),
    CODEX_MODEL_COMPLEX: z.string().default("gpt-5.4"),

    AGENT_MAX_ITERATIONS: IntFromString.default(10),
    SESSION_TIMEOUT_MINUTES: IntFromString.default(30),
    SESSION_RETENTION_DAYS: IntFromString.default(30),

    GWS_DRIVE_ENABLED: BoolFromString.default(false),
    GWS_GMAIL_ENABLED: BoolFromString.default(false),
    GWS_CALENDAR_ENABLED: BoolFromString.default(false),
    GWS_SHEETS_ENABLED: BoolFromString.default(false),
    GWS_DRIVE_FOLDER_IDS: CsvList.default([]),

    BITBUCKET_EMAIL: z.string().default(""),
    BITBUCKET_API_TOKEN: z.string().default(""),
    BITBUCKET_WORKSPACE: z.string().default(""),
    BITBUCKET_REPO_SLUG: z.string().default(""),

    TAVILY_API_KEY: z.string().default(""),
    FIRECRAWL_API_KEY: z.string().default(""),

    GROQ_API_KEY: z.string().default(""),
    TRANSCRIPTION_LANGUAGE: z.string().default("es"),

    DB_PATH: z.string().default("./data/jarvis.db"),
    SOUL_PATH: z.string().default("./soul.md"),

    SCHEDULER_TIMEZONE: z.string().optional(),
    BRIEFING_TIME: TimeHHMM.default("07:00"),
    BRIEFING_ENABLED: BoolFromString.default(true),
    PR_POLL_INTERVAL_MINUTES: IntFromString.default(15),
    PR_MONITOR_ENABLED: BoolFromString.default(true),
    CONSOLIDATION_ENABLED: BoolFromString.default(true),
    CONSOLIDATION_TIME: TimeHHMM.default("23:00"),

    CODEBASE_ENABLED: BoolFromString.default(true),
    CODEBASE_ROOT: z.string().optional(),
    CODEBASE_MAX_FILE_SIZE: IntFromString.default(102400),
    CODEBASE_MAX_OUTPUT: IntFromString.default(6000),
    CODEBASE_IGNORE: CsvList.default([
      "node_modules",
      ".git",
      "dist",
      "data",
      ".env",
      "*.db",
      "codex-tokens.json",
      "mcp_config.json",
      ".worktrees",
    ]),

    WORKFLOW_ENABLED: BoolFromString.default(false),
    WORKFLOW_DEFAULT_BRANCH: z.string().default("main"),
    WORKFLOW_WORKTREES_DIR: z.string().default(".worktrees"),
    WORKFLOW_BRANCH_PREFIX: z.string().default("jarvis"),
    WORKFLOW_VALIDATION_COMMANDS: CsvList.default([]),
    WORKFLOW_AUTO_CLEANUP_WORKTREE: BoolFromString.default(true),
    WORKFLOW_PR_POLL_INTERVAL_MINUTES: IntFromString.default(10),

    EXTRA_SAFE_COMMANDS: CsvList.default([]),

    CODE_REVIEW_ENABLED: BoolFromString.default(false),
    CODE_REVIEW_TIMES: TimesCsvList.default(["14:00"]),
    CODE_REVIEW_MAX_BACKLOG_FILES: IntFromString.default(3),
    CODE_REVIEW_AUTO_APPROVE: BoolFromString.default(true),

    CLAUDE_CODE_ENABLED: BoolFromString.default(false),
    CLAUDE_CODE_ALLOWED_DIRS: CsvList.default([]),
    CLAUDE_CODE_DEFAULT_MODEL: z
      .enum(["opus", "sonnet", "haiku"])
      .default("sonnet"),
    CLAUDE_CODE_TIMEOUT_MINUTES: IntFromString.default(30),
    CLAUDE_CODE_BINARY_PATH: z.string().default("claude"),

    REPETITION_DETECTION_ENABLED: BoolFromString.default(true),
    REPETITION_WINDOW_DAYS: IntFromString.default(7),
    REPETITION_THRESHOLD: IntFromString.default(3),
    REPETITION_TIGHT_WINDOW_DAYS: IntFromString.default(3),
    REPETITION_TIGHT_THRESHOLD: IntFromString.default(2),
    REPETITION_COOLDOWN_DAYS: IntFromString.default(7),
  })
  .superRefine((val, ctx) => {
    if (val.LLM_PROVIDER === "openrouter" && !val.OPENROUTER_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENROUTER_API_KEY"],
        message: "required when LLM_PROVIDER=openrouter",
      });
    }
  });

// Convert empty-string env vars to undefined so zod defaults kick in
// (preserves prior behavior where `FOO=` was treated the same as unset).
const rawEnv = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
);

const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".") || "(root)";
    console.error(`  - ${path}: ${issue.message}`);
  }
  process.exit(1);
}
const env = parsed.data;

export const config = {
  llmProvider: env.LLM_PROVIDER,
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    allowedUserIds: env.TELEGRAM_ALLOWED_USER_IDS,
  },
  openrouter: {
    apiKey: env.OPENROUTER_API_KEY ?? "",
    models: {
      simple: env.OPENROUTER_MODEL_SIMPLE,
      moderate: env.OPENROUTER_MODEL_MODERATE,
      complex: env.OPENROUTER_MODEL_COMPLEX,
    },
  },
  codex: {
    models: {
      simple: env.CODEX_MODEL_SIMPLE,
      moderate: env.CODEX_MODEL_MODERATE,
      complex: env.CODEX_MODEL_COMPLEX,
    },
  },
  agent: {
    maxIterations: env.AGENT_MAX_ITERATIONS,
    sessionTimeoutMinutes: env.SESSION_TIMEOUT_MINUTES,
    sessionRetentionDays: env.SESSION_RETENTION_DAYS,
    primaryUserId: env.PRIMARY_USER_ID ?? String(env.TELEGRAM_ALLOWED_USER_IDS[0]),
  },
  google: {
    enabled: {
      drive: env.GWS_DRIVE_ENABLED,
      gmail: env.GWS_GMAIL_ENABLED,
      calendar: env.GWS_CALENDAR_ENABLED,
      sheets: env.GWS_SHEETS_ENABLED,
    },
    driveFolderIds: env.GWS_DRIVE_FOLDER_IDS,
  },
  bitbucket: {
    enabled: !!(env.BITBUCKET_EMAIL && env.BITBUCKET_API_TOKEN),
    email: env.BITBUCKET_EMAIL,
    apiToken: env.BITBUCKET_API_TOKEN,
    defaultWorkspace: env.BITBUCKET_WORKSPACE,
    defaultRepoSlug: env.BITBUCKET_REPO_SLUG,
  },
  tavily: {
    enabled: !!env.TAVILY_API_KEY,
    apiKey: env.TAVILY_API_KEY,
  },
  firecrawl: {
    enabled: !!env.FIRECRAWL_API_KEY,
    apiKey: env.FIRECRAWL_API_KEY,
  },
  transcription: {
    enabled: !!env.GROQ_API_KEY,
    apiKey: env.GROQ_API_KEY,
    language: env.TRANSCRIPTION_LANGUAGE,
  },
  paths: {
    database: env.DB_PATH,
    soul: env.SOUL_PATH,
  },
  scheduler: {
    timezone:
      env.SCHEDULER_TIMEZONE ||
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    briefingTime: env.BRIEFING_TIME,
    briefingEnabled: env.BRIEFING_ENABLED,
    prPollIntervalMinutes: env.PR_POLL_INTERVAL_MINUTES,
    prMonitorEnabled: env.PR_MONITOR_ENABLED,
    consolidationEnabled: env.CONSOLIDATION_ENABLED,
    consolidationTime: env.CONSOLIDATION_TIME,
  },
  codebase: {
    enabled: env.CODEBASE_ENABLED,
    root: env.CODEBASE_ROOT || process.cwd(),
    maxFileSize: env.CODEBASE_MAX_FILE_SIZE,
    maxOutputChars: env.CODEBASE_MAX_OUTPUT,
    ignorePatterns: env.CODEBASE_IGNORE,
  },
  workflow: {
    enabled: env.WORKFLOW_ENABLED,
    defaultBranch: env.WORKFLOW_DEFAULT_BRANCH,
    worktreesDir: env.WORKFLOW_WORKTREES_DIR,
    branchPrefix: env.WORKFLOW_BRANCH_PREFIX,
    validationCommands: env.WORKFLOW_VALIDATION_COMMANDS,
    autoCleanupWorktree: env.WORKFLOW_AUTO_CLEANUP_WORKTREE,
    prPollIntervalMinutes: env.WORKFLOW_PR_POLL_INTERVAL_MINUTES,
  },
  extraSafeCommands: env.EXTRA_SAFE_COMMANDS,
  codeReview: {
    enabled: env.CODE_REVIEW_ENABLED,
    times: env.CODE_REVIEW_TIMES,
    maxBacklogFiles: env.CODE_REVIEW_MAX_BACKLOG_FILES,
    autoApprove: env.CODE_REVIEW_AUTO_APPROVE,
  },
  claudeCode: {
    enabled: env.CLAUDE_CODE_ENABLED,
    allowedDirs: env.CLAUDE_CODE_ALLOWED_DIRS,
    defaultModel: env.CLAUDE_CODE_DEFAULT_MODEL,
    timeoutMinutes: env.CLAUDE_CODE_TIMEOUT_MINUTES,
    binaryPath: env.CLAUDE_CODE_BINARY_PATH,
  },
  repetition: {
    enabled: env.REPETITION_DETECTION_ENABLED,
    windowDays: env.REPETITION_WINDOW_DAYS,
    threshold: env.REPETITION_THRESHOLD,
    tightWindowDays: env.REPETITION_TIGHT_WINDOW_DAYS,
    tightThreshold: env.REPETITION_TIGHT_THRESHOLD,
    cooldownDays: env.REPETITION_COOLDOWN_DAYS,
  },
} as const;
