import type Database from "better-sqlite3";
import type { Tool, ToolContext, ToolResult } from "../tool-types.js";
import { config } from "../../config.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { createLogger } from "../../logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("git_worktree");

interface CodebaseConfig {
  root: string;
  maxFileSize: number;
  maxOutputChars: number;
  ignorePatterns: string[];
}

const GIT_TIMEOUT = 30_000;

/** Validate that a resolved path is inside the allowed root (no path traversal). */
function isInsideRoot(resolvedPath: string, root: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(resolvedPath);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(normalizedRoot + "/")
  );
}

/** Run a git command with timeout and cwd. */
async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, timeout: GIT_TIMEOUT });
}

/** Validate branch name format after prefix: must be (fix|refactor|feat)-something */
function isValidBranchSlug(slug: string): boolean {
  return /^(fix|refactor|feat)-.+$/.test(slug);
}

/** Parse `git worktree list --porcelain` output into structured objects. */
function parseWorktreeList(
  output: string,
): Array<{ path: string; branch: string; commit: string; bare: boolean }> {
  const entries: Array<{
    path: string;
    branch: string;
    commit: string;
    bare: boolean;
  }> = [];
  const blocks = output.trim().split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.split("\n");
    let path = "";
    let branch = "";
    let commit = "";
    let bare = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        commit = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        // branch refs/heads/jarvis/fix-login -> jarvis/fix-login
        branch = line.slice("branch ".length).replace("refs/heads/", "");
      } else if (line === "bare") {
        bare = true;
      }
    }

    if (path) {
      entries.push({ path, branch, commit, bare });
    }
  }

  return entries;
}

export function createGitWorktreeTool(
  codebaseConfig: CodebaseConfig,
  db?: Database.Database,
): Tool {
  return {
    definition: {
      name: "git_worktree",
      description:
        "Manage git worktrees for isolated branch work. Supports creating, listing, removing, and checking the status of worktrees. Each worktree provides an isolated working directory for a branch, enabling parallel development without stashing or switching branches. When creating a worktree tied to a backlog item, ALWAYS pass backlog_item_id so branch_name, worktree_path, and status='in_progress' are recorded atomically — without this link, automatic cleanup cannot find the worktree if the PR step is skipped.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description:
              "The worktree operation to perform: create, list, remove, or status.",
            enum: ["create", "list", "remove", "status"],
          },
          branch_name: {
            type: "string",
            description:
              "Branch name. For 'create': the new branch (auto-prefixed if needed, must match fix|refactor|feat pattern). For 'remove'/'status': used to resolve the worktree path.",
          },
          base_branch: {
            type: "string",
            description:
              "Base branch to create the worktree from. Default: the configured default branch (usually 'main'). Only used with 'create'.",
          },
          worktree_path: {
            type: "string",
            description:
              "Absolute path to the worktree. Used with 'remove' or 'status' as alternative to branch_name.",
          },
          delete_branch: {
            type: "string",
            description:
              "Set to 'true' to also delete the branch when removing a worktree. Only used with 'remove'. Default: 'false'.",
          },
          backlog_item_id: {
            type: "string",
            description:
              "Optional backlog item ID (number as string) to link the worktree with. When provided with 'create', the backlog item is atomically updated with branch_name, worktree_path, and status='in_progress' so later cleanup can find the worktree even if the PR step never runs.",
          },
        },
        required: ["action"],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      const action = args.action as string;

      try {
        switch (action) {
          case "create":
            return await handleCreate(args, codebaseConfig, db, context);
          case "list":
            return await handleList(codebaseConfig);
          case "remove":
            return await handleRemove(args, codebaseConfig);
          case "status":
            return await handleStatus(args, codebaseConfig);
          default:
            return {
              success: false,
              data: null,
              error: `Unknown action "${action}". Valid actions: create, list, remove, status.`,
            };
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return { success: false, data: null, error: message };
      }
    },
  };
}

async function handleCreate(
  args: Record<string, unknown>,
  codebaseConfig: CodebaseConfig,
  db: Database.Database | undefined,
  context: ToolContext,
): Promise<ToolResult> {
  const wf = config.workflow;
  let branchName = args.branch_name as string;
  const baseBranch = (args.base_branch as string) || wf.defaultBranch;

  if (!branchName) {
    return {
      success: false,
      data: null,
      error: "branch_name is required for 'create' action.",
    };
  }

  // Auto-prepend prefix if missing
  if (!branchName.startsWith(`${wf.branchPrefix}/`)) {
    branchName = `${wf.branchPrefix}/${branchName}`;
  }

  // Extract slug (everything after prefix/)
  const slug = branchName.slice(wf.branchPrefix.length + 1);

  // Validate slug format
  if (!isValidBranchSlug(slug)) {
    return {
      success: false,
      data: null,
      error: `Invalid branch name slug "${slug}". Must match pattern: (fix|refactor|feat)-<description>. Example: ${wf.branchPrefix}/feat-add-login`,
    };
  }

  // Calculate worktree path
  const worktreePath = resolve(codebaseConfig.root, wf.worktreesDir, slug);

  // Security: ensure worktree path is inside root
  if (!isInsideRoot(worktreePath, codebaseConfig.root)) {
    return {
      success: false,
      data: null,
      error: "Resolved worktree path is outside the repository root. Aborting.",
    };
  }

  // Check if worktree path already exists
  if (existsSync(worktreePath)) {
    return {
      success: false,
      data: null,
      error: `Worktree path already exists: ${worktreePath}. Remove it first or choose a different branch name.`,
    };
  }

  // Fetch the base branch
  await git(["fetch", "origin", baseBranch], codebaseConfig.root);

  // Create worktree with new branch
  await git(
    ["worktree", "add", "-b", branchName, worktreePath, `origin/${baseBranch}`],
    codebaseConfig.root,
  );

  // Auto-link backlog item if provided. Scoped by user_id to prevent
  // one user from hijacking another's backlog row. Atomicity contract:
  // if backlog_item_id is passed, the link MUST succeed — otherwise we
  // roll back the worktree so the caller cannot mistakenly proceed with
  // create_pr using an unlinked backlog row (which would leak the worktree
  // once the PR is merged: status=pr_created with worktree_path=NULL).
  const backlogItemRaw = args.backlog_item_id as string | undefined;
  let backlogItemLinked: number | null = null;
  if (backlogItemRaw && db) {
    const backlogId = parseInt(backlogItemRaw, 10);
    let linkError: string | null = null;

    if (Number.isNaN(backlogId)) {
      linkError = `invalid backlog_item_id "${backlogItemRaw}" (not an integer)`;
    } else {
      try {
        // Only link to backlog rows currently in status='open'. Anything
        // already 'in_progress', 'pr_created', 'merged' or 'dismissed' is
        // either in flight or closed, and overwriting its branch_name /
        // worktree_path would clobber history (e.g. the link to an existing
        // merged PR). A retry after a partial failure requires explicit
        // intervention: the agent must first reset status via manage_backlog.
        const result = db
          .prepare(
            "UPDATE backlog_items SET branch_name = ?, worktree_path = ?, status = 'in_progress', updated_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'open'",
          )
          .run(branchName, worktreePath, backlogId, context.userId);
        if (result.changes > 0) {
          backlogItemLinked = backlogId;
          log.info(
            { backlogId, branchName, worktreePath, userId: context.userId },
            "Linked worktree to backlog item",
          );
        } else {
          // Disambiguate: does the row exist at all, or does it exist in a
          // non-open state? This helps the agent surface the real reason
          // without issuing a second, expensive retry.
          const existing = db
            .prepare<[number, string], { status: string }>(
              "SELECT status FROM backlog_items WHERE id = ? AND user_id = ?",
            )
            .get(backlogId, context.userId);
          if (!existing) {
            linkError = `no backlog row with id=${backlogId} belongs to user ${context.userId}`;
          } else {
            linkError = `backlog row id=${backlogId} is in status='${existing.status}', not 'open' — refusing to overwrite existing link`;
          }
        }
      } catch (err) {
        linkError = (err as Error).message;
      }
    }

    if (linkError) {
      // Rollback the worktree + branch we just created so the caller can retry
      // cleanly. `--force` handles the (rare) case where we can't even call
      // remove without it; a non-forced remove should succeed since the tree
      // is brand new and clean.
      log.warn(
        { backlogId, linkError, worktreePath, branchName },
        "Backlog link failed — rolling back worktree",
      );
      try {
        await git(
          ["worktree", "remove", "--force", worktreePath],
          codebaseConfig.root,
        );
      } catch (err) {
        log.error(
          { worktreePath, error: (err as Error).message },
          "Rollback: git worktree remove failed — orphan may be left on disk, please clean up manually",
        );
      }
      try {
        await git(["branch", "-D", branchName], codebaseConfig.root);
      } catch (err) {
        log.warn(
          { branchName, error: (err as Error).message },
          "Rollback: branch delete failed",
        );
      }
      return {
        success: false,
        data: null,
        error: `Created worktree but failed to link to backlog item: ${linkError}. Worktree rolled back — verify backlog_item_id and retry.`,
      };
    }
  }

  return {
    success: true,
    data: {
      worktree_path: worktreePath,
      branch_name: branchName,
      base_branch: baseBranch,
      backlog_item_id: backlogItemLinked,
    },
  };
}

async function handleList(
  codebaseConfig: CodebaseConfig,
): Promise<ToolResult> {
  const wf = config.workflow;
  const { stdout } = await git(
    ["worktree", "list", "--porcelain"],
    codebaseConfig.root,
  );

  const all = parseWorktreeList(stdout);

  // Filter: only show worktrees inside the worktrees directory
  const worktreesBase = resolve(codebaseConfig.root, wf.worktreesDir);
  const filtered = all.filter((wt) => {
    const resolved = resolve(wt.path);
    return (
      resolved === worktreesBase ||
      resolved.startsWith(worktreesBase + "/")
    );
  });

  return {
    success: true,
    data: {
      count: filtered.length,
      worktrees: filtered,
    },
  };
}

async function handleRemove(
  args: Record<string, unknown>,
  codebaseConfig: CodebaseConfig,
): Promise<ToolResult> {
  const wf = config.workflow;
  let worktreePath = args.worktree_path as string | undefined;
  let branchName = args.branch_name as string | undefined;
  const deleteBranch = (args.delete_branch as string) === "true";

  if (!worktreePath && !branchName) {
    return {
      success: false,
      data: null,
      error:
        "Either worktree_path or branch_name is required for 'remove' action.",
    };
  }

  // If branch_name given, resolve worktree_path from it
  if (!worktreePath && branchName) {
    // Auto-prepend prefix if missing
    if (!branchName.startsWith(`${wf.branchPrefix}/`)) {
      branchName = `${wf.branchPrefix}/${branchName}`;
    }
    const slug = branchName.slice(wf.branchPrefix.length + 1);
    worktreePath = resolve(codebaseConfig.root, wf.worktreesDir, slug);
  }

  const resolvedPath = resolve(worktreePath!);

  // Security: ensure path is inside root
  if (!isInsideRoot(resolvedPath, codebaseConfig.root)) {
    return {
      success: false,
      data: null,
      error: "Resolved worktree path is outside the repository root. Aborting.",
    };
  }

  // If we need to delete the branch but don't have the name, look it up
  if (deleteBranch && !branchName) {
    const { stdout } = await git(
      ["worktree", "list", "--porcelain"],
      codebaseConfig.root,
    );
    const all = parseWorktreeList(stdout);
    const match = all.find((wt) => resolve(wt.path) === resolvedPath);
    if (match) {
      branchName = match.branch;
    }
  }

  // Remove the worktree
  await git(["worktree", "remove", resolvedPath], codebaseConfig.root);

  let branchDeleted = false;

  // Optionally delete the branch
  if (deleteBranch && branchName) {
    try {
      await git(["branch", "-d", branchName], codebaseConfig.root);
      branchDeleted = true;
    } catch (err) {
      // Branch deletion failed (e.g., not fully merged) — report but don't fail
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: true,
        data: {
          removed_path: resolvedPath,
          branch_deleted: false,
          branch_delete_error: message,
        },
      };
    }
  }

  return {
    success: true,
    data: {
      removed_path: resolvedPath,
      branch_deleted: branchDeleted,
    },
  };
}

async function handleStatus(
  args: Record<string, unknown>,
  codebaseConfig: CodebaseConfig,
): Promise<ToolResult> {
  const wf = config.workflow;
  let worktreePath = args.worktree_path as string | undefined;
  let branchName = args.branch_name as string | undefined;

  if (!worktreePath && !branchName) {
    return {
      success: false,
      data: null,
      error:
        "Either worktree_path or branch_name is required for 'status' action.",
    };
  }

  // If branch_name given, resolve worktree_path from it
  if (!worktreePath && branchName) {
    // Auto-prepend prefix if missing
    if (!branchName.startsWith(`${wf.branchPrefix}/`)) {
      branchName = `${wf.branchPrefix}/${branchName}`;
    }
    const slug = branchName.slice(wf.branchPrefix.length + 1);
    worktreePath = resolve(codebaseConfig.root, wf.worktreesDir, slug);
  }

  const resolvedPath = resolve(worktreePath!);

  // Security: ensure path is inside root
  if (!isInsideRoot(resolvedPath, codebaseConfig.root)) {
    return {
      success: false,
      data: null,
      error: "Resolved worktree path is outside the repository root. Aborting.",
    };
  }

  if (!existsSync(resolvedPath)) {
    return {
      success: false,
      data: null,
      error: `Worktree path does not exist: ${resolvedPath}`,
    };
  }

  // Get current branch in the worktree
  const { stdout: currentBranch } = await git(
    ["rev-parse", "--abbrev-ref", "HEAD"],
    resolvedPath,
  );

  // Get status
  const { stdout: statusOutput } = await git(
    ["status", "--porcelain"],
    resolvedPath,
  );

  const changedFiles = statusOutput
    .split("\n")
    .filter((line) => line.trim().length > 0);

  // Determine base branch for comparison
  const baseBranch =
    (args.base_branch as string) || wf.defaultBranch;

  // Get commits ahead
  let commitsAhead = 0;
  try {
    const { stdout: logOutput } = await git(
      ["log", "--oneline", `origin/${baseBranch}..HEAD`],
      resolvedPath,
    );
    commitsAhead = logOutput
      .split("\n")
      .filter((line) => line.trim().length > 0).length;
  } catch {
    // origin/baseBranch might not exist, that's ok
  }

  return {
    success: true,
    data: {
      clean: changedFiles.length === 0,
      files_changed: changedFiles.length,
      commits_ahead: commitsAhead,
      branch: currentBranch.trim(),
    },
  };
}
