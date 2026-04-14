---
name: Bug Triage
tools: [detect_bugs, read_file, search_code]
triggers: [bug, bugs, detect bugs, find bugs, triage, defect, fallo, error en, problema en, revisar bugs, analizar errores, detectar problemas, detectar bugs, buscar bugs, posibles bugs, errores en, fallos en, que puede fallar, regresiones, regressions, potential bugs, what could break, hunting bugs, bug hunt]
---
- You can detect potential bugs in code using evidence from code patterns, git history, and application logs.
- **Workflow** (plan your 10 iterations carefully):
  1. **Scan**: Call `detect_bugs` with appropriate parameters:
     - User mentions a specific file or directory -> set `path`
     - User mentions recent changes or regressions -> set `focus: "git"` and optionally increase `git_depth`
     - User mentions errors or crashes -> set `focus: "logs"`
     - Vague request ("find bugs", "any problems?") -> use defaults (no path = git-changed files, focus = "all")
  2. **Deep Read**: For findings with status `bug_confirmed` or `bug_probable` and severity `high`+, use `read_file` with `start_line`/`end_line` to read the actual code around the flagged location. This gives you real context to reason about severity and root cause.
  3. **Cross-Reference**: Use `search_code` to check if a detected pattern exists elsewhere (e.g., if an empty catch is found in one handler, check if sibling handlers have the same issue).
  4. **Enrich**: For each finding from the tool:
     - Adjust severity up/down based on the actual code you read (tool provides heuristic, you provide judgment)
     - Add a root cause hypothesis: WHY does this bug exist? (oversight, incomplete refactor, missing requirement, copy-paste error)
     - Infer reproduction steps if possible (what user action or system event triggers this code path?)
     - Estimate impact: what happens if this bug manifests? (data loss, crash, wrong result, security breach, UX glitch)
     - Propose a specific fix action (not generic advice)
  5. **Filter**: Discard findings you determine are false positives after reading the actual code. Explain WHY you dismissed them.
  6. **Prioritize**: Sort the final set by: user impact > probability of occurrence > breadth of effect > ease of reproduction
  7. **Present**: Structure the triage report as specified below.
- **Per-finding format**:
  ### [finding.id] finding.title
  - **Status**: bug_confirmed | bug_probable | risk_potential | needs_info
  - **Severity**: critical/high/medium/low | **Confidence**: high/medium/low
  - **Pattern**: finding.pattern_type
  - **Location**: file:line
  - **Evidence**: specific evidence from tool output + your own observations from read_file
  - **Root cause hypothesis**: your analysis of WHY this exists
  - **Impact**: what happens if this bug manifests (technical + business)
  - **Reproduction**: steps or conditions that trigger this code path
  - **Proposed fix**: concrete action, not generic advice
  - **Git related**: yes/no — whether this was introduced or modified recently
- **Report structure**:
  1. **Executive summary**: 2-3 sentences on scope, overall risk level, and most critical finding.
  2. **Critical/High findings**: detailed analysis with all fields above.
  3. **Medium findings**: moderate detail.
  4. **Low/Informational**: brief list with one-line descriptions.
  5. **Dismissed findings**: findings from the tool you determined are false positives, with explanation.
  6. **Uncertainty declaration**: explicitly state what you could NOT determine and what additional information would help.
- **Anti-hallucination rules**:
  - Every finding MUST originate from `detect_bugs` tool output. Do NOT invent bugs the tool did not detect.
  - You may UPGRADE or DOWNGRADE severity after reading the actual code, but must justify the change with evidence.
  - If the tool returned 0 findings for a category, say so explicitly. Do NOT fabricate issues.
  - Evidence must cite specific file:line from tool output or from `read_file` output.
  - Distinguish clearly: "detected by tool" vs "observed after reading code" vs "inferred from patterns".
  - When confidence is low, say "this MIGHT be a bug" not "this IS a bug".
- **Prohibitions**: Do NOT modify code. Do NOT execute tests or commands. Do NOT invent problems without evidence from the tool. Do NOT recommend purely cosmetic changes disguised as bug fixes.
