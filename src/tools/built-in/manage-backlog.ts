import type Database from "better-sqlite3";
import type { Tool, ToolResult } from "../tool-types.js";

interface BacklogItemRow {
  id: number;
  user_id: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  confidence: string;
  status: string;
  source_tool: string | null;
  source_finding_id: string | null;
  files: string;
  evidence: string;
  pr_number: number | null;
  pr_url: string | null;
  branch_name: string | null;
  worktree_path: string | null;
  dismiss_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface CountByStatus {
  status: string;
  count: number;
}

interface CountByCategory {
  category: string;
  count: number;
}

interface CountBySeverity {
  severity: string;
  count: number;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function createManageBacklogTool(db: Database.Database): Tool {
  const stmts = {
    findBySource: db.prepare(
      `SELECT * FROM backlog_items WHERE user_id = ? AND source_tool = ? AND source_finding_id = ? LIMIT 1`,
    ),
    insertItem: db.prepare(`
      INSERT INTO backlog_items (user_id, title, description, category, severity, confidence, source_tool, source_finding_id, files, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getItem: db.prepare(
      `SELECT * FROM backlog_items WHERE user_id = ? AND id = ?`,
    ),
    getLastInserted: db.prepare(
      `SELECT * FROM backlog_items WHERE id = ?`,
    ),
    listAll: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listByStatus: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND status = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listByCategory: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND category = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listBySeverity: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND severity = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listByStatusAndCategory: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND status = ? AND category = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listByStatusAndSeverity: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND status = ? AND severity = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listByCategoryAndSeverity: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND category = ? AND severity = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    listByAllFilters: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND status = ? AND category = ? AND severity = ?
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
    `),
    nextItem: db.prepare(`
      SELECT * FROM backlog_items WHERE user_id = ? AND status = 'open'
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END ASC, created_at ASC
      LIMIT 1
    `),
    dismissItem: db.prepare(`
      UPDATE backlog_items SET status = 'dismissed', dismiss_reason = ?, updated_at = datetime('now') WHERE id = ?
    `),
    countByStatus: db.prepare(`
      SELECT status, COUNT(*) as count FROM backlog_items WHERE user_id = ? GROUP BY status
    `),
    countByCategory: db.prepare(`
      SELECT category, COUNT(*) as count FROM backlog_items WHERE user_id = ? GROUP BY category
    `),
    countBySeverity: db.prepare(`
      SELECT severity, COUNT(*) as count FROM backlog_items WHERE user_id = ? GROUP BY severity
    `),
  };

  function buildUpdateQuery(
    fields: Record<string, unknown>,
  ): { sql: string; values: unknown[] } {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    setClauses.push(`updated_at = datetime('now')`);

    return {
      sql: `UPDATE backlog_items SET ${setClauses.join(", ")} WHERE id = ?`,
      values,
    };
  }

  function formatItem(row: BacklogItemRow) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      severity: row.severity,
      confidence: row.confidence,
      status: row.status,
      source_tool: row.source_tool,
      source_finding_id: row.source_finding_id,
      files: JSON.parse(row.files),
      evidence: JSON.parse(row.evidence),
      pr_number: row.pr_number,
      pr_url: row.pr_url,
      branch_name: row.branch_name,
      worktree_path: row.worktree_path,
      dismiss_reason: row.dismiss_reason,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  return {
    definition: {
      name: "manage_backlog",
      description:
        "Manage a backlog of codebase findings (bugs, refactors, improvements). " +
        "Can add items with deduplication, list/filter/sort by priority, get details, update status, dismiss, " +
        "get the next highest-priority item, and view stats. " +
        "Items are prioritized by severity (critical > high > medium > low) and creation date.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The operation to perform",
            enum: [
              "add_item",
              "list_items",
              "get_item",
              "update_item",
              "dismiss_item",
              "next_item",
              "stats",
            ],
          },
          item_id: {
            type: "string",
            description:
              "ID of the backlog item. Required for get_item, update_item, dismiss_item.",
          },
          title: {
            type: "string",
            description: "Title of the backlog item. Required for add_item.",
          },
          description: {
            type: "string",
            description: "Detailed description of the finding.",
          },
          category: {
            type: "string",
            description: "Category of the finding.",
            enum: ["bug", "refactor", "improvement"],
          },
          severity: {
            type: "string",
            description: "Severity level of the finding.",
            enum: ["critical", "high", "medium", "low"],
          },
          confidence: {
            type: "string",
            description: "Confidence level in the finding.",
            enum: ["high", "medium", "low"],
          },
          status: {
            type: "string",
            description:
              "Status filter for list_items, or new status for update_item.",
            enum: ["open", "in_progress", "pr_created", "merged", "dismissed"],
          },
          source_tool: {
            type: "string",
            description:
              "Name of the tool that generated this finding (for deduplication).",
          },
          source_finding_id: {
            type: "string",
            description:
              "ID of the finding from the source tool (for deduplication).",
          },
          files: {
            type: "string",
            description: "JSON array of affected file paths.",
          },
          evidence: {
            type: "string",
            description: "JSON array of evidence strings supporting the finding.",
          },
          pr_number: {
            type: "string",
            description: "PR number associated with this item.",
          },
          pr_url: {
            type: "string",
            description: "PR URL associated with this item.",
          },
          branch_name: {
            type: "string",
            description: "Git branch name for this item.",
          },
          worktree_path: {
            type: "string",
            description: "Path to the git worktree for this item.",
          },
          reason: {
            type: "string",
            description: "Reason for dismissing the item (for dismiss_item).",
          },
        },
        required: ["action"],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      try {
        const action = args.action as string;

        switch (action) {
          case "add_item": {
            const title = args.title as string | undefined;
            const category = args.category as string | undefined;

            if (!title) {
              return {
                success: false,
                data: null,
                error: "title is required for add_item",
              };
            }
            if (!category) {
              return {
                success: false,
                data: null,
                error: "category is required for add_item",
              };
            }

            const description = (args.description as string | undefined) ?? "";
            const severity = (args.severity as string | undefined) ?? "medium";
            const confidence =
              (args.confidence as string | undefined) ?? "medium";
            const sourceTool =
              (args.source_tool as string | undefined) ?? null;
            const sourceFindingId =
              (args.source_finding_id as string | undefined) ?? null;
            const files = (args.files as string | undefined) ?? "[]";
            const evidence = (args.evidence as string | undefined) ?? "[]";

            // Deduplication check
            if (sourceTool && sourceFindingId) {
              const existing = stmts.findBySource.get(
                context.userId,
                sourceTool,
                sourceFindingId,
              ) as BacklogItemRow | undefined;

              if (existing) {
                return {
                  success: true,
                  data: {
                    item: formatItem(existing),
                    note: "already exists",
                  },
                };
              }
            }

            const result = stmts.insertItem.run(
              context.userId,
              title,
              description,
              category,
              severity,
              confidence,
              sourceTool,
              sourceFindingId,
              files,
              evidence,
            );

            const created = stmts.getLastInserted.get(
              result.lastInsertRowid,
            ) as BacklogItemRow;

            return {
              success: true,
              data: { item: formatItem(created) },
            };
          }

          case "list_items": {
            const status = args.status as string | undefined;
            const category = args.category as string | undefined;
            const severity = args.severity as string | undefined;

            let items: BacklogItemRow[];

            if (status && category && severity) {
              items = stmts.listByAllFilters.all(
                context.userId,
                status,
                category,
                severity,
              ) as BacklogItemRow[];
            } else if (status && category) {
              items = stmts.listByStatusAndCategory.all(
                context.userId,
                status,
                category,
              ) as BacklogItemRow[];
            } else if (status && severity) {
              items = stmts.listByStatusAndSeverity.all(
                context.userId,
                status,
                severity,
              ) as BacklogItemRow[];
            } else if (category && severity) {
              items = stmts.listByCategoryAndSeverity.all(
                context.userId,
                category,
                severity,
              ) as BacklogItemRow[];
            } else if (status) {
              items = stmts.listByStatus.all(
                context.userId,
                status,
              ) as BacklogItemRow[];
            } else if (category) {
              items = stmts.listByCategory.all(
                context.userId,
                category,
              ) as BacklogItemRow[];
            } else if (severity) {
              items = stmts.listBySeverity.all(
                context.userId,
                severity,
              ) as BacklogItemRow[];
            } else {
              items = stmts.listAll.all(context.userId) as BacklogItemRow[];
            }

            return {
              success: true,
              data: {
                count: items.length,
                items: items.map(formatItem),
              },
            };
          }

          case "get_item": {
            const itemId = args.item_id as string | undefined;
            if (!itemId) {
              return {
                success: false,
                data: null,
                error: "item_id is required for get_item",
              };
            }

            const item = stmts.getItem.get(
              context.userId,
              Number(itemId),
            ) as BacklogItemRow | undefined;

            if (!item) {
              return {
                success: false,
                data: null,
                error: `Backlog item #${itemId} not found`,
              };
            }

            return {
              success: true,
              data: { item: formatItem(item) },
            };
          }

          case "update_item": {
            const itemId = args.item_id as string | undefined;
            if (!itemId) {
              return {
                success: false,
                data: null,
                error: "item_id is required for update_item",
              };
            }

            const existing = stmts.getItem.get(
              context.userId,
              Number(itemId),
            ) as BacklogItemRow | undefined;

            if (!existing) {
              return {
                success: false,
                data: null,
                error: `Backlog item #${itemId} not found`,
              };
            }

            const updatableFields: Record<string, unknown> = {};
            const allowedKeys = [
              "status",
              "severity",
              "confidence",
              "title",
              "description",
              "pr_number",
              "pr_url",
              "branch_name",
              "worktree_path",
            ];

            for (const key of allowedKeys) {
              const value = args[key] as string | undefined;
              if (value !== undefined) {
                updatableFields[key] =
                  key === "pr_number" ? Number(value) : value;
              }
            }

            if (Object.keys(updatableFields).length === 0) {
              return {
                success: false,
                data: null,
                error:
                  "No fields to update. Provide at least one of: status, severity, confidence, title, description, pr_number, pr_url, branch_name, worktree_path",
              };
            }

            const { sql, values } = buildUpdateQuery(updatableFields);
            values.push(Number(itemId));
            db.prepare(sql).run(...values);

            const updated = stmts.getItem.get(
              context.userId,
              Number(itemId),
            ) as BacklogItemRow;

            return {
              success: true,
              data: { item: formatItem(updated) },
            };
          }

          case "dismiss_item": {
            const itemId = args.item_id as string | undefined;
            if (!itemId) {
              return {
                success: false,
                data: null,
                error: "item_id is required for dismiss_item",
              };
            }

            const existing = stmts.getItem.get(
              context.userId,
              Number(itemId),
            ) as BacklogItemRow | undefined;

            if (!existing) {
              return {
                success: false,
                data: null,
                error: `Backlog item #${itemId} not found`,
              };
            }

            if (existing.status === "dismissed") {
              return {
                success: false,
                data: { item: formatItem(existing) },
                error: `Item #${itemId} is already dismissed`,
              };
            }

            const reason = (args.reason as string | undefined) ?? null;
            stmts.dismissItem.run(reason, Number(itemId));

            const updated = stmts.getItem.get(
              context.userId,
              Number(itemId),
            ) as BacklogItemRow;

            return {
              success: true,
              data: {
                item: formatItem(updated),
                previous_status: existing.status,
              },
            };
          }

          case "next_item": {
            const item = stmts.nextItem.get(context.userId) as
              | BacklogItemRow
              | undefined;

            if (!item) {
              return {
                success: true,
                data: { message: "Backlog is empty" },
              };
            }

            return {
              success: true,
              data: { item: formatItem(item) },
            };
          }

          case "stats": {
            const byStatus = stmts.countByStatus.all(
              context.userId,
            ) as CountByStatus[];
            const byCategory = stmts.countByCategory.all(
              context.userId,
            ) as CountByCategory[];
            const bySeverity = stmts.countBySeverity.all(
              context.userId,
            ) as CountBySeverity[];

            const statusMap: Record<string, number> = {};
            let total = 0;
            for (const row of byStatus) {
              statusMap[row.status] = row.count;
              total += row.count;
            }

            const categoryMap: Record<string, number> = {};
            for (const row of byCategory) {
              categoryMap[row.category] = row.count;
            }

            const severityMap: Record<string, number> = {};
            for (const row of bySeverity) {
              severityMap[row.severity] = row.count;
            }

            return {
              success: true,
              data: {
                total,
                by_status: statusMap,
                by_category: categoryMap,
                by_severity: severityMap,
              },
            };
          }

          default:
            return {
              success: false,
              data: null,
              error: `Unknown action: ${action}. Valid actions: add_item, list_items, get_item, update_item, dismiss_item, next_item, stats`,
            };
        }
      } catch (err) {
        return {
          success: false,
          data: null,
          error: `manage_backlog error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
