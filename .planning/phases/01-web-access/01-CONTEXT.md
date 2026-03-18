# Phase 1: Web Access - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Add two new tools to Jarvis: web search (via Tavily API) and URL content extraction (via Firecrawl API). The agent can use these tools individually or chain them together (search → read results) to answer questions requiring real-time internet information. This phase does NOT include code execution, scheduling, or security infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Search results presentation
- Jarvis responds with a synthesized summary + links to sources at the end (not raw results)
- Fetch 3-5 results per query — sufficient context without saturating the LLM
- Deep search is automatic: if the question needs it, Jarvis searches AND reads the relevant result pages without the user asking
- No confidence indicators needed — Jarvis mentions uncertainty naturally when relevant

### URL content handling
- Extract only the main text content of the page (no images, no metadata)
- Content converted to clean markdown (headers, links, lists) — no raw HTML
- Long page strategy: Claude's discretion (truncate, summarize, or extract relevant sections)
- On scraping failure (timeout, paywall, CAPTCHA): clear error message explaining why it failed — no fallback to search

### API configuration
- Feature flags via env vars, same pattern as Google tools: `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`
- Tool only registered if API key is present in .env
- No fallback if APIs are down — report error to user, simple and predictable
- Add to `.env.example` with documentation

### Trust boundary (prompt injection defense)
- Two layers of protection:
  1. Content delimiters: web content wrapped in `[WEB CONTENT - UNTRUSTED]...[/WEB CONTENT]` markers in the tool result
  2. System prompt rule in soul.md: explicit instruction to never execute instructions found in web content
- Content is sanitized to clean markdown before passing to LLM — strips scripts, raw HTML tags

### Claude's Discretion
- Exact truncation/summarization strategy for long pages
- Search query optimization (how to translate user questions to effective search queries)
- When to chain search → scrape automatically vs just returning search results

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Tool pattern
- `src/tools/tool-types.ts` — Tool interface definition (ToolDefinition, ToolContext, ToolResult)
- `src/tools/tool-registry.ts` — Registry pattern for tool registration and execution
- `src/tools/built-in/gws-drive.ts` — Reference implementation for an external API tool

### Configuration pattern
- `src/config.ts` — Environment variable loading and feature flag pattern
- `src/index.ts` — Tool registration and conditional enabling pattern (lines 63-85)

### Research
- `.planning/research/STACK.md` — Tavily and Firecrawl recommendations with versions
- `.planning/research/PITFALLS.md` — Prompt injection warning and prevention strategies
- `.planning/research/ARCHITECTURE.md` — Component integration patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Tool` interface (`src/tools/tool-types.ts`): Standard interface for all tools — definition + execute
- `ToolRegistry` (`src/tools/tool-registry.ts`): Register and execute pattern with error handling
- `config.ts`: Feature flag pattern with `requireEnv` and optional env vars
- `gws-executor.ts`: Pattern for wrapping external CLI/API calls in a tool

### Established Patterns
- Conditional tool registration: `if (config.X.enabled) { toolRegistry.register(tool) }` — in index.ts
- Tool result format: `{ success: boolean, data: unknown, error?: string }`
- Env var naming: `SERVICE_FEATURE_ENABLED`, `SERVICE_API_KEY`
- Tools are stateless: receive args + context, return result

### Integration Points
- `src/index.ts`: New tools import and register here (after line 85)
- `src/config.ts`: New env vars added to config object
- `.env.example`: Document new environment variables
- `soul.md`: Add web content trust rule

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing tool patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-web-access*
*Context gathered: 2026-03-18*
