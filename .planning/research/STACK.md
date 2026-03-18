# Stack Research

**Domain:** Personal AI agent — Node.js/TypeScript capability expansion
**Researched:** 2026-03-18
**Confidence:** MEDIUM-HIGH (verified against npm registry, official repos, and official docs)

## Context

This research covers only the NEW capability additions. The existing stack (grammy, better-sqlite3, OpenRouter via fetch, tsx) is already in production and is not re-evaluated here. The four capability domains are:

1. Web search (agent needs external knowledge)
2. Web scraping (agent needs to read arbitrary URLs)
3. Code/shell execution with security (agent needs to run commands)
4. Task scheduling (agent needs temporal autonomy)
5. Supervisor enhancements (health checks, auto-update, graceful shutdown)

---

## Recommended Stack

### Web Search

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@tavily/core` | `^0.7.2` | Search API optimized for LLM agents | Purpose-built for agent use: returns ranked snippets, relevance scores, and citations in formats agents consume directly. Has official JS/TS SDK with types. Free tier: 1,000 queries/month. Used in LangChain ecosystem. |
| `brave-search` (REST via fetch) | N/A (REST) | Fallback / secondary search source | Completely independent index with low SEO spam. $5/1,000 queries with $5 free monthly credit. No official Node SDK — call via native `fetch` with API key header. Use as fallback if Tavily quota exhausted. |

**Decision: Tavily as primary.** Tavily is the only search API explicitly designed for LLM agent workflows — it returns summaries, not raw HTML dumps. Brave is a solid fallback for cost control.

**Confidence:** MEDIUM — Tavily version from npm search result (20 days old). Brave pricing confirmed from official announcement.

### Web Scraping

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `cheerio` | `^1.2.0` | HTML parsing and content extraction | Stable 1.0 release (Oct 2024), jQuery-like API, no browser runtime required. For static pages — correct 90% of the time for URLs an agent visits. TypeScript typings included. |
| `axios` | `^1.8.x` | HTTP client for fetching pages | Already a standard transitive dependency in many projects; handles redirects, timeouts, custom headers. Use over native `fetch` here because you need timeout control and explicit error handling in tool context. |

**What NOT to use for scraping:**
- Playwright/Puppeteer — JavaScript-rendered pages are a corner case for an agent reading articles/docs. Full browser adds 200+ MB of Chromium to the install and 2-3 second cold start per scrape. Defer until a specific use case demands it.

**Confidence:** HIGH — Cheerio 1.2.0 confirmed from npm search result (2 months ago).

### Code / Shell Execution

This is the highest-risk capability. The project explicitly rules out Docker/containers, so security must be enforced in-process.

**Chosen approach: `child_process.execFile` with a structured allow-list, timeout, and maxBuffer cap.**

No sandbox library is recommended for the shell command use case. Here is why:

| Option | Status | Verdict |
|--------|--------|---------|
| `vm2` | Resurrected in Oct 2025 (v3.10.0) after 2023 abandonment, but CVE-2026-22709 (CVSS 9.8) disclosed Jan 2026 — new critical escape | DO NOT USE |
| `node:vm` | Built-in, but NOT a sandbox — documented by Node.js team as unsuitable for untrusted code | DO NOT USE |
| `isolated-vm` | v6.0.2 (Oct 2025), uses V8 isolates. Best-in-class for running untrusted JS in a JS context | USE ONLY if agent generates JS to execute |
| `child_process.execFile` | Built-in, shell-bypass, configurable timeout/maxBuffer | USE for shell commands with allow-list |

**For shell commands (primary use case):**

Use `child_process.execFile` (not `exec`, not `spawn` with `shell: true`). `execFile` does not invoke a shell — it passes arguments directly to the OS, eliminating shell injection. Combine with:
- An explicit **allow-list** of permitted executables (not a blacklist — blacklists fail)
- `timeout` option (e.g., 10,000 ms)
- `maxBuffer` cap (e.g., 5 MB)
- A per-tool permission manifest checked before execution
- Human approval via Telegram for any tool flagged as high-risk

**For LLM-generated JavaScript (optional, future):**

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `isolated-vm` | `^6.0.2` | Secure V8 isolate for running generated JS | Uses V8's native Isolate API (not Node's vm module). Supported by Rocket.Chat, Screeps, TripAdvisor. Pre-built binaries for macOS ARM64. Requires `--no-node-snapshot` flag on Node.js >= 20. In maintenance mode but actively receiving Node.js version support. |

**Note on `isolated-vm` startup requirement:** When using Node.js 20+, the process must be started with `--no-node-snapshot`. This means `tsx watch src/index.ts` must become `tsx --no-node-snapshot watch src/index.ts`. The existing supervisor launch command must be updated accordingly.

**Confidence:** HIGH — vm2 CVE confirmed via HackerNews/Endor Labs Jan 2026. isolated-vm v6.0.2 confirmed from GitHub releases page. `execFile` recommendation from official Node.js security guidance.

### Task Scheduling

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `croner` | `^10.0.1` | In-process cron scheduler | Zero dependencies. TypeScript-native. Supports full cron syntax including seconds and year fields, timezone targeting, pause/resume/stop, and async handlers. Used by PM2, ZWave JS, Uptime Kuma. v10.0.0 added OCPS 1.4 compliance and DST fixes. Works in-process — no external process or database needed. |

**Why not alternatives:**
- `node-cron`: No timezone support, no pause/resume, no browser/Deno compat, last meaningful update was years ago. MEDIUM confidence.
- `toad-scheduler`: Good for simple intervals (`every 5 minutes`) but requires croner anyway for cron syntax. Adds a layer with no benefit here.
- `node-schedule`: More stars but larger surface area and slower to adopt new Node.js versions.
- Agenda/Bull: Require Redis or MongoDB — unnecessary infrastructure for a single-process personal agent.

**Confidence:** HIGH — croner v10.0.1 confirmed from npm search result (1 month ago).

### Supervisor Enhancements

The existing supervisor (`src/supervisor.ts`) handles crash recovery with exponential backoff. It needs three additions: hang detection, auto-update on git changes, and graceful shutdown. All implemented without new dependencies where possible.

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `child_process` (built-in) | Node.js 22 built-in | Spawn bot subprocess, detect hang | Already used by the supervisor. Add a heartbeat ping from bot → supervisor via IPC (`process.send`) to detect hangs (no response in N seconds = restart). No new library needed. |
| `node:fs/promises` + `child_process.execSync` | Built-in | Detect git changes for auto-update | Poll `git rev-parse HEAD` on an interval (every 60s) from within the supervisor. If HEAD changed since last check, trigger the existing update flow. No library needed. |
| SIGTERM handler (built-in) | Node.js 22 built-in | Graceful shutdown | Register `process.on('SIGTERM', ...)` in `src/index.ts`. Complete in-flight LLM calls (max timeout), flush SQLite WAL, close grammy gracefully, then `process.exit(0)`. Pattern: 5-8 second timeout, then force exit. |

**Why not PM2:** Project constraint says "improve existing supervisor, not replace it." PM2 is also overkill for a single personal-use process on a Mac.

**Confidence:** HIGH — all patterns are built-in Node.js APIs; no version research needed.

---

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/cheerio` | bundled in `cheerio@1.x` | TypeScript types for cheerio | Included automatically in cheerio 1.x — no separate install needed |
| `@types/axios` | bundled in `axios@1.x` | TypeScript types | Included in axios 1.x — no separate install needed |

---

## Installation

```bash
# Web search + scraping
npm install @tavily/core axios cheerio

# Task scheduling
npm install croner

# Code execution sandbox (only if LLM-generated JS feature is built)
npm install isolated-vm
```

**If isolated-vm is added**, update `package.json` scripts:
```json
"start:bot": "node --no-node-snapshot --import tsx src/index.ts"
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@tavily/core` | Brave Search REST API | When Tavily quota is exhausted (1,000 free/month) or you want zero vendor lock-in |
| `@tavily/core` | SerpAPI | When you need multi-engine results (Google, Bing, DuckDuckGo) for SEO-type queries — overkill for a personal agent |
| `child_process.execFile` + allow-list | `isolated-vm` for shell | Only if the threat model requires running untrusted LLM-generated shell scripts — not needed here since agent runs owned scripts |
| `croner` | `node-cron` | If you never need timezone support and prefer the 5M weekly downloads of node-cron over croner's 300K |
| `axios` | native `fetch` | Use native fetch if Node.js 22+ native fetch is sufficient — axios is preferred here for timeout control and automatic error handling in tool context |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `vm2` | CVE-2026-22709 (CVSS 9.8) disclosed Jan 2026 — sandbox escape in resurrected version. Over 20 known escapes historically. | `isolated-vm` for JS sandboxing, `execFile` + allow-list for shell |
| `node:vm` | Node.js official docs state it is NOT a security sandbox. Isolates only the context, not resources. | `isolated-vm` |
| `child_process.exec` | Invokes `/bin/sh` — shell metacharacters enable injection. Never use with any dynamic input. | `child_process.execFile` |
| `child_process.spawn` with `shell: true` | Same issue as exec — spawns a shell. | `spawn` with `shell: false` (default) |
| Playwright / Puppeteer | Full browser runtime (200+ MB, 2-3s cold start) for a use case that is 90% static HTML. | `axios` + `cheerio` |
| Agenda / Bull | Require Redis or MongoDB. No persistence needed for an in-process personal agent. | `croner` |
| PM2 | Replaces the existing supervisor entirely. Out-of-scope per project constraints. | Extend existing `src/supervisor.ts` |

---

## Stack Patterns by Variant

**If the agent only executes pre-written scripts (current scope):**
- Use `execFile` + allow-list. No sandbox library needed.
- Because the executable set is known and owned by the developer.

**If the agent executes LLM-generated JavaScript code (future scope):**
- Add `isolated-vm` for JS execution.
- Start Node with `--no-node-snapshot`.
- Because you cannot trust LLM output as safe code.

**If the agent needs to scrape JavaScript-heavy SPAs:**
- Add Playwright (headless Chromium) as an optional, lazy-loaded path.
- Only instantiate a browser for URLs that fail cheerio extraction.
- Because running a browser for every scrape is too expensive.

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `croner@10.0.1` | Node.js 18, 20, 22 | Zero dependencies, ESM + CJS dual export |
| `@tavily/core@0.7.2` | Node.js >= 18 | ESM only (matches project `"type": "module"`) |
| `cheerio@1.2.0` | Node.js 18+ | ESM + CJS, TypeScript bundled |
| `axios@1.8.x` | Node.js 18+ | Dual CJS/ESM, TypeScript bundled |
| `isolated-vm@6.0.2` | Node.js 20, 22 (with `--no-node-snapshot`) | Native module, needs C++ compiler, pre-built binaries available for macOS ARM64 |

---

## Sources

- Tavily npm: https://www.npmjs.com/package/@tavily/core — version 0.7.2, published ~20 days ago (MEDIUM confidence)
- Tavily GitHub: https://github.com/tavily-ai/tavily-js — official SDK
- Cheerio: https://cheerio.js.org/blog/cheerio-1.0 — 1.0 release details; npm search confirms 1.2.0 (HIGH confidence)
- isolated-vm GitHub releases: https://github.com/laverdet/isolated-vm/releases — v6.0.2 October 2025 (HIGH confidence)
- isolated-vm `--no-node-snapshot` issue: https://github.com/laverdet/isolated-vm/issues/420 (HIGH confidence)
- vm2 CVE-2026-22709: https://www.endorlabs.com/learn/cve-2026-22709-critical-sandbox-escape-in-vm2-enables-arbitrary-code-execution (HIGH confidence)
- vm2 resurrection notice: https://github.com/patriksimek/vm2 (MEDIUM confidence)
- croner v10.0.0/10.0.1: https://www.npmjs.com/package/croner — last published 1 month ago (HIGH confidence)
- croner GitHub: https://github.com/Hexagon/croner (HIGH confidence)
- Node.js execFile security: https://securecodingpractices.com/prevent-command-injection-node-js-child-process-safer-execution-with-execfile/ (HIGH confidence)
- Brave Search pricing change: https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/ (HIGH confidence)
- Scheduler comparison: https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/ (MEDIUM confidence)

---
*Stack research for: Jarvis personal AI agent capability expansion*
*Researched: 2026-03-18*
