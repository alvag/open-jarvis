import type Database from "better-sqlite3";
import type { Tool, ToolResult } from "../tool-types.js";

interface ReviewLogRow {
  id: number;
  file_path: string;
  last_reviewed_at: string;
  last_file_hash: string | null;
  last_modified_at: string | null;
  findings_count: number;
  skills_run: string;
  created_at: string;
  updated_at: string;
}

export function createManageCodeReviewLogTool(db: Database.Database): Tool {
  const stmts = {
    upsert: db.prepare(`
      INSERT INTO code_review_log (file_path, last_file_hash, findings_count, skills_run)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        last_reviewed_at = datetime('now'),
        last_file_hash = excluded.last_file_hash,
        findings_count = excluded.findings_count,
        skills_run = excluded.skills_run,
        updated_at = datetime('now')
    `),
    getFile: db.prepare(
      `SELECT * FROM code_review_log WHERE file_path = ?`,
    ),
    listReviewed: db.prepare(
      `SELECT * FROM code_review_log ORDER BY last_reviewed_at ASC`,
    ),
    allPaths: db.prepare(
      `SELECT file_path FROM code_review_log`,
    ),
    lastReviewTime: db.prepare(
      `SELECT MAX(last_reviewed_at) as ts FROM code_review_log`,
    ),
    totalStats: db.prepare(`
      SELECT
        COUNT(*) as total_files,
        SUM(findings_count) as total_findings,
        ROUND(julianday('now') - julianday(MIN(last_reviewed_at)), 1) as oldest_review_days,
        ROUND(julianday('now') - julianday(MAX(last_reviewed_at)), 1) as newest_review_days
      FROM code_review_log
    `),
  };

  function formatRow(row: ReviewLogRow) {
    return {
      id: row.id,
      file_path: row.file_path,
      last_reviewed_at: row.last_reviewed_at,
      last_file_hash: row.last_file_hash,
      last_modified_at: row.last_modified_at,
      findings_count: row.findings_count,
      skills_run: JSON.parse(row.skills_run),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  return {
    definition: {
      name: "manage_code_review_log",
      description:
        "Track which files have been reviewed by proactive code review. " +
        "Supports upsert (insert/update review entry), get_file (check review state), " +
        "list_reviewed (all reviewed files sorted oldest first), and stats (summary).",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The operation to perform",
            enum: ["upsert", "get_file", "list_reviewed", "stats"],
          },
          file_path: {
            type: "string",
            description: "Path of the file. Required for upsert and get_file.",
          },
          last_file_hash: {
            type: "string",
            description: "SHA256 hash of the file content at review time (for upsert).",
          },
          findings_count: {
            type: "number",
            description: "Number of findings from this review (for upsert). Default: 0.",
          },
          skills_run: {
            type: "string",
            description: 'JSON array of skill names run during this review (for upsert). Example: \'["detect_bugs","find_refactor_candidates"]\'.',
          },
        },
        required: ["action"],
      },
    },

    async execute(args): Promise<ToolResult> {
      try {
        const action = args.action as string;

        switch (action) {
          case "upsert": {
            const filePath = args.file_path as string | undefined;
            if (!filePath) {
              return { success: false, data: null, error: "file_path is required for upsert" };
            }

            const fileHash = (args.last_file_hash as string | undefined) ?? null;
            const findingsCount = (args.findings_count as number | undefined) ?? 0;
            const skillsRun = (args.skills_run as string | undefined) ?? "[]";

            stmts.upsert.run(filePath, fileHash, findingsCount, skillsRun);

            const updated = stmts.getFile.get(filePath) as ReviewLogRow;
            return {
              success: true,
              data: { entry: formatRow(updated) },
            };
          }

          case "get_file": {
            const filePath = args.file_path as string | undefined;
            if (!filePath) {
              return { success: false, data: null, error: "file_path is required for get_file" };
            }

            const row = stmts.getFile.get(filePath) as ReviewLogRow | undefined;
            if (!row) {
              return {
                success: true,
                data: { entry: null, message: `File "${filePath}" has never been reviewed` },
              };
            }

            return { success: true, data: { entry: formatRow(row) } };
          }

          case "list_reviewed": {
            const rows = stmts.listReviewed.all() as ReviewLogRow[];
            return {
              success: true,
              data: {
                count: rows.length,
                entries: rows.map(formatRow),
              },
            };
          }

          case "stats": {
            const stats = stmts.totalStats.get() as {
              total_files: number;
              total_findings: number;
              oldest_review_days: number | null;
              newest_review_days: number | null;
            };

            return {
              success: true,
              data: {
                total_files_reviewed: stats.total_files,
                total_findings: stats.total_findings ?? 0,
                oldest_review_days_ago: stats.oldest_review_days,
                newest_review_days_ago: stats.newest_review_days,
              },
            };
          }

          default:
            return {
              success: false,
              data: null,
              error: `Unknown action: ${action}. Valid actions: upsert, get_file, list_reviewed, stats`,
            };
        }
      } catch (err) {
        return {
          success: false,
          data: null,
          error: `manage_code_review_log error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
