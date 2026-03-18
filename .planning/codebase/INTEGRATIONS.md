# External Integrations

**Analysis Date:** 2025-03-18

## APIs & External Services

**LLM Providers:**
- OpenRouter - Primary LLM service for agent reasoning
  - SDK/Client: Native `fetch()` (OpenAI-compatible API)
  - Endpoint: `https://openrouter.ai/api/v1/chat/completions`
  - Auth: `OPENROUTER_API_KEY` (Bearer token)
  - Implementation: `src/llm/openrouter.ts`
  - Model routing: Complexity-based selection (simple/moderate/complex)
    - Models configurable via `OPENROUTER_MODEL_SIMPLE`, `OPENROUTER_MODEL_MODERATE`, `OPENROUTER_MODEL_COMPLEX`
    - Default models: Deepseek (simple/moderate), Claude Sonnet 4.6 (complex)

**Collaboration & Development:**
- Bitbucket Cloud API - Pull request and repository access
  - SDK/Client: Native `fetch()` with Basic auth
  - Base URL: `https://api.bitbucket.org/2.0`
  - Auth: Basic authentication with `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`
  - Implementation: `src/tools/bitbucket-api.ts`, `src/tools/built-in/bitbucket-prs.ts`
  - Enabled: Via `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` env vars
  - Workspace/repo: Configurable defaults via `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`

## Data Storage

**Databases:**
- SQLite (better-sqlite3 12.6.2) - Local embedded database
  - Connection: File-based at `DB_PATH` (default: `./data/jarvis.db`)
  - Client: better-sqlite3 synchronous API
  - Schema location: `src/memory/db.ts`
  - Tables:
    - `memories` - Long-term facts with user_id, key, content, category
    - `sessions` - Conversation sessions grouped by 30-minute timeout
    - `session_messages` - Chat history per session
    - `memory_history` - Audit trail for memory changes
    - `memories_fts` - Full-text search index on memories
  - Pragmas: WAL mode (write-ahead logging), foreign keys enabled
  - Migrations: Schema versioned with user_version pragma

**File Storage:**
- Local filesystem only
  - Uploads directory: `./data/uploads`
  - Soul/personality: `SOUL_PATH` (default: `./soul.md`)
  - Database: `./data/jarvis.db`
  - Photo attachments from Telegram saved locally before processing

**Caching:**
- None detected - State is ephemeral in memory or persistent in SQLite

## Authentication & Identity

**Telegram:**
- Auth Provider: Telegram Bot API
  - Token: `TELEGRAM_BOT_TOKEN`
  - Access control: User ID whitelist via `TELEGRAM_ALLOWED_USER_IDS`
  - Fail-closed: Unauthorized users get "Access denied" message
  - Implementation: `src/channels/telegram.ts`

**Google Workspace:**
- Auth Provider: Google Workspace CLI (`@googleworkspace/cli`)
  - Command: `gws auth login` (interactive, not programmatic)
  - Session: Stored by gws CLI locally
  - Scopes: Drive, Gmail, Calendar, Sheets (as configured)
  - Implementation: `src/tools/gws-executor.ts` (spawns gws CLI subprocess)
  - Tools: Conditional registration based on `GWS_*_ENABLED` flags
  - Folder restriction: Optional via `GWS_DRIVE_FOLDER_IDS`

**Bitbucket:**
- Auth Provider: Atlassian API Token (Basic auth)
  - Credentials: `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`
  - No OAuth - static token-based authentication
  - Tool enabled: When both email and token are configured

## Monitoring & Observability

**Error Tracking:**
- None detected - No Sentry, DataDog, or similar

**Logs:**
- Console output via `src/logger.ts`
- Structured logging with levels: info, warn, error
- Supervisor logs to stdout and optionally `nohup` to `/tmp/jarvis.log` (via `npm run start:bg`)

## CI/CD & Deployment

**Hosting:**
- Self-hosted only
- Process: Node.js running locally or on a server
- Supervisor: `src/supervisor.ts` handles restarts and auto-update

**CI Pipeline:**
- None detected - No GitHub Actions, GitLab CI, or similar

**Update Mechanism:**
- Manual via `/update` Telegram command
- Supervisor executes `git pull` then restarts bot
- Exit code 2 (EXIT_UPDATE) triggers pull → restart flow

**Auto-Restart:**
- Supervisor `src/supervisor.ts` monitors bot process
- Exponential backoff on crashes (1s → 60s max)
- Resets backoff if uptime > 30 seconds (stable)
- Restart codes: EXIT_RESTART (1) and EXIT_UPDATE (2)

## Environment Configuration

**Required env vars:**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- `OPENROUTER_API_KEY`

**Optional but Feature-Gating:**
- `GWS_DRIVE_ENABLED`, `GWS_SHEETS_ENABLED`, `GWS_GMAIL_ENABLED`, `GWS_CALENDAR_ENABLED`
- `BITBUCKET_EMAIL`, `BITBUCKET_API_TOKEN` (both required to enable Bitbucket)

**Secrets location:**
- `.env` file (gitignored, example template at `.env.example`)
- Google Workspace: Stored by gws CLI at `~/.config/gws/` or similar
- Bitbucket: Static token in `.env`

## Webhooks & Callbacks

**Incoming:**
- Telegram long polling (not webhooks)
  - Implemented via grammy Bot API
  - `src/channels/telegram.ts` handles incoming messages/photos/documents

**Outgoing:**
- None detected - No webhook subscriptions or external callbacks

## File Attachments & Media

**From Telegram:**
- Photos: Downloaded from Telegram API, saved to `./data/uploads/`
  - Largest resolution selected automatically
  - Filename: `photo_${timestamp}.jpg`

- Documents: Downloaded if image or PDF, saved locally
  - MIME type checked before processing

- Processing: Attachment paths passed to agent for tool use (e.g., Google Drive upload)

## Rate Limiting & Timeouts

**OpenRouter:**
- API calls wrapped in try-catch with timeout handling
- Default fetch timeout: None (relies on client timeout if specified)

**Telegram:**
- Bot.api: Grammar handles rate limits
- Typing indicator refreshed every 4 seconds during agent execution

**Bitbucket:**
- 30-second timeout per API request
- HTTP 429 (rate limit) detected and reported

**Google Workspace:**
- gws CLI subprocess: 30-second timeout per command
- Long operations may require pagination

---

*Integration audit: 2025-03-18*
