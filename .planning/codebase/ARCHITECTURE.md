# Architecture

**Analysis Date:** 2025-03-18

## Pattern Overview

**Overall:** Event-driven agent loop with plugin-based tool registry and session-based conversation memory.

**Key Characteristics:**
- Modular layered architecture separating concerns (channels, LLM, tools, memory, agent logic)
- Request-response flow with agentic loop: receive message → build context → call LLM → execute tools → loop
- Tool registry pattern for dynamic tool registration and execution
- SQLite-backed persistent memory with FTS5 search for retrieval-augmented generation
- Session-based conversation tracking with configurable timeout
- Supervisor process for crash recovery and updates

## Layers

**Channel Layer:**
- Purpose: Abstract communication platform (Telegram, future Discord/Slack)
- Location: `src/channels/`
- Contains: Channel interface (`channel.ts`), platform implementations (`telegram.ts`)
- Depends on: None (defines interface contract)
- Used by: index.ts (entry point wires channels to agent handler)

**Agent Layer:**
- Purpose: Orchestrates the agentic loop and decision flow
- Location: `src/agent/`
- Contains: Agent loop (`agent.ts`), system prompt builder (`context-builder.ts`), model router (`model-router.ts`)
- Depends on: LLM provider, tool registry, memory manager
- Used by: index.ts via message handler callback

**LLM Layer:**
- Purpose: Abstracts language model interactions and model selection logic
- Location: `src/llm/`
- Contains: LLM provider interface (`llm-provider.ts`), OpenRouter implementation (`openrouter.ts`), model router (`model-router.ts`)
- Depends on: External OpenRouter API
- Used by: Agent loop for chat completions and tool calling

**Tool Layer:**
- Purpose: Plugin system for agent capabilities
- Location: `src/tools/`
- Contains: Tool interface definitions (`tool-types.ts`), registry (`tool-registry.ts`), built-in tools (`built-in/`)
- Depends on: External services (Google Workspace, Bitbucket, etc.) - conditionally
- Used by: Agent loop for execution, index.ts for registration

**Memory Layer:**
- Purpose: Persistent storage of user facts, conversation history, and sessions
- Location: `src/memory/`
- Contains: SQLite database schema (`db.ts`), memory manager API (`memory-manager.ts`), personality loader (`soul.ts`)
- Depends on: better-sqlite3 (local database)
- Used by: Agent loop for context building and history tracking

**Personality/Soul:**
- Purpose: Defines agent's behavior, tone, and rules via markdown file
- Location: `soul.md` (configurable via `SOUL_PATH`)
- Contains: Agent instructions, personality traits, operational rules
- Used by: Context builder to inject personality into system prompt

**Supervisor:**
- Purpose: Process management, crash recovery, and deployment updates
- Location: `src/supervisor.ts`
- Responsibilities: Spawn bot process, handle exit codes, auto-restart on crash, pull updates
- Exit codes: Clean (0), Restart (101), Update (102)

## Data Flow

**User Message → Response Flow:**

1. User sends message via Telegram
2. `TelegramChannel.start()` receives message via grammy bot
3. Message handler creates `IncomingMessage` with user context and attachments
4. `index.ts` resolves or creates session via `memoryManager.resolveSession()`
5. `runAgent()` called with context, LLM, tools, memory manager, soul, max iterations
6. Agent builds system prompt via `buildSystemPrompt()`: soul + AGENTS.md + date/time + relevant memories + recent memories
7. Session history loaded from `memoryManager.getSessionMessages()`
8. User message appended with attachment info (if any)
9. Agent calls LLM with messages + tool definitions + complexity tier
10. If LLM returns tool_calls:
    - Parse tool arguments
    - `toolRegistry.execute()` runs tool with userId/sessionId context
    - Tool result saved as tool role message
    - Message appended to conversation
    - Loop back to step 9
11. If no tool_calls: Return assistant's final response
12. Agent logs execution metadata (duration, tools used, model selected)
13. Channel formats response (text splitting, image rendering) and sends via Telegram
14. Check for pending restart signal (from tools) and exit if needed

**State Management:**
- **Session-level:** Per user + channel, stores conversation messages, times out after 30 minutes (configurable)
- **User-level:** Long-term memories (facts, preferences, events) retrieved via FTS5 search and temporal recency
- **Agent-level:** Transient state within `runAgent()`: message array, tools used, images collected

## Key Abstractions

**AgentContext:**
- Purpose: Encapsulates user request metadata for agent loop
- Location: `src/types.ts`
- Properties: userId, userName, channelId, sessionId, userMessage, attachments
- Pattern: Passed to `runAgent()` to track request identity

**ChatMessage:**
- Purpose: Unified message format for LLM conversation history
- Location: `src/types.ts`
- Roles: "system" (instructions), "user" (user input), "assistant" (LLM response), "tool" (tool results)
- Structure: role, content, name (optional), tool_calls (optional), tool_call_id (optional)

**Tool:**
- Purpose: Pluggable capability with definition schema and execution logic
- Location: `src/tools/tool-types.ts`
- Pattern: Exported as object with `definition` (for LLM) and `execute` (for runtime)
- Examples: `src/tools/built-in/get-current-time.ts`, `src/tools/built-in/save-memory.ts`

**MemoryManager:**
- Purpose: API for persistent memory operations (not a class, a factory returning object)
- Location: `src/memory/memory-manager.ts`
- Methods: saveMemory, searchMemories, getRecentMemories, deleteMemory, getSessionMessages, saveSessionMessage, cleanupOldSessions, resolveSession
- Search: Primary via FTS5 (full-text search), fallback to LIKE-based for edge cases

**LLMProvider:**
- Purpose: Abstract interface for language model interaction
- Location: `src/llm/llm-provider.ts`
- Methods: `chat(messages, tools?, complexity?)` → Promise<{message, model}>
- Implementations: OpenRouterProvider (translates to OpenAI-compatible API)

**Channel:**
- Purpose: Abstract interface for communication platforms
- Location: `src/channels/channel.ts`
- Methods: `start(handler)`, `stop()`, optional `broadcast()`
- Implementations: TelegramChannel (uses grammy, long polling)

## Entry Points

**Bot Process:**
- Location: `src/index.ts`
- Triggers: `npm run dev` (with tsx watch) or `npm start` (via supervisor)
- Responsibilities:
  - Initialize database and memory manager
  - Load soul.md personality
  - Register tools (built-in + conditional Google/Bitbucket)
  - Create LLM provider with model tiers
  - Start Telegram channel with message handler
  - Set up graceful shutdown handlers (SIGINT/SIGTERM)

**Supervisor Process:**
- Location: `src/supervisor.ts`
- Triggers: `npm start` or `npm start:bg`
- Responsibilities:
  - Spawn child process running `src/index.ts`
  - Monitor exit codes
  - Restart on crash with exponential backoff (max 60s)
  - Handle update (git pull) and restart requests from tools
  - Forward signals to child

**Startup Sequence:**
1. Supervisor spawns bot process
2. Bot initializes database (creates tables if needed, runs migrations)
3. Soul and AGENTS.md loaded into memory
4. Tools registered (built-in always, optional based on env)
5. Telegram channel started (long polling)
6. Broadcast startup message to all allowed user IDs
7. Ready to receive messages

## Error Handling

**Strategy:** Try-catch at tool execution level, graceful degradation at channel level.

**Patterns:**
- Tool errors caught in `toolRegistry.execute()` return `{success: false, error: message}`
- LLM errors propagate up (fail fast - if model unavailable, request fails)
- Channel errors (photo download, message send) logged and user notified
- Database errors uncaught (fail hard - indicates data corruption or I/O issue)
- Agent loop respects max iterations (returns "stuck in loop" message if exceeded)

**Logging:**
- Central logger in `src/logger.ts` with structured fields (userId, complexity, tools, etc.)
- Log levels: info, warn, error
- Categories: startup, shutdown, agent, tools, router, telegram

## Cross-Cutting Concerns

**Logging:** `log(level, category, message, metadata)` called at key points (startup, model selection, tool execution, errors)

**Validation:**
- Required env vars checked at startup (`config.ts`)
- Telegram user ID whitelist enforced in `TelegramChannel.handleIncoming()`
- Tool arguments parsed with fallback to empty object if JSON invalid
- Database migrations versioned and run automatically

**Authentication:**
- Telegram user ID whitelist checked before processing any message
- No token refresh - relies on Telegram user ID as sole identity
- Tool context includes userId/sessionId for context-aware execution

**Configuration:**
- All config via environment variables (`.env` file, never committed)
- Model tiers (simple/moderate/complex) selected by message complexity classifier
- Feature flags for Google Workspace and Bitbucket tools
- Paths configurable: database location, soul.md location

---

*Architecture analysis: 2025-03-18*
