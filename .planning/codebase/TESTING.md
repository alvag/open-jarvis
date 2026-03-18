# Testing Patterns

**Analysis Date:** 2026-03-18

## Test Framework

**Status:** No automated testing framework configured

**Runner:**
- None installed; no test runner dependency in `package.json`
- No `.test.ts`, `.spec.ts`, or test file pattern found in codebase
- Testing is manual only

**Available Commands:**
```bash
npm run typecheck              # Type check without emitting
npm run build                  # Compile to dist/
npm run dev                    # Start with hot reload (tsx watch)
npm start                      # Start without watch
```

**Assertion Library:**
- None configured; not applicable without test framework

## Test File Organization

**Current State:**
- No test files present in repository
- No test directory structure (`__tests__`, `tests/`, `test/`)
- No `jest.config.js`, `vitest.config.ts`, or equivalent test config files

**If Tests Were Added (Recommended Pattern):**
- Co-located tests: `src/tools/built-in/save-memory.ts` → `src/tools/built-in/save-memory.test.ts`
- Naming: `*.test.ts` or `*.spec.ts`
- Test runner recommendation: Vitest (light, TypeScript-native, similar to Jest)

## Testing Strategy (Current Approach)

The codebase relies on **type safety and integration testing** rather than unit tests:

**Type Safety:**
- TypeScript `strict: true` enforces type correctness at compile time
- No `any` types observed; explicit typing throughout
- Interfaces for all public contracts: `Tool`, `LLMProvider`, `MemoryManager`, `Channel`

**Integration Points:**
- `src/agent/agent.ts` — integrates LLM, tools, memory; core logic tested via Telegram
- `src/channels/telegram.ts` — integrates with Grammy (Telegram bot framework)
- `src/memory/memory-manager.ts` — integrates with better-sqlite3

**Runtime Validation:**
- Config validation in `src/config.ts` — `requireEnv()` checks critical variables at startup
- Tool execution wrapped in try-catch with error reporting
- Memory operations use prepared statements (safer than string queries)

## Manual Testing Patterns (Observed in Code)

**Command-based Testing:**
```typescript
// src/channels/telegram.ts
this.bot.command("restart", async (ctx) => {
  // Direct command handler for manual testing
});
```

**Logging for Observability:**
- Structured logging in `src/logger.ts` with categories: `startup`, `router`, `agent`, `tools`, `shutdown`
- All file writes logged: duration, tools used, iterations
- Errors logged with context: `log("error", "telegram", "error downloading photo", { error: ... })`

## Mocking (Not Implemented)

**Framework:** None; no mocking libraries installed

**Approach if Testing Were Added:**
- LLM responses would be mocked for agent tests
- Memory manager would use in-memory database (better-sqlite3 supports this)
- Telegram Bot API would be mocked via integration test fixtures

**Example Pattern (for reference):**
```typescript
// Hypothetical pattern for testing agent.ts
const mockLLM: LLMProvider = {
  async chat(messages, tools, complexity) {
    return {
      message: { role: "assistant", content: "Test response" },
      model: "test-model"
    };
  }
};
```

## Fixtures and Test Data

**Current State:**
- No test fixtures or factories present
- Production databases used directly; no separate test DB configured

**If Needed:**
- Location: `src/__fixtures__/` or `test/fixtures/`
- Memory fixtures: JSON files with sample memories for user profiles
- LLM response fixtures: Sample OpenRouter API responses
- Message fixtures: Sample Telegram messages and attachments

## Coverage

**Requirements:** No coverage tracking configured; no threshold enforced

**Current Tools Available:** None (no test runner installed)

**If Vitest Were Added:**
```bash
vitest coverage               # Generate coverage report
```

## Test Types (If Implemented)

**Unit Tests (Not Currently Present):**
- Would test individual functions in isolation
- Candidates: `memory-manager.ts` search/save logic, `tool-registry.ts`, `context-builder.ts`
- Mock dependencies: MemoryManager interface, LLMProvider interface
- Estimated: 15-20 test files covering 70% of logic

**Integration Tests (Implicit, Via Bot):**
- User sends Telegram message → agent processes → memory saves → response sent
- Tools execute and return data
- Session management (timeout, message history)
- This is the primary test mechanism currently

**E2E Tests (Not Used):**
- Not applicable; bot is locally hosted
- Manual testing via Telegram is the E2E approach

## Database Testing (Key Integration)

**Setup Pattern Observed (`src/memory/db.ts`):**
- Database initialized fresh on startup
- Schema created via `db.exec()` with IF NOT EXISTS
- Migrations run automatically (versioning via `pragma user_version`)
- Better-sqlite3 supports in-memory DB for testing: `new Database(":memory:")`

**If Unit Testing Added:**
```typescript
// Hypothetical test setup
const testDb = new Database(":memory:");
const migrations = initDatabase(testDb);
const mm = createMemoryManager(testDb);

test("saveMemory creates new memory", () => {
  const result = mm.saveMemory("user123", "hobby", "Reading");
  expect(result.key).toBe("hobby");
  expect(result.content).toBe("Reading");
});
```

## Async Testing Pattern (If Tests Existed)

The codebase is heavily async (all agent/tool execution):

**Observed Patterns:**
- All tool execute methods are `async`
- Agent loop uses `await` for LLM and tool calls
- Message handlers are `async` callbacks

**If Testing Was Added:**
```typescript
// Pattern observed in agent.ts
for (let i = 0; i < maxIterations; i++) {
  const { message: response, model } = await llm.chat(messages, toolDefs, tier);
  // Would be testable with async/await in tests
}
```

## Error Handling in Code (What Would Be Tested)

**Patterns to Test (if tests existed):**

1. **Tool Registry Errors:**
```typescript
// src/tools/tool-registry.ts
const tool = this.tools.get(name);
if (!tool) {
  return { success: false, data: null, error: `Unknown tool: ${name}` };
}
try {
  return await tool.execute(args, context);
} catch (err) {
  return {
    success: false,
    data: null,
    error: `Tool error: ${(err as Error).message}`,
  };
}
```

2. **Memory Initialization Errors:**
```typescript
// src/tools/built-in/save-memory.ts
if (!memoryManagerRef) {
  return { success: false, data: null, error: "Memory manager not initialized" };
}
```

3. **JSON Parsing Fallbacks:**
```typescript
// src/agent/agent.ts
try {
  args = JSON.parse(toolCall.function.arguments);
} catch {
  args = {};  // Graceful fallback
}
```

4. **File Download Errors:**
```typescript
// src/channels/telegram.ts
try {
  const file = await ctx.api.getFile(largest.file_id);
  // ... download
} catch (err) {
  log("error", "telegram", "error downloading photo", { error: (err as Error).message });
  await ctx.reply("No pude descargar la imagen. Intentá de nuevo.");
}
```

## Environment Configuration for Testing

**Variables Used in Code:**
- `LOG_PATH` — file for logs (default: `./data/jarvis.log`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS` — required at startup
- `OPENROUTER_API_KEY` — required at startup
- `AGENT_MAX_ITERATIONS`, `SESSION_TIMEOUT_MINUTES`, `SESSION_RETENTION_DAYS` — configurable with defaults
- Optional: `GWS_*`, `BITBUCKET_*` — feature flags for integrations

**Testing Recommendation:**
```bash
# .env.test (for hypothetical tests)
TELEGRAM_BOT_TOKEN=test-token
TELEGRAM_ALLOWED_USER_IDS=123456789
OPENROUTER_API_KEY=test-api-key
DB_PATH=:memory:
LOG_PATH=/tmp/test.log
```

## Quality Metrics (Current State)

**Type Coverage:** 100% (strict TypeScript, all types explicit)

**Runtime Safety:**
- Error handling via structured `ToolResult` returns
- Config validation at startup
- SQL prepared statements (no injection risk)
- Graceful fallbacks for parsing errors

**Code Organization:**
- Clear separation of concerns (agent, tools, memory, channels, LLM)
- Dependency injection via function parameters or ref assignment
- Interface-based contracts for extensibility

---

*Testing analysis: 2026-03-18*

## Recommendation

For production reliability, consider adding:
1. **Vitest** for unit and integration tests
2. Test coverage for `src/memory/memory-manager.ts` (database logic)
3. Test coverage for `src/agent/agent.ts` (core loop logic)
4. Mocked LLM provider for agent tests
5. Database fixtures for memory tests

Start with 20-30 core tests covering happy paths and error conditions.
