# Jarvis — Personal AI Agent

## Project Overview
Jarvis is a personal AI agent that runs locally and uses Telegram as its interface. It thinks via an LLM (OpenRouter), executes tools, and remembers information persistently.

## Tech Stack
- **Runtime**: Node.js with TypeScript (ES modules)
- **Telegram**: grammy (long polling, no web server)
- **LLM**: OpenRouter (OpenAI-compatible API)
- **Speech-to-Text**: Groq Whisper (`whisper-large-v3-turbo`, voice + audio transcription)
- **Database**: better-sqlite3 (WAL mode)
- **Dev runner**: tsx (with watch mode)

## Architecture
```
src/
├── index.ts              # Entry point, wires everything
├── config.ts             # Loads .env, typed config
├── types.ts              # Shared types (ChatMessage, AgentContext)
├── agent/
│   ├── agent.ts          # Agent loop (LLM ↔ tools cycle, max iterations)
│   └── context-builder.ts # Builds system prompt (soul + memories)
├── llm/
│   ├── llm-provider.ts   # LLMProvider interface
│   └── openrouter.ts     # OpenRouter implementation
├── memory/
│   ├── db.ts             # SQLite init + schema migrations
│   ├── memory-manager.ts # Memory API (save, search, sessions)
│   └── soul.ts           # Loads soul.md personality file
├── tools/
│   ├── tool-types.ts     # Tool interface (MCP-compatible schema)
│   ├── tool-registry.ts  # Registry pattern (register, execute)
│   └── built-in/         # Built-in tools
│       ├── get-current-time.ts
│       ├── save-memory.ts
│       └── search-memories.ts
├── transcription/
│   └── transcriber.ts    # Groq Whisper adapter (voice + audio → text)
└── channels/
    ├── channel.ts        # Channel interface
    └── telegram.ts       # Grammy Telegram (text, photo, document, voice, audio)
```

## Key Patterns

### Adding a New Tool
1. Create file in `src/tools/built-in/your-tool.ts`
2. Export a `Tool` object with `definition` and `execute`
3. Import and register in `src/index.ts`

### Adding a New Channel
1. Create file in `src/channels/your-channel.ts` implementing `Channel` interface
2. Instantiate in `src/index.ts` with the same handler callback

### Agent Loop
- Receives user message → builds context (soul.md + memories + tools) → calls LLM
- If LLM returns tool_calls → executes tools → loops back to LLM
- Max iterations configurable via `AGENT_MAX_ITERATIONS` env var
- Session-based: messages grouped by 30-minute timeout

### Memory System
- **SQLite tables**: `memories` (long-term facts), `sessions`, `session_messages` (conversation history)
- **Search**: LIKE-based on key and content fields
- **Sessions**: Auto-created when last activity > timeout threshold

### Review and development workflow guidance
- Use native code tools first (`read_file`, `search_code`, `detect_bugs`, `find_refactor_candidates`, `analyze_codebase`) to gather evidence with concrete file:line references.
- Use `invoke_claude_code` as a second-pass assistant for large-scope exploration, repetitive implementation work, or alternative hypotheses.
- Treat Claude Code output as advisory until verified against actual repository files or validation commands.
- When delegating implementation work, always point Claude Code at the active git worktree rather than the main repository path.
- Good Claude Code review prompts should request: summary, findings, affected files, risks, validations attempted, and explicit uncertainty notes.

## Security
- Telegram user ID whitelist (fail closed)
- All secrets in `.env` (gitignored)
- Tool execution sandboxed in try/catch
- Agent loop iteration cap prevents infinite loops

## Commands
- `npm run dev` — Start with hot reload (tsx watch)
- `npm start` — Start without watch
- `npm run typecheck` — Type check without emitting
- `npm run build` — Compile to dist/

## Configuration
All config via `.env` — see `.env.example` for all variables.
Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `OPENROUTER_API_KEY`

## Personality
Edit `soul.md` to change Jarvis's personality, tone, and rules.

## Learned Rules

Rules added via `/learn:from` after mistakes:

- Al completar una fase del PLAN.md o un cambio significativo, siempre: (1) marcar la fase como completada en PLAN.md si existe, (2) hacer bump de versión en package.json, y (3) actualizar CHANGELOG.md con los cambios realizados — todo antes del commit final o merge.
- Para cambios grandes, relevantes o críticos que afecten el funcionamiento del bot (nuevas features, refactors de múltiples archivos, cambios en la DB o en el agent loop), siempre crear una rama `feature/` o `fix/` antes de implementar y mergear a `main` al finalizar.
- Siempre que actualices la version en `package.json`, ejecuta `npm i` inmediatamente despues para sincronizar `package-lock.json`.
