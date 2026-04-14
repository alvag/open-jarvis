import type { Tool, ToolResult } from "../tool-types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createGithubPrsTool(codebaseRoot?: string): Tool {
  const repoDir = codebaseRoot || process.cwd();
  let ghAvailable: boolean | null = null;

  async function checkGhAvailable(): Promise<ToolResult | null> {
    if (ghAvailable !== null) {
      return ghAvailable
        ? null
        : {
            success: false,
            data: {
              gh_available: false,
              message:
                "gh CLI is not available. See previous error for details.",
            },
            error: "gh CLI is not available",
          };
    }

    try {
      await execFileAsync("which", ["gh"], { timeout: 5_000 });
    } catch {
      ghAvailable = false;
      return {
        success: false,
        data: {
          gh_available: false,
          message:
            "gh CLI is not installed. Install with: brew install gh. You can still work locally (worktree + branch + commit) without creating PRs.",
        },
        error:
          "gh CLI is not installed. Install with: brew install gh. You can still work locally (worktree + branch + commit) without creating PRs.",
      };
    }

    try {
      await execFileAsync("gh", ["auth", "status"], { timeout: 10_000 });
    } catch {
      ghAvailable = false;
      return {
        success: false,
        data: {
          gh_available: false,
          message:
            "gh CLI is not authenticated. Run: gh auth login. You can still work locally without creating PRs.",
        },
        error:
          "gh CLI is not authenticated. Run: gh auth login. You can still work locally without creating PRs.",
      };
    }

    ghAvailable = true;
    return null;
  }

  return {
    definition: {
      name: "github_prs",
      description:
        "Interact with GitHub Pull Requests via the gh CLI. Can list PRs, get PR details, create PRs, and check PR status.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The action to perform",
            enum: ["list_prs", "get_pr", "create_pr", "check_status"],
          },
          pr_number: {
            type: "string",
            description:
              "The PR number (required for get_pr and check_status actions)",
          },
          state: {
            type: "string",
            description:
              "Filter PRs by state (for list_prs action, default: open)",
            enum: ["open", "closed", "merged", "all"],
          },
          title: {
            type: "string",
            description: "PR title (required for create_pr action)",
          },
          source_branch: {
            type: "string",
            description:
              "Source branch / head branch (required for create_pr action)",
          },
          destination_branch: {
            type: "string",
            description:
              "Destination branch / base branch (for create_pr action, default: main)",
          },
          description: {
            type: "string",
            description: "PR description/body (for create_pr action)",
          },
          draft: {
            type: "string",
            description:
              "Whether to create the PR as a draft (for create_pr action)",
            enum: ["true", "false"],
          },
        },
        required: ["action"],
      },
    },

    async execute(args): Promise<ToolResult> {
      const action = args.action as string;

      const ghCheck = await checkGhAvailable();
      if (ghCheck) return ghCheck;

      try {
        switch (action) {
          case "list_prs": {
            const state = (args.state as string) || "open";
            const { stdout } = await execFileAsync(
              "gh",
              [
                "pr",
                "list",
                "--state",
                state,
                "--json",
                "number,title,state,headRefName,url,author",
                "--limit",
                "30",
              ],
              { cwd: repoDir, timeout: 30_000 },
            );
            const prs = JSON.parse(stdout);
            return { success: true, data: { prs, count: prs.length } };
          }

          case "get_pr": {
            const prNumber = args.pr_number as string | undefined;
            if (!prNumber) {
              return {
                success: false,
                data: null,
                error: "pr_number is required for 'get_pr' action",
              };
            }
            const { stdout } = await execFileAsync(
              "gh",
              [
                "pr",
                "view",
                prNumber,
                "--json",
                "number,title,body,state,headRefName,baseRefName,url,author,mergeable,reviewDecision",
              ],
              { cwd: repoDir, timeout: 30_000 },
            );
            const pr = JSON.parse(stdout);
            return { success: true, data: pr };
          }

          case "create_pr": {
            const title = args.title as string | undefined;
            const sourceBranch = args.source_branch as string | undefined;
            if (!title || !sourceBranch) {
              return {
                success: false,
                data: null,
                error:
                  "title and source_branch are required for 'create_pr' action",
              };
            }
            const destinationBranch =
              (args.destination_branch as string) || "main";
            const description = (args.description as string) || "";
            const draft = args.draft as string | undefined;

            const createArgs = [
              "pr",
              "create",
              "--head",
              sourceBranch,
              "--base",
              destinationBranch,
              "--title",
              title,
              "--body",
              description,
            ];
            if (draft === "true") {
              createArgs.push("--draft");
            }

            const { stdout } = await execFileAsync("gh", createArgs, {
              cwd: repoDir,
              timeout: 30_000,
            });

            // gh pr create prints the PR URL to stdout
            const url = stdout.trim();
            const numberMatch = url.match(/\/pull\/(\d+)/);
            const number = numberMatch ? parseInt(numberMatch[1], 10) : null;

            return {
              success: true,
              data: {
                number,
                url,
                title,
                source_branch: sourceBranch,
                destination_branch: destinationBranch,
              },
            };
          }

          case "check_status": {
            const prNumber = args.pr_number as string | undefined;
            if (!prNumber) {
              return {
                success: false,
                data: null,
                error: "pr_number is required for 'check_status' action",
              };
            }
            const { stdout } = await execFileAsync(
              "gh",
              [
                "pr",
                "view",
                prNumber,
                "--json",
                "state,mergedAt,closedAt,reviewDecision",
              ],
              { cwd: repoDir, timeout: 30_000 },
            );
            const status = JSON.parse(stdout);
            return {
              success: true,
              data: {
                state: status.state,
                merged_at: status.mergedAt,
                closed_at: status.closedAt,
                review_decision: status.reviewDecision,
              },
            };
          }

          default:
            return {
              success: false,
              data: null,
              error: `Unknown action: ${action}`,
            };
        }
      } catch (err) {
        const error = err as Error & { stderr?: string };
        const message = error.stderr?.trim() || error.message;
        return { success: false, data: null, error: message };
      }
    },
  };
}
