---
phase: 1
slug: web-access
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript type checking (`tsc --noEmit`) — no unit test framework detected |
| **Config file** | `tsconfig.json` |
| **Quick run command** | `npm run typecheck` |
| **Full suite command** | `npm run typecheck` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run typecheck`
- **After every plan wave:** Run `npm run typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green + manual smoke tests
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | WEB-01 | type check | `npm run typecheck` | ✅ | ⬜ pending |
| 01-01-02 | 01 | 1 | WEB-01 | manual integration | N/A — requires live API | ❌ manual-only | ⬜ pending |
| 01-01-03 | 01 | 1 | WEB-02 | type check | `npm run typecheck` | ✅ | ⬜ pending |
| 01-01-04 | 01 | 1 | WEB-02 | manual integration | N/A — requires live API | ❌ manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] No test runner installed — TypeScript typecheck is the only automated validation
- [ ] Manual smoke test checklist: search query with/without TAVILY_API_KEY, scrape URL with/without FIRECRAWL_API_KEY, scrape JS-rendered page, scrape paywalled URL

*Existing infrastructure (typecheck) covers type safety. Integration tests are manual due to external API dependency.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tavily search returns summarized results | WEB-01 | Requires live API key and network | Send a current-events question via Telegram, verify summary + source links |
| Firecrawl scrape returns markdown | WEB-02 | Requires live API key and network | Send a URL via Telegram, verify clean markdown response |
| JS-rendered page returns content | WEB-02 | Requires live API key + JS-heavy URL | Send a SPA URL, verify content extracted (not empty) |
| Untrusted content delimiters present | WEB-01, WEB-02 | Requires inspecting tool result in agent loop | Check logs for `[WEB CONTENT - UNTRUSTED]` wrapper |
| Blocked URL returns clear error | WEB-02 | Requires paywalled URL | Send a paywalled URL, verify error message |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
