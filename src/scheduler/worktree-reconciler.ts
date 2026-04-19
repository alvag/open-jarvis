import type Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("worktree-reconciler");
const execFileAsync = promisify(execFile);

const GIT_TIMEOUT = 15_000;

interface WorktreeEntry {
  path: string;
  branch: string;
}

interface DbActiveRow {
  id: number;
  worktree_path: string;
  branch_name: string | null;
  status: string;
}

interface DbStaleRow {
  id: number;
  user_id: string;
  worktree_path: string;
  branch_name: string | null;
}

interface DbOrphanBranchRow {
  id: number;
  branch_name: string;
}

type OrphanOutcome =
  | { kind: "removed"; branch: string | null }
  | { kind: "skipped_dirty" }
  | { kind: "skipped_unpushed" }
  | { kind: "skipped_open_pr"; prNumber: number }
  | { kind: "skipped_recent"; ageMinutes: number }
  | { kind: "error"; message: string };

/** Parse `git worktree list --porcelain` into structured entries. */
function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = output.trim().split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    let path = "";
    let branch = "";
    let bare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "bare") {
        bare = true;
      }
    }

    if (path && !bare) {
      entries.push({ path, branch });
    }
  }

  return entries;
}

async function listWorktrees(codebaseRoot: string): Promise<WorktreeEntry[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", codebaseRoot, "worktree", "list", "--porcelain"],
      { timeout: GIT_TIMEOUT },
    );
    return parseWorktreeList(stdout);
  } catch (err) {
    log.warn({ error: (err as Error).message }, "Failed to list worktrees");
    return [];
  }
}

async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "status", "--porcelain"],
      { timeout: 10_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    // If status fails, err on the safe side and treat as dirty.
    return true;
  }
}

/**
 * Detect committed-but-unpushed work in the worktree. Prefers the branch's
 * configured upstream; if no upstream is set (branch never pushed) falls back
 * to `origin/<baseBranch>` so a locally-started branch that has any commits
 * beyond the base is still considered work-in-progress.
 *
 * Fail-safe: any error short-circuits to `true` so the reconciler errs on the
 * side of preserving the worktree.
 */
async function hasUnpushedCommits(
  worktreePath: string,
  baseBranch: string,
): Promise<boolean> {
  let upstreamRef = "";
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      { timeout: 5_000 },
    );
    upstreamRef = stdout.trim();
  } catch {
    // No upstream configured — branch was never pushed. Compare against the
    // remote base branch so any local commit counts as unpushed.
    upstreamRef = `origin/${baseBranch}`;
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "rev-list", "--count", `${upstreamRef}..HEAD`],
      { timeout: 5_000 },
    );
    const count = parseInt(stdout.trim(), 10);
    return Number.isFinite(count) && count > 0;
  } catch (err) {
    // If we can't determine, err on the safe side: preserve the worktree.
    log.warn(
      { worktreePath, upstreamRef, error: (err as Error).message },
      "Could not count unpushed commits — preserving worktree to avoid data loss",
    );
    return true;
  }
}

async function hasOpenPrForBranch(
  codebaseRoot: string,
  branch: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "list", "--head", branch, "--state", "open", "--json", "number"],
      { cwd: codebaseRoot, timeout: 20_000 },
    );
    const arr = JSON.parse(stdout) as Array<{ number: number }>;
    if (Array.isArray(arr) && arr.length > 0) {
      return arr[0].number;
    }
    return null;
  } catch (err) {
    // If gh fails (not installed, not authed, offline), err on the safe side:
    // pretend there's an open PR so we don't delete anything.
    log.warn(
      { branch, error: (err as Error).message },
      "gh pr list failed — treating as open PR to stay safe",
    );
    return -1;
  }
}

async function branchExistsLocally(
  codebaseRoot: string,
  branch: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      "git",
      ["-C", codebaseRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { timeout: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function ageMinutes(path: string): number | null {
  try {
    const s = statSync(path);
    const ms = Date.now() - s.ctimeMs;
    return Math.floor(ms / 60_000);
  } catch {
    return null;
  }
}

async function removeOrphanWorktree(
  codebaseRoot: string,
  worktreePath: string,
  branchName: string | null,
  baseBranch: string,
): Promise<OrphanOutcome> {
  if (await hasUncommittedChanges(worktreePath)) {
    return { kind: "skipped_dirty" };
  }
  // Second guard: a clean working tree may still have unpushed commits.
  // Removing the worktree + `git branch -D` would silently drop that work.
  if (await hasUnpushedCommits(worktreePath, baseBranch)) {
    return { kind: "skipped_unpushed" };
  }

  try {
    await execFileAsync(
      "git",
      ["-C", codebaseRoot, "worktree", "remove", worktreePath],
      { timeout: GIT_TIMEOUT },
    );
  } catch (err) {
    const message =
      (err as Error & { stderr?: string }).stderr?.trim() ||
      (err as Error).message;
    return { kind: "error", message };
  }

  if (branchName) {
    try {
      await execFileAsync(
        "git",
        ["-C", codebaseRoot, "branch", "-D", branchName],
        { timeout: 10_000 },
      );
    } catch (err) {
      log.warn(
        { branchName, error: (err as Error).message },
        "Branch delete failed after worktree removal",
      );
    }
  }

  return { kind: "removed", branch: branchName };
}

/**
 * Reconcile physical worktrees against backlog_items.
 *
 * Pass A — physical orphans: any worktree on disk inside <root>/<worktreesDir>
 * that is NOT linked to ANY backlog row gets cleaned up if: (a) working tree
 * clean, (b) no unpushed commits (against upstream, or origin/<baseBranch>),
 * (c) no open PR for the branch, (d) older than `orphanAgeMinutes`.
 *
 * Pass B — phantom references: backlog rows with worktree_path that no longer
 * exists on disk get their worktree_path (and branch_name, if the branch is
 * also gone locally) nulled out.
 *
 * Pass C — orphan branches: backlog rows with worktree_path=NULL but branch_name
 * still set (left behind when `git branch -D` failed during pr-monitor cleanup)
 * get retried. If the branch deletes now, clear branch_name; if it's already
 * gone from the repo, clear the stale reference; otherwise leave for next run.
 */
export async function reconcileWorktrees(
  db: Database.Database,
  sendMessage: (userId: string, text: string) => Promise<void>,
  userId: string,
  codebaseRoot: string,
): Promise<void> {
  const wf = config.workflow;
  const reconciler = config.workflowReconciler;
  const worktreesBase = resolve(codebaseRoot, wf.worktreesDir);

  const removedOrphans: string[] = [];
  const skippedOrphans: Array<{ path: string; reason: string }> = [];
  const phantomCleared: number[] = [];
  const orphanBranchesCleaned: Array<{ id: number; branch: string }> = [];
  const orphanBranchesSkipped: Array<{ id: number; branch: string; reason: string }> = [];

  // ------- Pass A: physical worktrees on disk → DB -------
  const physical = await listWorktrees(codebaseRoot);
  const candidates = physical.filter((wt) => {
    const resolved = resolve(wt.path);
    return (
      resolved !== resolve(codebaseRoot) &&
      (resolved === worktreesBase || resolved.startsWith(worktreesBase + "/"))
    );
  });

  // Consider ANY backlog row that points at this worktree as "linked", across
  // every status. This preserves worktrees that github-pr-monitor intentionally
  // kept (merged/dismissed items still carrying worktree_path when cleanup was
  // skipped_dirty or WORKFLOW_AUTO_CLEANUP_WORKTREE=false) so the user can
  // inspect them manually.
  const selectAnyLink = db.prepare<[string], DbActiveRow>(
    `SELECT id, worktree_path, branch_name, status
     FROM backlog_items
     WHERE worktree_path = ?`,
  );

  for (const wt of candidates) {
    const resolved = resolve(wt.path);
    const linked = selectAnyLink.get(resolved);
    if (linked) continue; // tracked by some backlog row — leave alone

    const age = ageMinutes(resolved);
    if (age === null) {
      skippedOrphans.push({ path: resolved, reason: "stat failed" });
      continue;
    }
    if (age < reconciler.orphanAgeMinutes) {
      skippedOrphans.push({
        path: resolved,
        reason: `too recent (${age}m < ${reconciler.orphanAgeMinutes}m grace)`,
      });
      continue;
    }

    if (wt.branch) {
      const prNumber = await hasOpenPrForBranch(codebaseRoot, wt.branch);
      if (prNumber !== null) {
        skippedOrphans.push({
          path: resolved,
          reason: prNumber === -1 ? "gh check failed" : `open PR #${prNumber}`,
        });
        continue;
      }
    }

    const outcome = await removeOrphanWorktree(
      codebaseRoot,
      resolved,
      wt.branch || null,
      wf.defaultBranch,
    );
    if (outcome.kind === "removed") {
      removedOrphans.push(resolved);
      log.info({ path: resolved, branch: wt.branch }, "Removed orphan worktree");
    } else if (outcome.kind === "skipped_dirty") {
      skippedOrphans.push({ path: resolved, reason: "uncommitted changes" });
    } else if (outcome.kind === "skipped_unpushed") {
      skippedOrphans.push({ path: resolved, reason: "unpushed commits" });
    } else if (outcome.kind === "error") {
      skippedOrphans.push({ path: resolved, reason: `error: ${outcome.message}` });
    }
  }

  // ------- Pass B: DB rows with phantom worktree_path -------
  const selectStale = db.prepare<[string], DbStaleRow>(
    `SELECT id, user_id, worktree_path, branch_name
     FROM backlog_items
     WHERE user_id = ? AND worktree_path IS NOT NULL`,
  );

  const clearWorktreeOnly = db.prepare(
    "UPDATE backlog_items SET worktree_path = NULL, updated_at = datetime('now') WHERE id = ?",
  );
  const clearWorktreeAndBranch = db.prepare(
    "UPDATE backlog_items SET worktree_path = NULL, branch_name = NULL, updated_at = datetime('now') WHERE id = ?",
  );

  const staleRows = selectStale.all(userId);
  for (const row of staleRows) {
    if (existsSync(row.worktree_path)) continue;

    const branchGone = row.branch_name
      ? !(await branchExistsLocally(codebaseRoot, row.branch_name))
      : true;

    if (branchGone) {
      clearWorktreeAndBranch.run(row.id);
    } else {
      clearWorktreeOnly.run(row.id);
    }
    phantomCleared.push(row.id);
    log.info(
      { backlogId: row.id, worktreePath: row.worktree_path, branchGone },
      "Cleared phantom worktree reference",
    );
  }

  // ------- Pass C: orphan branches (worktree_path=NULL, branch_name!=NULL) -------
  // These rows are created when github-pr-monitor cleaned a worktree but
  // `git branch -D` failed (e.g. branch not fully merged at that moment).
  // The branch_name is preserved as the only pointer for manual cleanup, but
  // nobody ever retries. Now we do: if the branch is still there and deletable
  // (typically after it merges into main in a later commit), drop it. If the
  // branch already disappeared, just null the stale reference.
  const selectOrphanBranches = db.prepare<[string], DbOrphanBranchRow>(
    `SELECT id, branch_name
     FROM backlog_items
     WHERE user_id = ? AND worktree_path IS NULL AND branch_name IS NOT NULL`,
  );
  const clearBranchOnly = db.prepare(
    "UPDATE backlog_items SET branch_name = NULL, updated_at = datetime('now') WHERE id = ?",
  );

  const orphanBranchRows = selectOrphanBranches.all(userId);
  for (const row of orphanBranchRows) {
    const exists = await branchExistsLocally(codebaseRoot, row.branch_name);
    if (!exists) {
      // Branch already gone — just clear the stale reference.
      clearBranchOnly.run(row.id);
      orphanBranchesCleaned.push({ id: row.id, branch: row.branch_name });
      log.info(
        { backlogId: row.id, branch: row.branch_name },
        "Cleared stale branch reference (branch no longer exists locally)",
      );
      continue;
    }
    try {
      await execFileAsync(
        "git",
        ["-C", codebaseRoot, "branch", "-D", row.branch_name],
        { timeout: 10_000 },
      );
      clearBranchOnly.run(row.id);
      orphanBranchesCleaned.push({ id: row.id, branch: row.branch_name });
      log.info(
        { backlogId: row.id, branch: row.branch_name },
        "Deleted orphan branch and cleared reference",
      );
    } catch (err) {
      const message =
        (err as Error & { stderr?: string }).stderr?.trim() ||
        (err as Error).message;
      orphanBranchesSkipped.push({
        id: row.id,
        branch: row.branch_name,
        reason: message,
      });
      log.warn(
        { backlogId: row.id, branch: row.branch_name, error: message },
        "Could not delete orphan branch — will retry next run",
      );
    }
  }

  // ------- Notification -------
  const hasChanges =
    removedOrphans.length > 0 ||
    phantomCleared.length > 0 ||
    orphanBranchesCleaned.length > 0;
  if (hasChanges) {
    const lines: string[] = ["🧹 Worktree reconciler:"];
    if (removedOrphans.length > 0) {
      lines.push(`Eliminados ${removedOrphans.length} worktree(s) huérfano(s):`);
      for (const p of removedOrphans) lines.push(`  • ${p}`);
    }
    if (phantomCleared.length > 0) {
      lines.push(
        `Limpiadas ${phantomCleared.length} referencia(s) fantasma en backlog (ids: ${phantomCleared.join(", ")}).`,
      );
    }
    if (orphanBranchesCleaned.length > 0) {
      lines.push(
        `Borradas ${orphanBranchesCleaned.length} rama(s) huérfana(s): ${orphanBranchesCleaned.map(b => b.branch).join(", ")}.`,
      );
    }
    try {
      await sendMessage(userId, lines.join("\n"));
    } catch (err) {
      log.error(
        { userId, error: (err as Error).message },
        "Failed to send reconciler notification",
      );
    }
  }

  log.info(
    {
      physicalChecked: candidates.length,
      removed: removedOrphans.length,
      skipped: skippedOrphans.length,
      phantomCleared: phantomCleared.length,
      orphanBranchesCleaned: orphanBranchesCleaned.length,
      orphanBranchesSkipped: orphanBranchesSkipped.length,
    },
    "Worktree reconcile complete",
  );
}
