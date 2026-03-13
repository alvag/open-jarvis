import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  telegram: {
    botToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    allowedUserIds: requireEnv("TELEGRAM_ALLOWED_USER_IDS")
      .split(",")
      .map((id) => parseInt(id.trim(), 10)),
  },
  openrouter: {
    apiKey: requireEnv("OPENROUTER_API_KEY"),
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
  paths: {
    database: process.env.DB_PATH || "./data/jarvis.db",
    soul: process.env.SOUL_PATH || "./soul.md",
  },
} as const;
