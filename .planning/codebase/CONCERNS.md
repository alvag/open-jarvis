# Codebase Concerns

**Analysis Date:** 2025-03-18

## Tech Debt

**Session Message Storage Unbounded:**
- Issue: Session messages in database are never automatically pruned at the message level—only entire sessions older than retention days are deleted
- Files: `src/memory/db.ts` (lines 37-44), `src/memory/memory-manager.ts` (lines 109-116)
- Impact: Long-running sessions with many tool calls accumulate unbounded message records in `session_messages` table. Over months, this could cause performance degradation on session history retrieval and database growth.
- Fix approach: Implement message-level pruning (keep last N messages per session) or implement a message age cutoff independent of session retention. Add a migration to clean up old messages in existing databases.

**Tool Execution Error Handling Too Broad:**
- Issue: Tool registry catch-all silently converts all errors to generic error responses
- Files: `src/tools/tool-registry.ts` (lines 26-34)
- Impact: Distinguishes tool not found from tool execution failure, but loses stack traces and error context. Makes debugging production issues harder.
- Fix approach: Log full error context before converting to generic response; preserve error type information in response for client-side decision-making.

**Missing JSON Parse Error Handling in Agent Loop:**
- Issue: Tool call argument parsing catches all errors but silently uses empty object as fallback
- Files: `src/agent/agent.ts` (lines 99-103)
- Impact: Malformed tool arguments from LLM are masked—tool receives `{}` instead of failing with diagnostic info. Hard to detect when LLM consistently generates invalid JSON for certain tools.
- Fix approach: Log failed parses with context (tool name, raw arguments, error); consider rejecting tool call or returning error to LLM instead of masking.

**Service Initialization Single Points of Failure:**
- Issue: Main entry point has no recovery for database, config, or soul file loading failures
- Files: `src/index.ts` (lines 28-50)
- Impact: Missing `.env` or database corruption causes unhandled crash with no graceful degradation. Supervisor will restart indefinitely if issue persists.
- Fix approach: Wrap initialization steps in try-catch with informative logging; fail fast with clear error message; optionally provide fallback defaults for non-critical config.

## Known Bugs

**Session Resolution Race Condition:**
- Symptoms: Two concurrent requests from same user within session timeout may create duplicate sessions or touch wrong session
- Files: `src/memory/memory-manager.ts` (lines 232-250)
- Trigger: Simultaneous Telegram messages from same user within 30-minute window
- Workaround: Not practically exploitable at single-user scale, but becomes issue if implementing multi-session per user
- Root cause: `resolveSession` reads then writes without transaction. Better-sqlite3 serializes by default but application logic isn't atomic.

**Typing Indicator Cleanup on Handler Crash:**
- Symptoms: If agent handler throws, typing indicator interval continues running until handler promise settles
- Files: `src/channels/telegram.ts` (lines 134-167)
- Trigger: Agent throws uncaught exception during request handling
- Workaround: Supervisor restarts process after ~30s when max request timeout hit
- Root cause: `finally` block runs but interval only cleared after try/catch, not after handler rejection.

**FTS5 Query Fallback Silent Failure:**
- Symptoms: If FTS query malformed, falls back to LIKE search without logging
- Files: `src/memory/memory-manager.ts` (lines 151-164)
- Trigger: Special characters in memory search query that FTS5 can't parse
- Workaround: Search works but with degraded ranking; user won't know FTS was skipped
- Root cause: Error is caught and silently ignored; no logging or metrics

## Security Considerations

**API Credentials in URL and Headers:**
- Risk: Bitbucket credentials are basic auth (username:apitoken in header); OpenRouter API key in header
- Files: `src/tools/bitbucket-api.ts` (lines 5-10), `src/llm/openrouter.ts` (lines 38-45)
- Current mitigation: Credentials loaded from environment variables; HTTPS enforced in fetch calls
- Recommendations:
  - Add request/response logging guards to prevent credentials appearing in logs
  - Consider using Bearer tokens instead of Basic auth for Bitbucket if available
  - Implement rate limiting on API calls to reduce exposure window on compromised credentials

**Telegram Bot Token Exposure Risk:**
- Risk: Bot token passed to grammy and used in file download URLs
- Files: `src/channels/telegram.ts` (lines 18, 53)
- Current mitigation: Token from environment; not logged; user ID whitelist enforced
- Recommendations:
  - Ensure bot token never appears in logs (add logging guard)
  - Implement optional proxy for Telegram file downloads to avoid exposing token to clients
  - Add audit trail for sensitive operations (file uploads, memory saves)

**File Upload Validation Missing:**
- Risk: Files downloaded from Telegram and written to disk with minimal validation
- Files: `src/channels/telegram.ts` (lines 46-101)
- Current mitigation: MIME type check on documents; files written to `/data/uploads` with timestamp names
- Recommendations:
  - Add file size limits (currently unbounded)
  - Add virus/malware scanning on uploaded files before processing
  - Validate file contents match claimed MIME type
  - Implement upload quota per user

**Unescaped GWS CLI Arguments:**
- Risk: Folder IDs and file names passed directly to `gws` shell command without proper escaping
- Files: `src/tools/built-in/gws-drive.ts` (lines 59-62, 93-96), others
- Current mitigation: None—IDs are user-controlled via tool invocation
- Recommendations:
  - Use parameterized approach if gws CLI supports it (check `--params` behavior)
  - If not, implement strict validation/escaping for all arguments passed to `runGws`
  - Consider sandboxing gws in restricted environment

## Performance Bottlenecks

**FTS5 Index Rebuild on Every Search:**
- Problem: FTS5 query used on every search but may not be efficiently ranked
- Files: `src/memory/memory-manager.ts` (lines 61-68, 141-174)
- Cause: FTS5 index created in migration but ranking may not be optimal for semantic search; fallback to LIKE is O(n)
- Improvement path: Profile FTS5 queries in real data; consider using BM25 parameters; evaluate if LIKE-only search sufficient for small memory sets

**Agent Loop Iteration Safety:**
- Problem: Agent can make up to 10 iterations (configurable) per request; each iteration calls LLM (API call, latency)
- Files: `src/agent/agent.ts` (lines 64-127), `src/config.ts` (line 34)
- Cause: No circuit breaker or early exit for looping patterns; LLM can keep generating tool calls indefinitely until max iterations
- Improvement path: Implement detection for repetitive tool calls; add iteration cost tracking; implement exponential backoff on repeated failures

**Session Message Loading Into Memory:**
- Problem: Entire session history loaded into memory for context; no pagination on getSessionMessages
- Files: `src/memory/memory-manager.ts` (lines 192-213), `src/agent/agent.ts` (lines 30, 42-46)
- Cause: Session history unbounded; could hit memory limit on long sessions
- Improvement path: Implement sliding window (last N messages); add summary compression for old messages; lazy-load on demand

**Database Synchronous I/O:**
- Problem: All database operations are synchronous (better-sqlite3 doesn't have async support)
- Files: `src/memory/db.ts`, `src/memory/memory-manager.ts`
- Cause: better-sqlite3 design choice; blocks event loop during queries
- Improvement path: For high concurrency scenarios, evaluate migration to async DB (e.g., sqlite3 npm package or other solutions); or implement connection pooling/worker threads

## Fragile Areas

**Context Builder System Prompt Assembly:**
- Files: `src/agent/context-builder.ts` (lines 5-77)
- Why fragile: System prompt is string concatenation of soul.md + optional AGENTS.md + memories. If AGENTS.md is missing, continues silently. If memory search fails, malformed prompt sent to LLM.
- Safe modification: Always validate all prompt parts exist and contain expected content; test system prompt structure with real LLM calls; add schema validation for prompt format.
- Test coverage: No tests for prompt generation; no validation that resulting prompt is valid for LLM

**GWS Integration Tight Coupling:**
- Files: `src/tools/built-in/gws-*.ts`, `src/tools/gws-executor.ts`
- Why fragile: All GWS tools depend on external `gws` CLI being installed and authenticated. Auth happens outside the app (gws auth login). No connection pooling or retry logic.
- Safe modification: Mock gws CLI in tests; add pre-flight check on tool registration; implement timeout and retry with exponential backoff; add clear documentation on gws setup.
- Test coverage: No tests for GWS tools; failures only caught at runtime

**Tool Definition JSON Schema Generation:**
- Files: `src/tools/tool-types.ts`, `src/llm/openrouter.ts` (lines 27-35)
- Why fragile: Tool definitions must be valid OpenAI function_calling schema. If parameters object is malformed, LLM will silently ignore the tool. No validation of schema structure.
- Safe modification: Implement JSON schema validator; test each tool definition against spec; add CI check that all tool schemas are valid.
- Test coverage: None

**Telegram Message Handling Exception Flow:**
- Files: `src/channels/telegram.ts` (lines 134-175)
- Why fragile: Exception in handler is caught but response user sees is generic "Something went wrong". User doesn't know if it's their message, API error, or tool failure. Retry logic is up to user.
- Safe modification: Categorize errors (validation, API, tool execution) and provide specific feedback; add request ID for debugging; log full context.
- Test coverage: No tests for error flows

## Scaling Limits

**Single-User System:**
- Current capacity: 1 user (configurable with whitelist)
- Limit: No multi-tenancy support; no rate limiting per user; session management assumes single actor
- Scaling path: Implement user isolation in memory manager; add per-user rate limiting; partition session data by user; implement multi-channel support with user→channel mapping

**Database WAL Mode Disk Space:**
- Current capacity: Better-sqlite3 with WAL mode uses write-ahead log file
- Limit: No automatic WAL checkpoint; WAL file can grow unbounded if process never fully closes
- Scaling path: Implement periodic checkpoint; set WAL size limits; monitor WAL file size in health checks

**LLM Context Window:**
- Current capacity: Session history + soul.md + 7 relevant memories + 5 recent memories = ~12K tokens typical
- Limit: OpenRouter models vary; Sonnet 4.6 has 200K tokens but costs scale; no context compression
- Scaling path: Implement message summarization for old context; add compression for old memories; implement query-based context reduction instead of time-based

**File Upload Handling:**
- Current capacity: No limits on file size or concurrent uploads
- Limit: Single-threaded processing; large files block message handling; disk space unbounded
- Scaling path: Implement async file processing; add size quotas; implement cleanup of old uploads; move to cloud storage

## Dependencies at Risk

**better-sqlite3 Native Binding:**
- Risk: Pure Node.js library but requires native compilation; breaks on Node.js version mismatches or M1/M2 architecture issues
- Impact: Installation fails on some environments; hard to troubleshoot for non-developers
- Current version: ^12.6.2
- Migration plan: Keep as-is for single-user personal use; if scaling, evaluate:
  - `sql.js` (pure JS, in-memory or local filesystem)
  - `better-sql-pool` for read replicas
  - Migrate to PostgreSQL for multi-user scenarios

**grammy Telegram Bot Framework:**
- Risk: Unmaintained or breaking changes in Telegram Bot API; long polling is reliable but inefficient compared to webhooks
- Impact: Bot may stop working if Telegram API changes; increases polling latency
- Current version: ^1.35.0
- Migration plan: Keep maintained version; if issues arise, implement webhook support for reduced latency; maintain fallback to long polling

**@napi-rs/canvas for Table Image Generation:**
- Risk: Native Rust binding; less mature than canvas.js; potential security issues in image processing
- Impact: Table image tool crashes crash entire process; if dependency becomes unmaintained, security patches unavailable
- Current version: ^0.1.96
- Migration plan: Evaluate alternative pure-JS libraries (skia-canvas, sharp for static text); implement graceful degradation if canvas fails

## Missing Critical Features

**Request Timeout and Cancellation:**
- Problem: Agent handler has no explicit timeout; relies on Telegram's implicit timeout
- Blocks: Long-running operations (large file processing, complex tool chains) hang indefinitely
- Impact: Telegram UI freezes; user must force-quit to stop; supervisor restart loses context

**Structured Logging:**
- Problem: Logs are plain text in file; no structured format for parsing or alerting
- Blocks: Monitoring; error tracking; usage analytics
- Impact: Hard to diagnose issues in production; no alerts on errors

**Memory Consolidation:**
- Problem: Memories accumulate with duplicates and outdated entries; no deduplication or cleanup
- Blocks: Long-term memory quality degrades; context window fills up with noise
- Impact: Agent becomes less effective over time; wastes context on stale information

**Tool Execution Sandboxing:**
- Problem: Tools run in main process; a tool crash crashes entire bot
- Blocks: Safe third-party tool integration; protection against runaway processes
- Impact: Unstable tools or tools with resource leaks destabilize the bot

## Test Coverage Gaps

**Agent Loop:**
- What's not tested: End-to-end agent execution with tool calls; error recovery; iteration limits
- Files: `src/agent/agent.ts`
- Risk: Regressions in core agent behavior go undetected; breaking changes to LLM format not caught until runtime
- Priority: High

**Memory System:**
- What's not tested: FTS5 search correctness; memory history; session cleanup; concurrent access patterns
- Files: `src/memory/memory-manager.ts`, `src/memory/db.ts`
- Risk: Database corruption or data loss on upgrade; search results incorrect; memory leaks
- Priority: High

**Telegram Channel Message Handling:**
- What's not tested: Photo/document download errors; Telegram API failures; markup parsing; message splitting logic
- Files: `src/channels/telegram.ts`
- Risk: File upload feature breaks silently; malformed responses; failures in error recovery
- Priority: Medium

**External API Integrations (GWS, Bitbucket):**
- What's not tested: CLI tool failures; API errors; timeout handling; credential issues
- Files: `src/tools/gws-executor.ts`, `src/tools/bitbucket-api.ts`, `src/tools/built-in/gws-*.ts`, `src/tools/built-in/bitbucket-prs.ts`
- Risk: Tools fail silently or with cryptic errors; no detection of misconfiguration until tool invoked
- Priority: Medium

**Tool Registry and Execution:**
- What's not tested: Tool registration conflicts; missing tool handling; execution error mapping
- Files: `src/tools/tool-registry.ts`
- Risk: Silently registered tools overwrite each other; tool names hardcoded in prompts may not match registry
- Priority: Low

---

*Concerns audit: 2025-03-18*
