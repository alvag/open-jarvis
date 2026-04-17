import type Database from "better-sqlite3";
import type { Tool, ToolResult } from "../tool-types.js";
import type { MemoryManager } from "../../memory/memory-manager.js";

const MIN_QUERY_LENGTH = 2;
const DEFAULT_MEMORY_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 5;
const DEFAULT_ITEMS_PER_LIST = 3;

interface ListItemRow {
  list_name: string;
  text: string;
  status: "pending" | "completed" | "discarded";
  position: number;
}

interface MatchedList {
  list_name: string;
  items: Array<{ text: string; status: string; matches: number }>;
  total_matches: number;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function extractTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_QUERY_LENGTH);
}

function countTermMatches(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const term of terms) {
    if (lower.includes(term)) count++;
  }
  return count;
}

function statusGlyph(status: string): string {
  if (status === "completed") return "\u2705";
  if (status === "discarded") return "\u{1F6AB}";
  return "\u2B1A";
}

function renderFormatted(
  query: string,
  memories: Array<{ key: string; content: string; category: string }>,
  lists: MatchedList[],
): string {
  const sections: string[] = [];
  sections.push(`\u{1F50D} "${query}"`);

  if (memories.length > 0) {
    const lines = [`\u{1F4DD} Memorias (${memories.length})`];
    for (const m of memories) {
      lines.push(`\u2022 ${m.key} \u2014 ${m.content}`);
    }
    sections.push(lines.join("\n"));
  }

  if (lists.length > 0) {
    const totalItems = lists.reduce((sum, l) => sum + l.items.length, 0);
    const lines = [`\u{1F4CB} Listas (${lists.length} \u2014 ${totalItems} items)`];
    for (const l of lists) {
      lines.push(`\u2022 ${l.list_name}`);
      for (const item of l.items) {
        lines.push(`  ${statusGlyph(item.status)} ${item.text}`);
      }
      if (l.total_matches > l.items.length) {
        const extra = l.total_matches - l.items.length;
        lines.push(`  \u2026 y ${extra} mas`);
      }
    }
    sections.push(lines.join("\n"));
  }

  if (memories.length === 0 && lists.length === 0) {
    return `No encontre coincidencias para "${query}"`;
  }

  return sections.join("\n\n");
}

// Safety cap for the number of candidate rows pulled from SQLite before
// ranking/grouping happens in Node. Chosen to be far above realistic personal
// datasets while still protecting against runaway queries.
const ROW_SAFETY_CAP = 2000;

export function createSearchPersonalKnowledgeTool(
  memoryManager: MemoryManager,
  db: Database.Database,
): Tool {
  return {
    definition: {
      name: "search_personal_knowledge",
      description:
        "Unified search across the user's saved memories AND personal lists (and notes saved as memories). Use this when the user asks free-form questions like 'busca X', 'qué tengo sobre X', 'qué recuerdas de X', '¿X en mis listas?'. If the user mentions a specific list by name (e.g. 'busca leche en compras'), pass list_hint='compras' to scope the list search. Returns grouped results plus a pre-formatted Telegram-ready text in the 'formatted' field that you can relay directly to the user.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-form search term(s). Case-insensitive substring match.",
          },
          list_hint: {
            type: "string",
            description:
              "Optional — restrict the list search to this list name (exact name, case-insensitive). Omit for a global search across all lists.",
          },
          memory_limit: {
            type: "string",
            description: "Max memories to return (default: 5)",
          },
          list_limit: {
            type: "string",
            description: "Max lists to include in results (default: 5)",
          },
          items_per_list: {
            type: "string",
            description: "Max items shown per list (default: 3)",
          },
        },
        required: ["query"],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      const rawQuery = (args.query as string | undefined)?.trim() ?? "";
      if (rawQuery.length < MIN_QUERY_LENGTH) {
        return {
          success: false,
          data: null,
          error: `query must be at least ${MIN_QUERY_LENGTH} characters`,
        };
      }

      const listHint = (args.list_hint as string | undefined)?.trim();
      const memoryLimit = parseInt((args.memory_limit as string) || String(DEFAULT_MEMORY_LIMIT), 10);
      const listLimit = parseInt((args.list_limit as string) || String(DEFAULT_LIST_LIMIT), 10);
      const itemsPerList = parseInt((args.items_per_list as string) || String(DEFAULT_ITEMS_PER_LIST), 10);

      const terms = extractTerms(rawQuery);
      const effectiveTerms = terms.length > 0 ? terms : [rawQuery.toLowerCase()];

      const memories = memoryManager
        .searchMemories(context.userId, rawQuery, memoryLimit)
        .map((m) => ({ key: m.key, content: m.content, category: m.category }));

      // Build a dynamic WHERE with one LIKE clause per term (OR'd).
      // Matching on individual terms lets free-form queries like
      // "qué tengo sobre Arely" surface items containing any term
      // ("Arely"). The final ranking by countTermMatches still pushes
      // multi-term matches to the top. Using the raw full query as a
      // single LIKE would require the exact phrase to appear verbatim,
      // which breaks the advertised free-form search.
      const likeClauses = effectiveTerms.map(() => "LOWER(li.text) LIKE ? ESCAPE '\\'").join(" OR ");
      const likeParams = effectiveTerms.map((t) => `%${escapeLikePattern(t)}%`);
      const baseSql = `SELECT l.name AS list_name, li.text, li.status, li.position
         FROM list_items li
         JOIN lists l ON l.id = li.list_id
         WHERE l.user_id = ?
           AND li.status != 'discarded'
           ${listHint ? "AND LOWER(l.name) = LOWER(?)" : ""}
           AND (${likeClauses})
         ORDER BY l.name, li.position
         LIMIT ?`;
      const params = listHint
        ? [context.userId, listHint, ...likeParams, ROW_SAFETY_CAP]
        : [context.userId, ...likeParams, ROW_SAFETY_CAP];
      const rows = db.prepare(baseSql).all(...params) as ListItemRow[];

      const byList = new Map<string, MatchedList>();
      for (const row of rows) {
        const matches = countTermMatches(row.text, effectiveTerms);
        if (matches === 0) continue;
        const bucket = byList.get(row.list_name) ?? {
          list_name: row.list_name,
          items: [],
          total_matches: 0,
        };
        bucket.items.push({ text: row.text, status: row.status, matches });
        bucket.total_matches += 1;
        byList.set(row.list_name, bucket);
      }

      const matchedLists = Array.from(byList.values())
        .map((l) => {
          const sortedItems = [...l.items].sort((a, b) => b.matches - a.matches);
          return {
            list_name: l.list_name,
            items: sortedItems.slice(0, itemsPerList).map((i) => ({ text: i.text, status: i.status, matches: i.matches })),
            total_matches: l.total_matches,
          };
        })
        .sort((a, b) => b.total_matches - a.total_matches)
        .slice(0, listLimit);

      const totalListItems = matchedLists.reduce((sum, l) => sum + l.items.length, 0);
      const formatted = renderFormatted(rawQuery, memories, matchedLists);

      return {
        success: true,
        data: {
          query: rawQuery,
          matched_memories: memories,
          matched_lists: matchedLists.map((l) => ({
            list_name: l.list_name,
            items: l.items.map(({ text, status }) => ({ text, status })),
            total_matches: l.total_matches,
          })),
          total_counts: {
            memories: memories.length,
            lists: matchedLists.length,
            items: totalListItems,
          },
          formatted,
        },
      };
    },
  };
}
