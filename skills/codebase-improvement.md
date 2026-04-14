---
name: Codebase Improvement Analysis
tools: [analyze_codebase, read_file, search_code, codebase_map]
triggers: [mejora, mejoras, deuda tecnica, technical debt, hotspot, hotspots, backlog tecnico, tech backlog, code quality, calidad, analiza codebase, analyze codebase, refactor, code smell, quick wins, mantenibilidad, mejorar codebase, proponer mejoras, que cambiarias, que mejorarias, fragilidad, acoplamiento]
---
- You can analyze a codebase and produce prioritized improvement proposals backed by evidence.
- **Workflow** (plan your 10 iterations carefully):
  1. Call `analyze_codebase` with `focus: "all"`, `scope: "overview"` to get the full scan in one call.
  2. Inspect the report: identify the top hotspots (largest files, hub dependencies, long functions, quality signals).
  3. Use `read_file` (with start_line/end_line) or `analyze_codebase` with a specific `focus` and `path` to drill into the 2-3 most critical areas.
  4. Use `search_code` to validate specific patterns (duplicated logic, scattered config, inconsistent naming).
  5. Check `codebase_map` (action=search) for prior analysis. After new analysis, save key findings with `codebase_map` (action=save, entry_type=note).
  6. Synthesize findings into the output format below.
- **Categorize** each improvement as one of: mantenibilidad, fiabilidad, observabilidad, deuda tecnica, consistencia, rendimiento, seguridad.
- **Prioritize** using: Priority = Impact / (Effort x Risk). Rate each factor 1 (low) to 3 (high).
- **Output format** — structure your response as:
  1. **Resumen Ejecutivo**: 2-3 sentences on what was analyzed and overall health assessment.
  2. **Quick Wins** (high impact, low effort): numbered list, each with evidence, impact, and effort.
  3. **Mejoras Estrategicas** (require planning): numbered list, each with evidence, impact, effort, and risk.
  4. **Metricas Clave**: key numbers from the analysis report.
  5. **Siguiente Paso Recomendado**: one concrete next action.
- **Per-improvement format**:
  - Title and category
  - Evidencia: specific file:line references from tool output
  - Impacto: what improves and why it matters
  - Esfuerzo: low/medium/high
  - Riesgo: low/medium/high (only for strategic improvements)
- **Anti-hallucination rules**:
  - Every improvement MUST cite at least one file:line from tool output.
  - If `analyze_codebase` did not flag it, do NOT invent it.
  - Say "no se detectaron problemas en [area]" instead of fabricating issues.
  - Distinguish clearly: "detected by tool" vs "inferred from patterns" vs "open question".
  - Do NOT propose generic blog-post-style recommendations. Be specific to this codebase.
- **Scope control**: If the user asks for a specific focus (e.g., "quick wins", "mantenibilidad", "configuracion"), use the `focus` parameter of `analyze_codebase` accordingly and limit proposals to that category.
- **Prohibitions**: Do NOT modify code. Do NOT execute commands. Do NOT invent problems without evidence. Do NOT list more than 10 improvements — prioritize ruthlessly.
