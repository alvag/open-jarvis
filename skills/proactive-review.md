---
name: Proactive Review
tools: [detect_bugs, find_refactor_candidates, analyze_codebase, read_file, search_code, manage_backlog, manage_code_review_log, github_prs, git_worktree]
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
  6. **Filter**: Discard false positives after reading the actual code. Explain why you dismissed them.
  7. **Save findings**: For each finding with severity >= medium AND confidence >= medium:
     - Call `manage_backlog` action=add_item with:
       - title: concise finding title
       - category: "bug" | "refactor" | "improvement"
       - severity and confidence from the finding
       - source_tool: "proactive-review"
       - source_finding_id: "<tool_name>:<unique_id>" (for deduplication)
       - files: JSON array with the file path
       - evidence: JSON array of evidence strings with file:line references
     - Ask the user before saving unless they said to save automatically.
  8. **Update review log**: Call `manage_code_review_log` action=upsert with file_path, findings_count, skills_run for each analyzed file.
  9. **Present**: Deliver a structured report.
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
- **Prohibitions**: Do NOT modify code unless the user confirms auto-fix. Do NOT skip tools — always run all 4 analyses. Do NOT confuse this with PR review.
