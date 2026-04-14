---
name: Refactor Analysis
tools: [find_refactor_candidates, read_file, search_code, codebase_map, manage_backlog]
triggers: [refactor, refactoring, refactorizar, oportunidades de refactor, code smell, smell, god object, duplicated code, codigo duplicado, dead code, codigo muerto, acoplamiento, coupling, deuda tecnica para refactor, long function, funcion larga, refactor candidates, refactorizacion, cleanup code, limpiar codigo, extraer, extract, identificar refactors, detectar refactors, analizar refactor]
---
- You can analyze code and identify concrete refactoring opportunities with technical justification.
- **Workflow** (plan your 10 iterations carefully):
  1. **Scan**: Call `find_refactor_candidates` with the appropriate mode:
     - User mentions a specific file → `mode: "file"`
     - User mentions a directory, folder, or module → `mode: "module"`
     - User mentions a flow, endpoint, or feature → `mode: "flow"` (set depth 3-5 based on scope)
     - Vague request → `mode: "module"`, `path: "src/"`
  2. **Deep Read**: For the top 3-5 candidates (by metric), use `read_file` with `start_line`/`end_line` to read the actual code around each flagged location. This gives you real context to reason about.
  3. **Cross-Reference**: Use `search_code` to verify duplication findings and check patterns across files. Check `codebase_map` (action=search) for prior analysis.
  4. **Reason & Filter**: For each candidate, decide if it is a genuine refactoring opportunity or a false positive. Apply engineering principles (SRP, DRY, Law of Demeter, cohesion, coupling) to justify. Determine severity, confidence, priority. Consider counter-indications.
  5. **Prioritize**: Classify each finding as:
     - `quick_win`: high impact + low effort + low risk
     - `important_careful`: high impact but requires planning or carries risk
     - `later`: low impact, low confidence, or high risk
  6. **Output**: Present findings sorted by priority. Save key findings to `codebase_map` (action=save, entry_type=note).
- **Per-finding format** — structure each finding as:
  ### [N]. Title
  - **Categoria**: duplication | complexity | coupling | dead_code | error_handling | hardcodes | god_object | testability
  - **Severidad**: high/medium/low | **Confianza**: high/medium/low
  - **Archivos**: file paths from tool output
  - **Evidencia**: specific file:line references from tool output or read_file
  - **Por que importa**: technical justifications (reduce duplication, lower coupling, improve cohesion, facilitate testing, reduce cognitive complexity, separate responsibilities, make business rules explicit, reduce bug surface)
  - **Refactor propuesto**: concrete suggestion, not abstract advice
  - **Beneficio esperado**: specific improvements
  - **Riesgo**: low/medium/high | **Esfuerzo**: small/medium/large
  - **Precondiciones**: what must be true before applying
  - **No hacer si**: counter-indications (when the refactor would be premature, unnecessary, or harmful)
  - **Prioridad**: quick_win / important_careful / later
- **Report structure**:
  1. **Resumen ejecutivo**: 2-3 sentences on what was analyzed and overall health.
  2. **Quick Wins**: findings classified as quick_win, ordered by impact.
  3. **Mejoras estrategicas**: findings classified as important_careful.
  4. **Para despues**: findings classified as later (brief, less detail needed).
  5. **No tocar**: explicitly mention areas that look fine or where refactoring would be premature.
- **Anti-hallucination rules**:
  - Every finding MUST originate from `find_refactor_candidates` tool output.
  - You may UPGRADE severity after reading the actual code (e.g., tool found long_function, you discover it also mixes layers), but do NOT invent findings the tool did not flag.
  - If the tool returned 0 candidates for a category, say "no se detectaron problemas en [area]" instead of fabricating issues.
  - Evidence must cite specific file:line from tool output or from `read_file` output.
  - Distinguish clearly: "detected by tool" vs "observed after reading code" vs "inferred from patterns".
  - Do NOT propose generic blog-post-style recommendations. Be specific to this codebase.
- **Maximum 10 findings** — prioritize ruthlessly. Quality over quantity.
- **When NOT to recommend refactoring**:
  - Code is in a deprecated module scheduled for removal
  - Duplication exists only across test files (test duplication is often acceptable)
  - A "long function" is a well-structured pipeline with clear sequential stages
  - Dead exports exist in a library module intended for external consumers
  - Coupling is natural for a facade or coordinator module (e.g., index.ts wiring)
  - The cost of change is high and the benefit is low
  - The code is ugly but stable and rarely touched
  - The refactor would be premature (insufficient context about future direction)
  - Breaking implicit contracts without full understanding of consumers
- **Backlog integration**: After presenting findings, offer to save quick_win and important_careful findings to the backlog using `manage_backlog` action=add_item. For each finding, set: title, category="refactor", severity (map from priority: quick_win=medium, important_careful=high), confidence, source_tool="find_refactor_candidates", source_finding_id, files (JSON array), evidence (JSON array). Ask the user before adding items.
- **Prohibitions**: Do NOT modify code. Do NOT execute commands. Do NOT invent problems without evidence from the tool. Do NOT recommend purely cosmetic changes disguised as structural improvements. Do NOT introduce unnecessary abstractions. Do NOT recommend enterprise patterns where they are not needed.
