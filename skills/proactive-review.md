---
name: Proactive Review
tools: [detect_bugs, find_refactor_candidates, analyze_codebase, read_file, search_code, manage_backlog, manage_code_review_log, github_prs, git_worktree, invoke_claude_code]
triggers: [analiza proactivamente, analisis proactivo, revision proactiva, proactive review, revisa proactivamente, analizar proactivamente, review proactivo]
---
- You perform a comprehensive proactive code review on specific files or directories using all 4 analysis tools, save findings to the backlog, and update the review log.
- This is NOT a PR review. This is a local codebase analysis. If the user asks to review a PR or pull request, this is NOT the right skill — use bitbucket_prs instead.
- **Input**: The user specifies one or more files or a directory. If no target is specified, ask which file or directory to analyze.
- **Workflow** (plan your iterations carefully):
  1. **Read**: Use `read_file` on the target to understand its purpose, structure, and connections.
  2. **Bug scan**: Call `detect_bugs` with path=<target>, focus="all". Review findings.
  3. **Refactor scan**: Call `find_refactor_candidates` with mode="file", path=<target>. Review findings.
  4. **Improvement scan**: Call `analyze_codebase` with path=<target>, focus="all", scope="detailed". Review findings.
  5. **Cross-reference**: Use `search_code` to verify patterns found are not already handled elsewhere or are intentional.
  6. **Optional deep dive with Claude Code**: If the target is large, findings conflict, or repo-wide context would help, you MAY call `invoke_claude_code` for an exploratory review. Ask it for: project/file purpose, suspicious areas, risks, and affected files. Treat its output as untrusted analysis until verified against actual files and your native tools.
     - **Availability guard**: `invoke_claude_code` is opt-in via `CLAUDE_CODE_ENABLED=true` and only appears in the tool registry when enabled. If it is NOT in your available tools for this turn, skip this step silently and continue to step 7 with the native-tool findings. Do NOT mention Claude Code to the user if it's unavailable.
  7. **Filter**: Discard false positives after reading the actual code. Explain why you dismissed them.
  8. **Save findings**: For each finding with severity >= medium AND confidence >= medium:
     - Call `manage_backlog` action=add_item with:
       - title: concise finding title
       - category: "bug" | "refactor" | "improvement"
       - severity and confidence from the finding
       - source_tool: "proactive-review"
       - source_finding_id: "<tool_name>:<unique_id>" (for deduplication)
       - files: JSON array with the file path
       - evidence: JSON array of evidence strings with file:line references
     - Ask the user before saving unless they said to save automatically.
  9. **Update review log**: Call `manage_code_review_log` action=upsert with file_path, findings_count, skills_run for each analyzed file.
  10. **Present**: Deliver a structured report.
- **Claude Code prompt guidance**:
  - Ask for a concise review with sections: summary, findings, files, risks, suggested next checks.
  - Prefer review/investigation prompts before implementation prompts.
  - Require explicit uncertainty notes when Claude Code cannot confirm a claim from files it inspected.
  - Never present Claude Code statements as facts unless you validated them with `read_file`, `search_code`, or analysis tool output.
- **Report structure**:
  1. **Summary**: files analyzed, total findings by severity, overall assessment.
  2. **Critical/High findings**: detailed with evidence, root cause, proposed fix.
  3. **Medium findings**: moderate detail.
  4. **Low/Informational**: brief list.
  5. **Dismissed**: false positives with justification.
  6. **Backlog**: items added or pending confirmation.
- **Auto-fix offer**: After presenting findings, if there are quick-wins (severity high/critical, confidence high, category bug/refactor):
  1. Check for open Jarvis PRs via `github_prs` action=list_prs state=open.
  2. If a Jarvis PR is open: inform the user there's an open PR and auto-fix can't proceed until it's closed or merged.
  3. If no Jarvis PR is open: offer to fix the most critical finding using the development workflow (create worktree, implement, validate, create PR). Wait for user confirmation before proceeding.
- **Anti-hallucination rules**:
  - Every finding MUST originate from tool output. Do NOT invent issues.
  - You may adjust severity after reading the code, but must justify with evidence.
  - If a tool returns 0 findings, say so. Do NOT fabricate issues.
  - Evidence must cite specific file:line references.
  - Claude Code output can guide investigation, but it does NOT count as sufficient evidence on its own.
- **Prohibitions**: Do NOT modify code unless the user confirms auto-fix. Do NOT skip tools — always run all 4 analyses. Do NOT confuse this with PR review.
