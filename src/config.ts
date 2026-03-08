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
  },
  paths: {
    database: process.env.DB_PATH || "./data/jarvis.db",
    soul: process.env.SOUL_PATH || "./soul.md",
  },
} as const;
