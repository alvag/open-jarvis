# Coding Conventions

**Analysis Date:** 2026-03-18

## Naming Patterns

**Files:**
- snake_case for tool files: `save-memory.ts`, `get-current-time.ts`
- camelCase for index/utility files: `logger.ts`, `config.ts`
- PascalCase for files exporting classes/interfaces: `TelegramChannel` → `telegram.ts` (exception to snake_case)
- Directories use kebab-case: `built-in/`, `channels/`, `tools/`

**Functions:**
- camelCase for all function and method names: `runAgent`, `buildSystemPrompt`, `executeWith`
- Private methods use underscore prefix: `_handleIncoming` (seen in patterns, though not consistently applied)
- Async functions follow camelCase: `async execute()`, `async start()`

**Variables:**
- camelCase for local variables, parameters, and properties: `userId`, `toolsUsed`, `sessionHistory`
- SCREAMING_SNAKE_CASE for constants: `LOG_PATH`, `UPLOADS_DIR`, `EXIT_RESTART`
- Private properties prefixed with underscore: `private bot: Bot`, `private tools = new Map()`

**Types & Interfaces:**
- PascalCase for all type names: `AgentContext`, `ChatMessage`, `ToolRegistry`, `MemoryManager`
- Prefixed with `I` for interface-only abstractions: (not used in this codebase; prefer plain `interface` names)
- Suffixes for special types: `Tool` (interface), `ToolResult` (interface), `ToolContext` (interface)
- Union types use `|`: `Role = "system" | "user" | "assistant" | "tool"`

## Code Style

**Formatting:**
- No linter configured (no .eslintrc, .prettierrc, or biome.json found)
- Consistent 2-space indentation observed throughout
- Line length varies but keeps reasonable limits (100-120 chars typical)
- Imports use explicit `.js` extensions (ES modules): `import { log } from "./logger.js"`
- Double quotes for strings (observed in most files)
- Trailing semicolons used consistently

**Linting:**
- TypeScript `strict: true` mode enabled in `tsconfig.json`
- No runtime linting checks; typecheck via `npm run typecheck`
- Static analysis relies on TypeScript compiler only

## Import Organization

**Order:**
1. Node.js built-in modules: `import { mkdirSync } from "node:fs"`
2. Third-party packages: `import { Bot } from "grammy"`, `import type Database from "better-sqlite3"`
3. Local absolute imports (using .js extensions): `import { log } from "./logger.js"`
4. Type-only imports separated: `import type { AgentContext } from "../types.js"`

**Path Aliases:**
- None configured; all imports use relative paths with explicit `.js` extensions
- Directory structure implies logical grouping: `./agent/`, `./memory/`, `./tools/`, `./channels/`

**Type imports:**
- Separated using `import type` keyword: `import type { Tool } from "../tool-types.js"`
- Helps tree-shaking and clarity

## Error Handling

**Patterns:**
- Try-catch blocks with typed error coercion: `(err as Error).message`
- Failed operations return error objects with `success: false`:
  ```typescript
  return { success: false, data: null, error: `Tool error: ${(err as Error).message}` };
  ```
- Silent failures acceptable for non-critical operations (e.g., log file writes)
- Validation errors checked early and return descriptive messages
- No error throwing in tool execute methods; always return `ToolResult`

**Examples from codebase:**
- `src/tools/tool-registry.ts`: Wraps tool execution, catches errors, returns structured result
- `src/logger.ts`: Silent fail on log write errors
- `src/channels/telegram.ts`: Catches file download errors, logs them, returns user-friendly message
- `src/agent/agent.ts`: Graceful parsing fallback: `catch { args = {} }`

## Logging

**Framework:** `console` + file logging via custom `log()` function

**Patterns:**
- Central logger in `src/logger.ts` with signature: `log(level, category, message, data?)`
- Four log levels: `info`, `warn`, `error`, `debug`
- Always passes category as second parameter for organization: `log("info", "startup", "...")`
- Structured logging: optional 4th parameter for JSON data:
  ```typescript
  log("info", "tools", `${msg.userName} used tools`, { tools: result.toolsUsed });
  ```
- Logs written to file and console simultaneously
- Timestamps in ISO format: `[2026-03-18T15:30:45.123Z]`

## Comments

**When to Comment:**
- SQL queries and complex logic get inline explanatory comments
- Database triggers and migrations documented in code
- User-facing strings (especially in Spanish) may have translation hints
- Complex algorithm explanations (e.g., memory deduplication logic)

**JSDoc/TSDoc:**
- Not used in this codebase
- Tool descriptions embedded in `definition.description` field
- No formal parameter/return documentation

**Example:**
```typescript
// Deduplicate by id
const seen = new Set<number>();
const allMemories = [...relevant, ...recent].filter((m) => {
  if (seen.has(m.id)) return false;
  seen.add(m.id);
  return true;
});
```

## Function Design

**Size:**
- Most functions 20-50 lines
- Agent loop (core logic) ~70 lines
- No hard limit observed; functions decomposed logically by responsibility

**Parameters:**
- Pass objects for related parameters: `function(context: AgentContext, llm: LLMProvider, ...)`
- Avoid parameter lists > 5 items; use context objects when needed
- Async handlers use typed context objects: `MessageHandler = (msg: IncomingMessage) => Promise<ChannelResponse>`

**Return Values:**
- Tool execution always returns `ToolResult` (success/data/error structure)
- LLM chat returns `LLMChatResult` (message + model used)
- Agent returns `AgentResponse` (text + toolsUsed + images)
- Consistent return types for composability

## Module Design

**Exports:**
- Default exports for singleton tools: `export default saveMemoryTool`
- Named exports for functions/classes: `export class ToolRegistry`, `export function runAgent`
- Type exports use `export type` keyword
- Mixed exports rare; pattern is consistent per file

**Barrel Files:**
- Not used; imports are direct to source files
- No `index.ts` re-exports observed in `src/tools/`, etc.

**Pattern Example:**
```typescript
// src/tools/built-in/save-memory.ts
let memoryManagerRef: MemoryManager | null = null;

export function setMemoryManager(mm: MemoryManager): void {
  memoryManagerRef = mm;
}

const saveMemoryTool: Tool = { /* ... */ };

export default saveMemoryTool;
```

This pattern allows dependency injection without needing a DI container.

---

*Convention analysis: 2026-03-18*
