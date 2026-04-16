---
name: Development Workflow
tools: [manage_backlog, git_worktree, github_prs, execute_command, read_file, search_code]
triggers: [workflow, flujo de desarrollo, trabajar en backlog, pick task, tomar tarea, siguiente tarea, next task, crear pr, implementar fix, implementar mejora, aplicar refactor, development cycle, ciclo de desarrollo, arreglar bug del backlog, worktree, pr workflow, siguiente item, proximo item, backlog item, ejecutar cambio, aplicar cambio]
---
- You can execute changes in isolated git worktrees, validate them, and open PRs for human review.
- **CONSTRAINTS (non-negotiable)**:
  - NEVER merge a PR — only the human can merge.
  - ONE PR at a time — do not start new work if there is an open Jarvis PR.
  - ONE backlog item = ONE PR — keep changes small and focused.
  - ALWAYS validate before creating a PR.
  - NEVER force push without explicit user confirmation.
  - ALWAYS ask user confirmation before starting work on an item.
- **Workflow** (follow these phases in order):
  1. **Verify gh CLI**: Call `github_prs` action=list_prs. If gh is not available/authenticated, inform the user and ask if they want to work in local mode (worktree + branch + commit, no push/PR). If they accept, skip steps 9b and 9c.
  2. **Gate Check**: From the list_prs result, filter for PRs where headRefName starts with `jarvis/`. If any open Jarvis PR exists, STOP. Report the PR to the user and do NOT start new work.
  3. **Reconcile**: Normally you can skip this — the `github-pr-monitor` scheduled task runs every 10 min and automatically transitions pr_created → merged/dismissed and removes the worktree + local branch. Only run this manually if the user reports stale state or the scheduler is disabled: call `manage_backlog` action=list_items status=pr_created, then for each item call `github_prs` action=check_status and update_item to merged/dismissed accordingly.
  4. **Select**: Call `manage_backlog` action=next_item. If the backlog is empty, suggest running `detect_bugs` or `find_refactor_candidates` to populate it.
  5. **Confirm**: Present the selected item to the user with title, category, severity, description, and evidence. Ask for explicit confirmation before proceeding.
  6. **Prepare**: Derive branch name from item: `jarvis/fix-<slug>` for bugs, `jarvis/refactor-<slug>` for refactors, `jarvis/feat-<slug>` for improvements. Call `git_worktree` action=create with the branch name. Then call `manage_backlog` action=update_item to set status=in_progress, branch_name, and worktree_path.
  7. **Implement**: Read the affected files using `read_file` with line ranges from the evidence. Apply minimal, focused changes in the worktree directory using `execute_command` with `cwd` set to the worktree path. Keep changes small — address only the selected backlog item.
  8. **Validate**: Run validation commands in the worktree via `execute_command`:
     - `npm run lint` (if available)
     - `npm test` (if available)
     - `npm run build` (if available)
     If any validation fails, fix the issues before proceeding. Report all results to the user.
  9. **Deliver**:
     - 9a. In the worktree: `git add -A` then `git commit -m "<type>: <description>"` using conventional commits.
     - 9b. (Skip in local mode) `git push -u origin <branch_name>`.
     - 9c. (Skip in local mode) Call `github_prs` action=create_pr with title, source_branch, description, AND `backlog_item_id` set to the current item's id. Passing backlog_item_id atomically updates the backlog row (pr_number, pr_url, status='pr_created') so the automatic worktree cleanup can find the worktree later — do NOT rely on a follow-up manage_backlog update_item call. The PR description should include: what was found, what was changed, validations run, and risks.
     - 9d. (Local mode only) Report the branch_name and instruct the user to push and create PR manually. Backlog remains in status=in_progress.
  10. **Report**: Summarize: PR link (or branch name in local mode), files changed, validations run, and next steps (wait for human review).
- **PR description template**:
  ## What
  Brief description of the change.
  ## Why
  The backlog item: category, severity, evidence.
  ## Validations
  - lint: pass/fail
  - test: pass/fail
  - build: pass/fail
  ## Risks
  Any risks or areas to review carefully.
