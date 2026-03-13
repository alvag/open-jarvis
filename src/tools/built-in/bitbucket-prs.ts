import type { Tool, ToolResult } from "../tool-types.js";
import { BitbucketClient } from "../bitbucket-api.js";

let client: BitbucketClient | null = null;
function getClient(): BitbucketClient {
  if (!client) client = new BitbucketClient();
  return client;
}

interface TruncateResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  includedLines: number;
  filesChanged: number;
}

function truncateDiff(rawDiff: string, maxLines: number): TruncateResult {
  const totalLines = rawDiff.split("\n").length;

  if (totalLines <= maxLines) {
    const filesChanged = (rawDiff.match(/^diff --git /gm) || []).length;
    return {
      content: rawDiff,
      truncated: false,
      totalLines,
      includedLines: totalLines,
      filesChanged,
    };
  }

  // Split by file sections
  const sections: { header: string; lines: string[] }[] = [];
  const parts = rawDiff.split(/^(diff --git .*$)/m);

  for (let i = 1; i < parts.length; i += 2) {
    const header = parts[i];
    const body = parts[i + 1] || "";
    sections.push({ header, lines: body.split("\n") });
  }

  const filesChanged = sections.length;
  if (filesChanged === 0) {
    return {
      content: rawDiff.split("\n").slice(0, maxLines).join("\n"),
      truncated: true,
      totalLines,
      includedLines: maxLines,
      filesChanged: 0,
    };
  }

  // Distribute budget proportionally (minimum 20 lines per file)
  const minPerFile = 20;
  const totalBodyLines = sections.reduce((s, sec) => s + sec.lines.length, 0);
  const budgetForBody = maxLines - filesChanged; // reserve 1 line per header

  const result: string[] = [];
  let includedLines = 0;

  for (const section of sections) {
    result.push(section.header);
    includedLines++;

    const proportion = totalBodyLines > 0
      ? section.lines.length / totalBodyLines
      : 1 / filesChanged;
    const budget = Math.max(minPerFile, Math.floor(budgetForBody * proportion));

    if (section.lines.length <= budget) {
      result.push(...section.lines);
      includedLines += section.lines.length;
    } else {
      result.push(...section.lines.slice(0, budget));
      includedLines += budget;
      const remaining = section.lines.length - budget;
      result.push(`\n... [truncated: ${remaining} more lines]`);
    }
  }

  return {
    content: result.join("\n"),
    truncated: true,
    totalLines,
    includedLines,
    filesChanged,
  };
}

const bitbucketPrsTool: Tool = {
  definition: {
    name: "bitbucket_prs",
    description:
      "Interact with Bitbucket Cloud Pull Requests. Can list PRs, get PR details, get diffs, get comments, or perform a full code review analysis.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "The action to perform",
          enum: [
            "list_prs",
            "get_pr",
            "get_pr_diff",
            "get_pr_comments",
            "review_pr",
          ],
        },
        pr_id: {
          type: "string",
          description:
            "The PR number/ID (required for all actions except list_prs)",
        },
        workspace: {
          type: "string",
          description:
            "Bitbucket workspace (overrides default from BITBUCKET_WORKSPACE env var)",
        },
        repo_slug: {
          type: "string",
          description:
            "Repository slug (overrides default from BITBUCKET_REPO_SLUG env var)",
        },
        state: {
          type: "string",
          description: "Filter PRs by state (for list_prs action)",
          enum: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"],
        },
        max_diff_lines: {
          type: "string",
          description:
            "Maximum lines to include from diff before truncating (default: 1500)",
        },
      },
      required: ["action"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const action = args.action as string;
    const prId = args.pr_id as string | undefined;
    const workspace = args.workspace as string | undefined;
    const repoSlug = args.repo_slug as string | undefined;
    const state = args.state as string | undefined;
    const maxDiffLines = parseInt((args.max_diff_lines as string) || "1500", 10);

    const api = getClient();

    try {
      switch (action) {
        case "list_prs": {
          const result = await api.listPRs(workspace, repoSlug, state);
          const prs = result.values.map((pr) => ({
            id: pr.id,
            title: pr.title,
            author: pr.author.display_name,
            state: pr.state,
            source_branch: pr.source.branch.name,
            destination_branch: pr.destination.branch.name,
            created_on: pr.created_on,
            url: pr.links.html.href,
          }));
          return { success: true, data: { prs, count: prs.length } };
        }

        case "get_pr": {
          if (!prId) {
            return { success: false, data: null, error: "pr_id is required for 'get_pr' action" };
          }
          const pr = await api.getPR(prId, workspace, repoSlug);
          return {
            success: true,
            data: {
              id: pr.id,
              title: pr.title,
              description: pr.description,
              author: pr.author.display_name,
              state: pr.state,
              source_branch: pr.source.branch.name,
              destination_branch: pr.destination.branch.name,
              reviewers: pr.reviewers.map((r) => r.display_name),
              created_on: pr.created_on,
              updated_on: pr.updated_on,
              url: pr.links.html.href,
            },
          };
        }

        case "get_pr_diff": {
          if (!prId) {
            return { success: false, data: null, error: "pr_id is required for 'get_pr_diff' action" };
          }
          const rawDiff = await api.getPRDiff(prId, workspace, repoSlug);
          const diff = truncateDiff(rawDiff, maxDiffLines);
          return {
            success: true,
            data: {
              diff: diff.content,
              truncated: diff.truncated,
              total_lines: diff.totalLines,
              included_lines: diff.includedLines,
              files_changed: diff.filesChanged,
            },
          };
        }

        case "get_pr_comments": {
          if (!prId) {
            return { success: false, data: null, error: "pr_id is required for 'get_pr_comments' action" };
          }
          const result = await api.getPRComments(prId, workspace, repoSlug);
          const comments = result.values.map((c) => ({
            id: c.id,
            author: c.user.display_name,
            content: c.content.raw,
            created_on: c.created_on,
            file: c.inline?.path || null,
            line: c.inline?.to ?? c.inline?.from ?? null,
            parent_id: c.parent?.id || null,
          }));
          return { success: true, data: { comments, count: comments.length } };
        }

        case "review_pr": {
          if (!prId) {
            return { success: false, data: null, error: "pr_id is required for 'review_pr' action" };
          }

          const warnings: string[] = [];

          const [prResult, diffResult, commentsResult] = await Promise.allSettled([
            api.getPR(prId, workspace, repoSlug),
            api.getPRDiff(prId, workspace, repoSlug),
            api.getPRComments(prId, workspace, repoSlug),
          ]);

          // PR detail (required)
          if (prResult.status === "rejected") {
            return {
              success: false,
              data: null,
              error: `Failed to fetch PR: ${prResult.reason}`,
            };
          }
          const pr = prResult.value;

          // Diff (optional — degrade gracefully)
          let diff: TruncateResult | null = null;
          if (diffResult.status === "fulfilled") {
            diff = truncateDiff(diffResult.value, maxDiffLines);
          } else {
            warnings.push(`Could not fetch diff: ${diffResult.reason}`);
          }

          // Comments (optional — degrade gracefully)
          let comments: {
            author: string;
            content: string;
            created_on: string;
            file: string | null;
            line: number | null;
            parent_id: number | null;
          }[] = [];
          if (commentsResult.status === "fulfilled") {
            comments = commentsResult.value.values.map((c) => ({
              author: c.user.display_name,
              content: c.content.raw,
              created_on: c.created_on,
              file: c.inline?.path || null,
              line: c.inline?.to ?? c.inline?.from ?? null,
              parent_id: c.parent?.id || null,
            }));
          } else {
            warnings.push(`Could not fetch comments: ${commentsResult.reason}`);
          }

          const ws = workspace || pr.links.html.href.split("/")[3] || "";
          const repo = repoSlug || pr.links.html.href.split("/")[4] || "";

          return {
            success: true,
            data: {
              review_instructions:
                "Analyze this PR and produce a structured code review. Include: " +
                "1) **Strengths** — what's done well, with file references. " +
                "2) **Issues** — categorized as Critical/Important/Minor, each with file:line, what the issue is, why it matters, and how to fix it. " +
                "3) **Recommendations** — suggestions for improvement beyond specific issues. " +
                "4) **Assessment** — clear verdict: Ready to merge / Ready with minor fixes / Needs changes. " +
                "Focus on logic errors, security issues, performance problems, and maintainability. " +
                "Reference specific files and line numbers from the diff.",
              pr: {
                id: pr.id,
                title: pr.title,
                description: pr.description,
                author: pr.author.display_name,
                state: pr.state,
                source_branch: pr.source.branch.name,
                destination_branch: pr.destination.branch.name,
                reviewers: pr.reviewers.map((r) => r.display_name),
                created_on: pr.created_on,
              },
              diff: diff
                ? {
                    content: diff.content,
                    truncated: diff.truncated,
                    total_lines: diff.totalLines,
                    included_lines: diff.includedLines,
                    files_changed: diff.filesChanged,
                  }
                : null,
              comments,
              metadata: {
                workspace: ws,
                repo_slug: repo,
                pr_url: pr.links.html.href,
              },
              warnings,
            },
          };
        }

        default:
          return { success: false, data: null, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
};

export default bitbucketPrsTool;
