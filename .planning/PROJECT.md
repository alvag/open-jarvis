# Jarvis — Personal AI Agent

## What This Is

Jarvis es un agente personal de IA que corre localmente en Mac y usa Telegram como interfaz. Piensa mediante LLMs (OpenRouter con routing por complejidad), ejecuta herramientas, y recuerda información de forma persistente. El objetivo es expandir sus capacidades con nuevas herramientas, autonomía para ejecutar tareas programadas, y un modelo de seguridad robusto.

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
- ✓ Supervisor con crash recovery (backoff exponencial) y soporte de updates — existing
- ✓ Restart/update desde Telegram (/restart, /update) y via tool del agente — existing
- ✓ Sistema de personalidad configurable (soul.md) — existing
- ✓ Sesiones con timeout configurable — existing

### Active

- [ ] Web search: buscar en internet y devolver resultados resumidos
- [ ] Web scraping: leer y extraer contenido de URLs específicas
- [ ] Ejecución de código: shell commands, scripts propios, código generado por el agente
- [ ] Seguridad de ejecución: blacklist de comandos peligrosos
- [ ] Permisos por herramienta: cada tool tiene límites claros de lo que puede hacer
- [ ] Aprobación humana: acciones de alto riesgo requieren OK del usuario via Telegram
- [ ] Tareas programadas: resumen matutino, monitoreo de PRs, recordatorios, reportes periódicos
- [ ] Cadenas de acciones: el agente decide qué herramientas usar y en qué orden para tareas complejas
- [ ] Supervisor — health checks: detectar si el bot se colgó sin crash y reiniciar
- [ ] Supervisor — auto-update: detectar cambios en git automáticamente sin /update manual
- [ ] Supervisor — logs persistentes: guardar historial de crashes y restarts
- [ ] Supervisor — graceful shutdown: terminar operaciones en curso antes de reiniciar

### Out of Scope

- Migración a servidor/VPS — corre local en Mac por ahora
- Docker/containerización — no es necesario dado el modelo de seguridad por permisos
- Interfaz web o dashboard — Telegram es la única interfaz
- Soporte multi-usuario — es un agente personal, un solo usuario
- Integración con Slack/Notion/Jira — por ahora solo Google Workspace + Bitbucket

## Context

- Jarvis ya tiene una base funcional sólida con arquitectura modular por capas (channels, agent, LLM, tools, memory)
- El supervisor actual maneja crashes con backoff exponencial pero no detecta hangs ni hace auto-update
- Google Workspace tools ya existen (Drive, Sheets, Gmail, Calendar) — habilitados por feature flags via env vars
- El sistema de tools es pluggable: crear archivo en `src/tools/built-in/`, exportar Tool, registrar en `index.ts`
- La ejecución de código es la feature más riesgosa — requiere diseño cuidadoso del modelo de seguridad
- Las tareas programadas requieren un scheduler que funcione dentro del proceso del bot o como extensión del supervisor

## Constraints

- **Runtime**: Node.js con TypeScript (ES modules) — stack existente, no cambiar
- **Plataforma**: macOS local — las tools de ejecución de código deben ser seguras en este contexto
- **Seguridad**: Tres capas obligatorias — permisos por tool + blacklist de comandos + aprobación humana para alto riesgo
- **Interfaz**: Telegram exclusivamente — toda interacción (incluyendo aprobaciones de seguridad) debe pasar por ahí
- **LLM**: OpenRouter — mantener el routing por complejidad existente

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Modelo de seguridad de 3 capas | Ejecución de código en máquina personal requiere múltiples salvaguardas | — Pending |
| Tareas programadas + cadenas de acciones | Usuario necesita tanto autonomía temporal como autonomía de decisión | — Pending |
| Mejoras al supervisor en lugar de reemplazarlo | El supervisor actual funciona bien, solo necesita extensiones | — Pending |
| Sin Docker/sandbox | Permisos granulares + blacklist + aprobación humana es suficiente para uso personal | — Pending |

---
*Last updated: 2026-03-18 after initialization*
