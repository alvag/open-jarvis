# Roadmap: Jarvis — Personal AI Agent

## Milestones

- ✅ **v1.0 MVP** — Phases 1-4 (shipped 2026-03-19)
- 🚧 **v1.1 MCP Tools & Tool Manifest** — Phases 5-7 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-4) — SHIPPED 2026-03-19</summary>

- [x] Phase 1: Web Access (2/2 plans) — completed 2026-03-18
- [x] Phase 2: Security + Shell Execution (3/3 plans) — completed 2026-03-18
- [x] Phase 3: Scheduled Tasks (3/3 plans) — completed 2026-03-18
- [x] Phase 4: Supervisor Improvements (3/3 plans) — completed 2026-03-19

</details>

### 🚧 v1.1 MCP Tools & Tool Manifest (In Progress)

**Milestone Goal:** Jarvis can consume tools from external MCP servers declared in a manifest file, while custom tools continue to work unchanged in a unified hybrid agent loop.

- [x] **Phase 5: Tool Manifest** — Declarative JSON manifest with env var substitution controls which tools and MCP servers are active (completed 2026-03-19)
- [ ] **Phase 6: MCP Client Layer** — Single-server client + tool adapter with transport hardening, namespace prefixing, and schema normalization
- [ ] **Phase 7: MCP Integration** — Multi-server manager wired into index.ts; tool poisoning defenses and context budget guard embedded

## Phase Details

### Phase 5: Tool Manifest
**Goal**: Users can configure which MCP servers Jarvis connects to by editing a JSON file, with secrets referenced via env vars rather than hardcoded
**Depends on**: Phase 4 (v1.0 complete)
**Requirements**: MNFST-01, MNFST-02, MNFST-03
**Success Criteria** (what must be TRUE):
  1. A `tools.manifest.json` file exists with a documented schema; user can add an MCP server entry and Jarvis reads it at startup
  2. Env vars referenced as `${VAR}` in manifest env fields are substituted at load time; the raw token never appears in the loaded config object
  3. Servers with `enabled: false` are skipped entirely — no connection attempt, no error
  4. A missing or malformed manifest file produces a clear startup error, not a silent failure
**Plans**: 1 plan

Plans:
- [x] 05-01-PLAN.md — Manifest loader + MCP config loader + index.ts wiring

### Phase 6: MCP Client Layer
**Goal**: Jarvis can connect to a single MCP server (stdio or HTTP), discover its tools, and execute them — with crashes isolated and tool names namespaced to prevent collisions
**Depends on**: Phase 5
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05, MCP-06, MCP-07, MCP-08, MCP-09, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):
  1. Jarvis connects to a local stdio MCP server and to a remote StreamableHTTP server; both appear as usable tools in the agent loop
  2. All MCP tool names carry the `{serverName}__{toolName}` prefix; a name that would collide with a custom tool causes a startup error, not silent overwrite
  3. An MCP server child process that crashes mid-session returns a structured error to the LLM instead of crashing Jarvis or the session
  4. All MCP connections are closed cleanly when Jarvis shuts down; no zombie child processes remain
**Plans**: 2 plans

Plans:
- [ ] 06-01-PLAN.md — McpClient class wrapping SDK Client + transports with lifecycle and error handling
- [ ] 06-02-PLAN.md — McpToolAdapter with namespace prefix, result normalization, and index.ts wiring

### Phase 7: MCP Integration
**Goal**: All enabled MCP servers start in parallel at boot, their tools are available to the agent, and security guardrails prevent tool poisoning and context bloat
**Depends on**: Phase 6
**Requirements**: SEC-01, SEC-02, SEC-05
**Success Criteria** (what must be TRUE):
  1. Jarvis starts with multiple MCP servers enabled; failed servers log a warning and Jarvis continues — only successful servers contribute tools
  2. MCP tool descriptions are capped at 500 characters; the system prompt explicitly frames them as untrusted external content
  3. Startup logs show total registered tool count; if the count exceeds 30, a warning is emitted
  4. The agent can invoke an MCP tool in a real conversation and the result flows back correctly through the existing agent loop
**Plans**: TBD

Plans:
- [ ] 07-01: Implement `McpManager` with `Promise.allSettled` startup, `callTool` routing, and `disconnectAll` shutdown
- [ ] 07-02: Wire manifest + manager into `index.ts`; add description truncation + system-prompt framing to `context-builder.ts`; add startup token count logging

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Web Access | v1.0 | 2/2 | Complete | 2026-03-18 |
| 2. Security + Shell Execution | v1.0 | 3/3 | Complete | 2026-03-18 |
| 3. Scheduled Tasks | v1.0 | 3/3 | Complete | 2026-03-18 |
| 4. Supervisor Improvements | v1.0 | 3/3 | Complete | 2026-03-19 |
| 5. Tool Manifest | v1.1 | 1/1 | Complete | 2026-03-19 |
| 6. MCP Client Layer | 1/2 | In Progress|  | - |
| 7. MCP Integration | v1.1 | 0/2 | Not started | - |
