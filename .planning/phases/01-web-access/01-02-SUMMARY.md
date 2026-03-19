---
phase: 01-web-access
plan: 02
subsystem: tools
tags: [tavily, firecrawl, web-search, web-scrape, prompt-injection, trust-boundary]

# Dependency graph
requires:
  - "config.ts exports tavily block with enabled flag and apiKey"
  - "config.ts exports firecrawl block with enabled flag and apiKey"
  - "Tavily SDK (@tavily/core@0.7.2) installed and importable"
  - "Firecrawl SDK (@mendable/firecrawl-js@4.16.0) installed and importable"
  - "soul.md contains web content trust rule"
provides:
  - "web_search tool registered when TAVILY_API_KEY is present"
  - "web_scrape tool registered when FIRECRAWL_API_KEY is present"
  - "Both tools wrap all web content in [WEB CONTENT - UNTRUSTED] delimiters"
  - "Jarvis can search current events and scrape URLs via Telegram"
affects: [02-shell-access, 03-code-analysis]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conditional tool registration: if (config.service.enabled) toolRegistry.register(tool)"
    - "Web content trust boundary: wrap output in [WEB CONTENT - UNTRUSTED]...[/WEB CONTENT]"
    - "Module-level SDK instantiation: create client once, reuse across calls"
    - "Truncation at paragraph boundary: lastIndexOf('\\n\\n') within 80% threshold"

key-files:
  created:
    - "src/tools/built-in/web-search.ts"
    - "src/tools/built-in/web-scrape.ts"
  modified:
    - "src/index.ts"

key-decisions:
  - "Tavily client instantiated at module level (not inside execute()) — reuses connection, avoids per-call factory overhead"
  - "Firecrawl timeout: 30000ms required — without it, slow/hanging servers block the agent loop indefinitely"
  - "Content truncation at 8000 chars with paragraph-boundary awareness — prevents LLM context saturation while avoiding mid-sentence cuts"
  - "Friendly error messages for 402/403/timeout — agent communicates actionable status to user instead of raw HTTP errors"

requirements-completed: [WEB-01, WEB-02]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 1 Plan 02: Web Tools Implementation Summary

**web_search (Tavily) and web_scrape (Firecrawl) tools implemented with content trust boundaries and wired into index.ts with conditional registration**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-18T16:43:58Z
- **Completed:** 2026-03-18T16:45:17Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Created `src/tools/built-in/web-search.ts` — Tavily web search tool with 5 results, basic/advanced depth, content wrapped in `[WEB CONTENT - UNTRUSTED]` delimiters
- Created `src/tools/built-in/web-scrape.ts` — Firecrawl URL scraper with 30s timeout, 8000-char truncation at paragraph boundary, friendly error messages for common failures
- Updated `src/index.ts` — conditional registration of both tools based on API key presence, with startup log messages

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement web-search.ts and web-scrape.ts** - `0491089` (feat)
2. **Task 2: Wire tools into index.ts with conditional registration** - `5d56263` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/tools/built-in/web-search.ts` — New: Tavily web search tool implementing Tool interface
- `src/tools/built-in/web-scrape.ts` — New: Firecrawl URL scraping tool with timeout and truncation
- `src/index.ts` — Added imports and conditional registration blocks for both web tools

## Decisions Made

- Tavily factory function `tavily({ apiKey })` used at module level — the SDK uses a factory pattern, not a class constructor (`new tavily()` would be wrong)
- Firecrawl class constructor `new Firecrawl({ apiKey })` used at module level — the SDK uses a class pattern
- 30s timeout passed to `firecrawl.scrape()` — required to prevent the agent loop from hanging indefinitely on slow/unresponsive servers
- Content truncated at last `\n\n` boundary within 80% of limit — avoids mid-sentence cuts while staying within ~2000 token budget for web content
- Friendly error messages for 402 (payment), 403 (blocked), timeout — user receives actionable information instead of raw SDK errors

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — TypeScript compiled clean on first attempt. All SDK types resolved correctly from installed packages.

## User Setup Required

To enable web tools, add to `.env`:
- `TAVILY_API_KEY` — get from https://tavily.com (enables `web_search`)
- `FIRECRAWL_API_KEY` — get from https://firecrawl.dev (enables `web_scrape`)

Absent key = tool not registered. Jarvis logs at startup which tools are active.

## Next Phase Readiness

- Phase 2 (Shell Access) can proceed independently
- Web tools are fully functional end-to-end — no additional wiring needed

## Self-Check: PASSED

- src/tools/built-in/web-search.ts: FOUND
- src/tools/built-in/web-scrape.ts: FOUND
- src/index.ts: FOUND
- .planning/phases/01-web-access/01-02-SUMMARY.md: FOUND
- Commit 0491089: FOUND
- Commit 5d56263: FOUND
