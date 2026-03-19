# Jarvis — Personal AI Agent

## What This Is

Jarvis es un agente personal de IA que corre localmente en Mac y usa Telegram como interfaz. Piensa mediante LLMs (OpenRouter con routing por complejidad), ejecuta herramientas, y recuerda información de forma persistente. Puede buscar en la web, ejecutar comandos de shell con seguridad de tres capas, operar de forma autónoma con tareas programadas, y se auto-actualiza desde git.

## Core Value

Jarvis debe ser un asistente personal confiable que ejecuta tareas de forma autónoma sin comprometer la seguridad del sistema donde corre.

## Requirements

### Validated

- ✓ Comunicación via Telegram (grammy, long polling) — existing
- ✓ LLM via OpenRouter con routing por complejidad (simple/moderate/complex) — existing
- ✓ Memoria persistente SQLite con FTS5 (memorias, sesiones, historial) — existing
- ✓ Sistema de herramientas pluggable (tool registry pattern) — existing
- ✓ Google Drive: acceso a carpetas y archivos específicos, lectura y edición de documentos — existing
- ✓ Google Sheets: lectura y escritura de hojas de cálculo — existing
- ✓ Gmail: lectura y envío de correos — existing
- ✓ Google Calendar: lectura y creación de eventos — existing
- ✓ Bitbucket: revisión de PRs — existing
- ✓ Sistema de personalidad configurable (soul.md) — existing
- ✓ Sesiones con timeout configurable — existing
- ✓ Web search via Tavily API con content trust boundaries — v1.0
- ✓ Web scraping via Firecrawl API (JS-rendered pages) — v1.0
- ✓ Shell execution via execFile con seguridad de 3 capas (classifier + approval gate + SQLite persistence) — v1.0
- ✓ Script execution (.sh, .py, .ts) por file path — v1.0
- ✓ Blacklist de comandos destructivos (rm -rf, mkfs, dd, curl|sh) con fail-closed — v1.0
- ✓ Aprobación humana via Telegram inline keyboard para comandos riesgosos — v1.0
- ✓ Estado de aprobación persistente en SQLite, sobrevive restarts — v1.0
- ✓ Tareas programadas con cron expressions persistentes en SQLite (croner) — v1.0
- ✓ Recordatorios one-shot con ejecución en tiempo específico — v1.0
- ✓ Morning briefing: Calendar + Gmail + PRs + web search — v1.0
- ✓ PR monitoring periódico con notificaciones via Telegram — v1.0
- ✓ Graceful shutdown con in-flight tracking (15s timeout) — v1.0
- ✓ Heartbeat watchdog IPC (30s timeout + SIGKILL) — v1.0
- ✓ Auto-update via git polling cada 5 minutos — v1.0
- ✓ Supervisor logs persistentes a data/supervisor.log — v1.0
- ✓ Restart/update desde Telegram (/restart, /update) y via tool del agente — existing

### Active

- ✓ Soporte MCP client — Jarvis consume tools de MCP servers externos — v1.1 Phase 06
- ✓ Tool manifest declarativo — archivo de configuración para tools y MCP servers — v1.1 Phase 05
- ✓ Enfoque híbrido — custom tools + MCP tools coexisten en el agent loop — v1.1 Phase 06

## Current Milestone: v1.1 MCP Tools & Tool Manifest

**Goal:** Permitir que Jarvis consuma herramientas de MCP servers externos mediante un manifest declarativo, manteniendo las custom tools existentes en un enfoque híbrido.

**Target features:**
- MCP client integration (conectar a MCP servers, descubrir y ejecutar tools)
- Tool manifest declarativo (JSON/YAML config para activar/desactivar tools y MCP servers)
- Enfoque híbrido (custom tools + MCP tools unificados en el agent loop)

### Out of Scope

- Migración a servidor/VPS — corre local en Mac por ahora
- Docker/containerización — no es necesario dado el modelo de seguridad por permisos
- Interfaz web o dashboard — Telegram es la única interfaz
- Soporte multi-usuario — es un agente personal, un solo usuario
- Integración con Slack/Notion/Jira — por ahora solo Google Workspace + Bitbucket
- Permisos por herramienta granulares (per-tool flags) — deferido a v2
- Ejecución de código generado por el agente — deferido a v2
- Reportes semanales de actividad — deferido a v2
- Lectura simple de URLs via cheerio/axios — deferido a v2

## Context

Shipped v1.0 con 5,295 LOC TypeScript. 56 archivos modificados en 10 días de desarrollo.

Stack: Node.js + TypeScript (ES modules), grammy (Telegram), OpenRouter (LLM), better-sqlite3 (WAL mode), croner (scheduler), Tavily/Firecrawl (web).

Arquitectura modular por capas: channels → agent → LLM → tools → memory. Tools pluggables via registry pattern. Servicios externos habilitados por feature flags via env vars.

Supervisor completo: crash recovery con backoff exponencial, heartbeat watchdog IPC, auto-update via git polling, lifecycle logging persistente, graceful shutdown con in-flight tracking.

## Constraints

- **Runtime**: Node.js con TypeScript (ES modules) — stack existente, no cambiar
- **Plataforma**: macOS local — las tools de ejecución de código deben ser seguras en este contexto
- **Seguridad**: Tres capas obligatorias — classifier + blacklist + aprobación humana para alto riesgo
- **Interfaz**: Telegram exclusivamente — toda interacción (incluyendo aprobaciones de seguridad) debe pasar por ahí
- **LLM**: OpenRouter — mantener el routing por complejidad existente

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Modelo de seguridad de 3 capas | Ejecución de código en máquina personal requiere múltiples salvaguardas | ✓ Good — blocked destructive commands, approval gate works reliably |
| Tareas programadas con croner + SQLite | Necesidad de autonomía temporal con persistencia across restarts | ✓ Good — morning briefings, PR monitoring, reminders all working |
| Mejoras al supervisor en lugar de reemplazarlo | El supervisor actual funciona bien, solo necesita extensiones | ✓ Good — added 4 capabilities without breaking existing crash recovery |
| Sin Docker/sandbox | Permisos granulares + blacklist + aprobación humana es suficiente para uso personal | ✓ Good — simpler, lower overhead, security model proven sufficient |
| IPC heartbeat (not HTTP) para watchdog | Simpler, zero network overhead, automatic cleanup on process death | ✓ Good — reliable hang detection with SIGKILL fallback |
| execFile shell:false | Prevents shell injection even if metacharacter check is bypassed | ✓ Good — defense in depth at OS level |
| SQLite for approval persistence | In-memory Map loses state on crash, SQLite survives restarts | ✓ Good — SEC-03 verified: pending approvals recovered after restart |
| Direct Telegram API in supervisor (not grammy) | Supervisor must notify independently of bot process state | ✓ Good — notifications work even when bot is hung/crashed |

---
*Last updated: 2026-03-19 after Phase 06 (mcp-client-layer) completed*
