import type Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("github-pr-monitor");
const execFileAsync = promisify(execFile);

interface BacklogRow {
  id: number;
  user_id: string;
  title: string;
  pr_number: number;
  pr_url: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  status: string;
}

type CleanupOutcome =
  | { kind: "removed" }
  | { kind: "skipped_dirty"; reason: string }
  | { kind: "skipped_missing" }
  | { kind: "error"; message: string };

async function hasUncommittedChanges(worktreePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", worktreePath, "status", "--porcelain"],
      { timeout: 10_000 },
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function cleanupWorktree(
  codebaseRoot: string,
  worktreePath: string | null,
  branchName: string | null,
): Promise<CleanupOutcome> {
  if (!worktreePath) {
    return { kind: "skipped_missing" };
  }

  if (!existsSync(worktreePath)) {
    if (branchName) {
      try {
        await execFileAsync("git", ["-C", codebaseRoot, "branch", "-D", branchName], {
          timeout: 10_000,
        });
      } catch (err) {
        log.warn(
          { branchName, error: (err as Error).message },
          "Branch delete failed after worktree already missing",
        );
      }
    }
    return { kind: "skipped_missing" };
  }

  if (await hasUncommittedChanges(worktreePath)) {
    return {
      kind: "skipped_dirty",
      reason: "Worktree has uncommitted changes — not removed to avoid data loss",
    };
  }

  try {
    await execFileAsync(
      "git",
      ["-C", codebaseRoot, "worktree", "remove", worktreePath],
      { timeout: 15_000 },
    );
  } catch (err) {
    const message = (err as Error & { stderr?: string }).stderr?.trim() || (err as Error).message;
    return { kind: "error", message };
  }

  if (branchName) {
    try {
      await execFileAsync("git", ["-C", codebaseRoot, "branch", "-D", branchName], {
        timeout: 10_000,
      });
    } catch (err) {
      log.warn(
        { branchName, error: (err as Error).message },
        "Branch delete failed after worktree removal",
      );
    }
  }

  return { kind: "removed" };
}

function formatNotification(
  item: BacklogRow,
  newStatus: "merged" | "dismissed",
  cleanup: CleanupOutcome,
): string {
  const emoji = newStatus === "merged" ? "\u2705" : "\u274C";
  const verb = newStatus === "merged" ? "mergeado" : "cerrado sin merge";
  const header = `${emoji} PR #${item.pr_number} ${verb}: ${item.title}`;
  const lines: string[] = [header];

  if (cleanup.kind === "removed") {
    lines.push(`Worktree ${item.worktree_path} y rama ${item.branch_name ?? "(sin rama)"} eliminados.`);
  } else if (cleanup.kind === "skipped_dirty") {
    lines.push(`\u26A0\uFE0F ${cleanup.reason}. Worktree conservado en ${item.worktree_path}.`);
  } else if (cleanup.kind === "skipped_missing") {
    lines.push(`Worktree ya no existia. Rama ${item.branch_name ?? "(sin rama)"} eliminada si estaba presente.`);
  } else if (cleanup.kind === "error") {
    lines.push(`\u26A0\uFE0F Error limpiando worktree: ${cleanup.message}. Revisalo manualmente.`);
  }

  if (item.pr_url) {
    lines.push(item.pr_url);
  }

  return lines.join("\n");
}

interface GhPrView {
  state: "OPEN" | "MERGED" | "CLOSED";
  mergedAt: string | null;
  closedAt: string | null;
}

async function fetchPrState(codebaseRoot: string, prNumber: number): Promise<GhPrView | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", String(prNumber), "--json", "state,mergedAt,closedAt"],
      { cwd: codebaseRoot, timeout: 30_000 },
    );
    return JSON.parse(stdout) as GhPrView;
  } catch (err) {
    const message = (err as Error & { stderr?: string }).stderr?.trim() || (err as Error).message;
    log.warn({ prNumber, error: message }, "Failed to fetch PR state via gh");
    return null;
  }
}

export async function checkGithubPRChanges(
  db: Database.Database,
  sendMessage: (userId: string, text: string) => Promise<void>,
  userId: string,
  codebaseRoot: string,
): Promise<void> {
  try {
    const rows = db
      .prepare<
        [string],
        BacklogRow
      >(
        `SELECT id, user_id, title, pr_number, pr_url, branch_name, worktree_path, status
         FROM backlog_items
         WHERE user_id = ? AND status = 'pr_created' AND pr_number IS NOT NULL`,
      )
      .all(userId) as BacklogRow[];

    if (rows.length === 0) {
      log.info("No open Jarvis PRs tracked in backlog");
      return;
    }

    const updateStatus = db.prepare(
      "UPDATE backlog_items SET status = ?, updated_at = datetime('now') WHERE id = ?",
    );

    let checked = 0;
    let transitioned = 0;

    for (const item of rows) {
      checked++;
      const prState = await fetchPrState(codebaseRoot, item.pr_number);
      if (!prState) continue;

      let newStatus: "merged" | "dismissed" | null = null;
      if (prState.state === "MERGED") {
        newStatus = "merged";
      } else if (prState.state === "CLOSED" && !prState.mergedAt) {
        newStatus = "dismissed";
      }

      if (!newStatus) continue;

      transitioned++;

      const cleanup: CleanupOutcome = config.workflow.autoCleanupWorktree
        ? await cleanupWorktree(codebaseRoot, item.worktree_path, item.branch_name)
        : { kind: "skipped_dirty", reason: "Autocleanup deshabilitado (WORKFLOW_AUTO_CLEANUP_WORKTREE=false)" };

      updateStatus.run(newStatus, item.id);
      log.info(
        {
          backlogId: item.id,
          prNumber: item.pr_number,
          newStatus,
          cleanup: cleanup.kind,
        },
        "Backlog item transitioned after PR state change",
      );

      try {
        await sendMessage(userId, formatNotification(item, newStatus, cleanup));
      } catch (err) {
        log.error(
          { userId, error: (err as Error).message },
          "Failed to send GitHub PR transition notification",
        );
      }
    }

    log.info({ checked, transitioned }, "GitHub PR check complete");
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "GitHub PR check failed",
    );
  }
}
