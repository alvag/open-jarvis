# Technology Stack

**Analysis Date:** 2025-03-18

## Languages

**Primary:**
- TypeScript 5.7.3 - All source code in `src/`
- JavaScript (ES modules) - Runtime execution via Node.js

**Secondary:**
- Markdown - Configuration via `soul.md` (personality file)
- SQL - Database schema in `src/memory/db.ts`

## Runtime

**Environment:**
- Node.js (version not pinned, implied ES2022 support)
- ES modules (`"type": "module"` in `package.json`)

**Package Manager:**
- npm (required)
- Lockfile: `package-lock.json` present and committed

## Frameworks

**Core:**
- grammy 1.35.0 - Telegram bot framework (long polling)

**Development:**
- tsx 4.21.0 - TypeScript executor with watch mode
  - Used in dev: `npm run dev` runs `tsx watch src/index.ts`
  - Used in prod: `node --import tsx src/supervisor.ts`

**Build:**
- TypeScript 5.7.3 compiler (`tsc`)
  - Output: ES2022 to `dist/` directory
  - Config: `tsconfig.json` with strict mode enabled

## Key Dependencies

**Critical:**
- better-sqlite3 12.6.2 - Local embedded database
  - WAL mode enabled in `src/memory/db.ts`
  - Provides persistence for memories and sessions

- @napi-rs/canvas 0.1.96 - Canvas rendering for table images
  - Used by `src/tools/built-in/table-image.ts` tool

- dotenv 16.4.7 - Environment variable loading (imported in `src/config.ts`)

**Built-in Globals:**
- Node.js native APIs: `child_process`, `fs`, `path`, `crypto`, `os`

## Configuration

**Environment:**
- All configuration via `.env` file (loaded in `src/config.ts`)
- Required variables validated at startup with `requireEnv()` function
- Typed configuration object exported from `config.ts`

**Environment Variables:**
- `TELEGRAM_BOT_TOKEN` - Required, Telegram Bot API token
- `TELEGRAM_ALLOWED_USER_IDS` - Required, comma-separated user IDs for access control
- `OPENROUTER_API_KEY` - Required, OpenRouter API key
- `OPENROUTER_MODEL_SIMPLE` - Model for simple queries (default: deepseek/deepseek-chat-v3-0324)
- `OPENROUTER_MODEL_MODERATE` - Model for moderate queries (default: deepseek/deepseek-v3.2)
- `OPENROUTER_MODEL_COMPLEX` - Model for complex queries (default: anthropic/claude-sonnet-4.6)
- `AGENT_MAX_ITERATIONS` - Max LLM loop iterations (default: 10)
- `SESSION_TIMEOUT_MINUTES` - Session idle timeout (default: 30)
- `SESSION_RETENTION_DAYS` - Auto-delete sessions older than N days (default: 30)
- `GWS_DRIVE_ENABLED` - Boolean for Google Drive tool
- `GWS_SHEETS_ENABLED` - Boolean for Google Sheets tool
- `GWS_GMAIL_ENABLED` - Boolean for Gmail tool
- `GWS_CALENDAR_ENABLED` - Boolean for Google Calendar tool
- `GWS_DRIVE_FOLDER_IDS` - Comma-separated folder IDs to restrict Drive access
- `BITBUCKET_EMAIL` - Email for Bitbucket authentication
- `BITBUCKET_API_TOKEN` - API token for Bitbucket Cloud (Atlassian)
- `BITBUCKET_WORKSPACE` - Default Bitbucket workspace
- `BITBUCKET_REPO_SLUG` - Default repository slug
- `DB_PATH` - SQLite database file location (default: `./data/jarvis.db`)
- `SOUL_PATH` - Personality definition file (default: `./soul.md`)

**Build:**
- `tsconfig.json` - TypeScript compilation target ES2022, ESNext modules, strict mode
- Config files checked in: `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`

## Platform Requirements

**Development:**
- Node.js with ES2022 support
- npm for package management
- Optional: `@googleworkspace/cli` (npm install -g) for Google Workspace tools
- Git (for `/update` command in supervisor)

**Production:**
- Node.js runtime with ES2022 support
- SQLite support (built-in via better-sqlite3)
- Network access to:
  - OpenRouter API (chat completions)
  - Telegram Bot API (long polling)
  - Bitbucket Cloud API (if enabled)
  - Google Workspace APIs (if enabled via gws CLI)

**Process Management:**
- Process supervision via `src/supervisor.ts` for automatic restarts
- Exit codes: 0 (clean), 1 (restart), 2 (update)

---

*Stack analysis: 2025-03-18*
