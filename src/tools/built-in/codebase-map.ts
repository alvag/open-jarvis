import type Database from "better-sqlite3";
import type { Tool, ToolResult } from "../tool-types.js";

const VALID_ENTRY_TYPES = ["module", "flow", "dependency", "note"] as const;
const VALID_CONFIDENCE = ["high", "medium", "low"] as const;

export function createCodebaseMapTool(db: Database.Database): Tool {
  // Prepare statements once
  const upsertStmt = db.prepare(`
    INSERT INTO codebase_index (user_id, entry_type, key, summary, evidence, confidence, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, entry_type, key) DO UPDATE SET
      summary = excluded.summary,
      evidence = excluded.evidence,
      confidence = excluded.confidence,
      updated_at = datetime('now')
  `);

  const searchStmt = db.prepare(`
    SELECT ci.id, ci.entry_type, ci.key, ci.summary, ci.evidence, ci.confidence, ci.updated_at
    FROM codebase_fts fts
    JOIN codebase_index ci ON ci.id = fts.rowid
    WHERE codebase_fts MATCH ?
      AND ci.user_id = ?
    ORDER BY rank
    LIMIT 10
  `);

  const searchWithTypeStmt = db.prepare(`
    SELECT ci.id, ci.entry_type, ci.key, ci.summary, ci.evidence, ci.confidence, ci.updated_at
    FROM codebase_fts fts
    JOIN codebase_index ci ON ci.id = fts.rowid
    WHERE codebase_fts MATCH ?
      AND ci.user_id = ?
      AND ci.entry_type = ?
    ORDER BY rank
    LIMIT 10
  `);

  const listAllStmt = db.prepare(`
    SELECT id, entry_type, key, summary, evidence, confidence, updated_at
    FROM codebase_index
    WHERE user_id = ?
    ORDER BY entry_type, key
  `);

  const listByTypeStmt = db.prepare(`
    SELECT id, entry_type, key, summary, evidence, confidence, updated_at
    FROM codebase_index
    WHERE user_id = ? AND entry_type = ?
    ORDER BY key
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM codebase_index
    WHERE user_id = ? AND entry_type = ? AND key = ?
  `);

  return {
    definition: {
      name: "codebase_map",
      description:
        "Save or query persistent codebase knowledge. Use 'save' to record module summaries, execution flows, and dependency information discovered during code analysis. Use 'search' to recall previously analyzed knowledge. Use 'list' to see all indexed entries. Knowledge persists across sessions.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "Action to perform.",
            enum: ["save", "search", "list", "delete"],
          },
          entry_type: {
            type: "string",
            description:
              "Type of knowledge entry. Required for 'save' and 'delete'. Optional filter for 'search'/'list'.",
            enum: ["module", "flow", "dependency", "note"],
          },
          key: {
            type: "string",
            description:
              "Identifier for this entry. For modules: the file path. For flows: descriptive name. For dependencies: package name. Required for 'save' and 'delete'.",
          },
          summary: {
            type: "string",
            description:
              "Description of what this code does, how a flow works, or what a dependency provides. Required for 'save'.",
          },
          evidence: {
            type: "string",
            description:
              'JSON array of file:line references that support this summary. E.g. \'["src/agent/agent.ts:77", "src/tools/tool-registry.ts:17"]\'. Required for \'save\'.',
          },
          confidence: {
            type: "string",
            description:
              "Confidence level. 'high' = directly observed, 'medium' = inferred from patterns, 'low' = educated guess.",
            enum: ["high", "medium", "low"],
          },
          query: {
            type: "string",
            description:
              "Search query for 'search' action. Uses full-text search across keys and summaries.",
          },
        },
        required: ["action"],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      const action = args.action as string;

      switch (action) {
        case "save": {
          const entryType = args.entry_type as string;
          const key = args.key as string;
          const summary = args.summary as string;
          const evidence = args.evidence as string;
          const confidence = (args.confidence as string) || "high";

          if (!entryType || !key || !summary) {
            return {
              success: false,
              data: null,
              error: "entry_type, key, and summary are required for 'save'.",
            };
          }
          if (!VALID_ENTRY_TYPES.includes(entryType as typeof VALID_ENTRY_TYPES[number])) {
            return {
              success: false,
              data: null,
              error: `Invalid entry_type "${entryType}". Must be one of: ${VALID_ENTRY_TYPES.join(", ")}`,
            };
          }
          if (!VALID_CONFIDENCE.includes(confidence as typeof VALID_CONFIDENCE[number])) {
            return {
              success: false,
              data: null,
              error: `Invalid confidence "${confidence}". Must be one of: ${VALID_CONFIDENCE.join(", ")}`,
            };
          }

          // Validate evidence is a JSON array of strings
          let evidenceParsed: string[] = [];
          if (evidence) {
            try {
              evidenceParsed = JSON.parse(evidence);
              if (!Array.isArray(evidenceParsed) || !evidenceParsed.every(e => typeof e === "string")) {
                return {
                  success: false,
                  data: null,
                  error: "evidence must be a JSON array of strings.",
                };
              }
            } catch {
              return {
                success: false,
                data: null,
                error: "evidence must be valid JSON. Expected array of strings.",
              };
            }
          }

          upsertStmt.run(
            context.userId,
            entryType,
            key,
            summary,
            JSON.stringify(evidenceParsed),
            confidence,
          );

          return {
            success: true,
            data: {
              saved: true,
              entry_type: entryType,
              key,
              summary: summary.length > 100 ? summary.slice(0, 100) + "..." : summary,
              confidence,
              evidence_count: evidenceParsed.length,
            },
          };
        }

        case "search": {
          const query = args.query as string;
          if (!query) {
            return {
              success: false,
              data: null,
              error: "query is required for 'search'.",
            };
          }

          // Sanitize FTS5 query: remove special chars, add prefix wildcards
          const sanitized = query
            .replace(/[^a-zA-Z0-9_./\-\s]/g, "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(t => `"${t}"*`)
            .join(" ");

          if (!sanitized) {
            return {
              success: true,
              data: { count: 0, results: [] },
            };
          }

          const entryType = args.entry_type as string | undefined;
          let rows;
          try {
            rows = entryType
              ? searchWithTypeStmt.all(sanitized, context.userId, entryType) as Record<string, unknown>[]
              : searchStmt.all(sanitized, context.userId) as Record<string, unknown>[];
          } catch {
            // FTS query failed — fallback to LIKE
            const likeQuery = `%${query}%`;
            const fallbackSql = entryType
              ? `SELECT * FROM codebase_index WHERE user_id = ? AND entry_type = ? AND (key LIKE ? OR summary LIKE ?) ORDER BY updated_at DESC LIMIT 10`
              : `SELECT * FROM codebase_index WHERE user_id = ? AND (key LIKE ? OR summary LIKE ?) ORDER BY updated_at DESC LIMIT 10`;
            rows = entryType
              ? db.prepare(fallbackSql).all(context.userId, entryType, likeQuery, likeQuery) as Record<string, unknown>[]
              : db.prepare(fallbackSql).all(context.userId, likeQuery, likeQuery) as Record<string, unknown>[];
          }

          return {
            success: true,
            data: {
              count: rows.length,
              results: rows.map((r) => ({
                entry_type: r.entry_type,
                key: r.key,
                summary: r.summary,
                confidence: r.confidence,
                evidence: JSON.parse(r.evidence as string),
                updated_at: r.updated_at,
              })),
            },
          };
        }

        case "list": {
          const entryType = args.entry_type as string | undefined;
          const rows = entryType
            ? listByTypeStmt.all(context.userId, entryType) as Record<string, unknown>[]
            : listAllStmt.all(context.userId) as Record<string, unknown>[];

          // Group by type
          const grouped: Record<string, Record<string, unknown>[]> = {};
          for (const row of rows) {
            const type = row.entry_type as string;
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push({
              key: row.key,
              summary: row.summary,
              confidence: row.confidence,
              updated_at: row.updated_at,
            });
          }

          return {
            success: true,
            data: {
              total: rows.length,
              by_type: grouped,
            },
          };
        }

        case "delete": {
          const entryType = args.entry_type as string;
          const key = args.key as string;
          if (!entryType || !key) {
            return {
              success: false,
              data: null,
              error: "entry_type and key are required for 'delete'.",
            };
          }

          const result = deleteStmt.run(context.userId, entryType, key);
          return {
            success: true,
            data: {
              deleted: result.changes > 0,
              entry_type: entryType,
              key,
            },
          };
        }

        default:
          return {
            success: false,
            data: null,
            error: `Unknown action "${action}". Must be one of: save, search, list, delete.`,
          };
      }
    },
  };
}
