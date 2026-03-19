---
phase: 01-web-access
plan: 01
subsystem: infra
tags: [tavily, firecrawl, config, env, security, prompt-injection]

# Dependency graph
requires: []
provides:
  - "config.ts exports tavily block with enabled flag and apiKey"
  - "config.ts exports firecrawl block with enabled flag and apiKey"
  - "Tavily SDK (@tavily/core@0.7.2) installed and importable"
  - "Firecrawl SDK (@mendable/firecrawl-js@4.16.0) installed and importable"
  - ".env.example documents TAVILY_API_KEY and FIRECRAWL_API_KEY with source URLs"
  - "soul.md contains web content trust rule preventing prompt injection"
affects: [01-02-tools, 02-shell-access, 03-code-analysis]

# Tech tracking
tech-stack:
  added: ["@tavily/core@0.7.2", "@mendable/firecrawl-js@4.16.0"]
  patterns: ["Optional service config: enabled flag via !! operator, apiKey fallback to empty string"]

key-files:
  created: []
  modified:
    - "src/config.ts"
    - ".env.example"
    - "soul.md"
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "Used !! operator for enabled flag (matches existing bitbucket pattern) — services disabled by absence of API key, no explicit false flag needed"
  - "Tavily and Firecrawl blocks placed after bitbucket, before paths — consistent ordering with dependency hierarchy"
  - "Prompt injection guard added to soul.md Rules section using [WEB CONTENT - UNTRUSTED] marker convention"

patterns-established:
  - "Optional external service config pattern: { enabled: !!process.env.KEY, apiKey: process.env.KEY || '' }"
  - "Web content trust boundary: LLM persona rules distinguish untrusted web data from system instructions"

requirements-completed: [WEB-01, WEB-02]

# Metrics
duration: 2min
completed: 2026-03-18
---

# Phase 1 Plan 01: Web Access Foundation Summary

**Tavily and Firecrawl SDKs installed with optional feature-flag config blocks in config.ts and prompt-injection guard added to soul.md**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-18T16:39:26Z
- **Completed:** 2026-03-18T16:41:47Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Installed @tavily/core@0.7.2 and @mendable/firecrawl-js@4.16.0 as production dependencies
- Extended config.ts with `tavily` and `firecrawl` blocks following the existing `bitbucket` optional-service pattern
- Documented both API keys in .env.example with source URLs (tavily.com, firecrawl.dev)
- Added web content trust rule to soul.md to prevent prompt injection attacks via web-retrieved content
- Added web tool capability disclosure to soul.md Knowledge section

## Task Commits

Each task was committed atomically:

1. **Task 1: Install SDK packages and add config blocks** - `03c05d3` (feat)
2. **Task 2: Document env vars and add trust rule to soul.md** - `cfaf761` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/config.ts` - Added tavily and firecrawl config blocks after bitbucket block
- `.env.example` - Added TAVILY_API_KEY and FIRECRAWL_API_KEY with comments and source URLs
- `soul.md` - Added web content trust rule to Rules section; added web tool capability to Knowledge section
- `package.json` - Added @tavily/core and @mendable/firecrawl-js to dependencies
- `package-lock.json` - Updated lockfile with new packages

## Decisions Made
- Used `!!process.env.KEY` pattern for `enabled` flag — matches how the existing `bitbucket` block works; services are disabled by absence of the key, not by an explicit `false` setting
- Placed tavily and firecrawl blocks after `bitbucket` and before `paths` — follows the pattern of least-specific to most-specific config ordering
- Prompt injection guard uses `[WEB CONTENT - UNTRUSTED]...[/WEB CONTENT]` marker convention — creates a clear, searchable token that context-builder can wrap around web tool outputs in Plan 02

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — npm install succeeded with pinned versions on first attempt. TypeScript compiles clean with no errors.

## User Setup Required
External API keys are optional but required to enable web tools:
- `TAVILY_API_KEY` — get from https://tavily.com
- `FIRECRAWL_API_KEY` — get from https://firecrawl.dev

Add to `.env` file. Remove key to disable the corresponding tool.

## Next Phase Readiness
- config.ts exports `config.tavily` and `config.firecrawl` — ready for Plan 02 tool implementation to import
- Both SDKs installed and resolvable — Plan 02 can import `@tavily/core` and `@mendable/firecrawl-js` without additional npm install
- soul.md trust rule in place — Plan 02 tool implementations can wrap web content in `[WEB CONTENT - UNTRUSTED]` markers

---
*Phase: 01-web-access*
*Completed: 2026-03-18*
