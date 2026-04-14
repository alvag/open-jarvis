import type Database from "better-sqlite3";
import type { Tool, ToolResult } from "../tool-types.js";

interface ListRow {
  id: number;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ListItemRow {
  id: number;
  list_id: number;
  text: string;
  status: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface ListSummaryRow {
  id: number;
  name: string;
  updated_at: string;
  total_items: number;
  pending: number;
  completed: number;
  discarded: number;
}

type ItemStatus = "pending" | "completed" | "discarded";

export function createManageListsTool(db: Database.Database): Tool {
  const stmts = {
    createList: db.prepare(
      `INSERT OR IGNORE INTO lists (user_id, name) VALUES (?, ?)`,
    ),
    getList: db.prepare(
      `SELECT * FROM lists WHERE user_id = ? AND name = ?`,
    ),
    getAllLists: db.prepare(`
      SELECT l.id, l.name, l.updated_at,
        COUNT(li.id) as total_items,
        COUNT(li.id) FILTER (WHERE li.status = 'pending') as pending,
        COUNT(li.id) FILTER (WHERE li.status = 'completed') as completed,
        COUNT(li.id) FILTER (WHERE li.status = 'discarded') as discarded
      FROM lists l
      LEFT JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = ?
      GROUP BY l.id
      ORDER BY l.updated_at DESC
    `),
    deleteList: db.prepare(
      `DELETE FROM lists WHERE user_id = ? AND name = ?`,
    ),
    addItem: db.prepare(
      `INSERT INTO list_items (list_id, text, position) VALUES (?, ?, ?)`,
    ),
    getItems: db.prepare(
      `SELECT * FROM list_items WHERE list_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'completed' THEN 1 WHEN 'discarded' THEN 2 END, position ASC`,
    ),
    getItemsByStatus: db.prepare(
      `SELECT * FROM list_items WHERE list_id = ? AND status = ? ORDER BY position ASC`,
    ),
    countByStatus: db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'discarded') as discarded
      FROM list_items WHERE list_id = ?
    `),
    findItemExact: db.prepare(
      `SELECT * FROM list_items WHERE list_id = ? AND LOWER(text) = LOWER(?)`,
    ),
    findItemFuzzy: db.prepare(
      `SELECT * FROM list_items WHERE list_id = ? AND LOWER(text) LIKE '%' || LOWER(?) || '%'`,
    ),
    findDuplicate: db.prepare(
      `SELECT * FROM list_items WHERE list_id = ? AND LOWER(text) = LOWER(?) LIMIT 1`,
    ),
    findSimilar: db.prepare(
      `SELECT * FROM list_items WHERE list_id = ? AND LOWER(text) LIKE '%' || LOWER(?) || '%'`,
    ),
    removeItem: db.prepare(`DELETE FROM list_items WHERE id = ?`),
    setStatus: db.prepare(
      `UPDATE list_items SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    ),
    maxPosition: db.prepare(
      `SELECT COALESCE(MAX(position), 0) as max_pos FROM list_items WHERE list_id = ?`,
    ),
    touchList: db.prepare(
      `UPDATE lists SET updated_at = datetime('now') WHERE id = ?`,
    ),
  };

  function normalizeName(name: string): string {
    return name.toLowerCase().trim();
  }

  function getOrCreateList(
    userId: string,
    name: string,
  ): { list: ListRow; created: boolean } {
    const normalized = normalizeName(name);
    const existing = stmts.getList.get(userId, normalized) as
      | ListRow
      | undefined;
    if (existing) return { list: existing, created: false };

    stmts.createList.run(userId, normalized);
    const list = stmts.getList.get(userId, normalized) as ListRow;
    return { list, created: true };
  }

  // Returns a single unambiguous match, or an error-ready result
  function findItem(
    listId: number,
    text: string,
  ): { item: ListItemRow | null; ambiguous: boolean; candidates: ListItemRow[] } {
    // Try exact match first (case-insensitive)
    const exact = stmts.findItemExact.all(listId, text) as ListItemRow[];
    if (exact.length === 1) {
      return { item: exact[0], ambiguous: false, candidates: [] };
    }
    if (exact.length > 1) {
      return { item: null, ambiguous: true, candidates: exact };
    }

    // Fall back to fuzzy match
    const fuzzy = stmts.findItemFuzzy.all(listId, text) as ListItemRow[];
    if (fuzzy.length === 1) {
      return { item: fuzzy[0], ambiguous: false, candidates: [] };
    }
    if (fuzzy.length > 1) {
      return { item: null, ambiguous: true, candidates: fuzzy };
    }

    return { item: null, ambiguous: false, candidates: [] };
  }

  function formatSummary(counts: { total: number; pending: number; completed: number; discarded: number }): string {
    const parts = [`${counts.pending} pending`];
    if (counts.completed > 0) parts.push(`${counts.completed} completed`);
    if (counts.discarded > 0) parts.push(`${counts.discarded} discarded`);
    return `${counts.total} items (${parts.join(", ")})`;
  }

  function formatItemStatus(item: ListItemRow): string {
    return item.status as string;
  }

  return {
    definition: {
      name: "manage_lists",
      description:
        "Manage personal lists (shopping, books, ideas, todos, etc.). " +
        "Can create/delete lists, add/remove/complete/discard items, and view list contents. " +
        "List names are flexible — the user might say 'lista del super', 'compras', 'libros pendientes', etc. " +
        "The add_item action auto-creates the list if it doesn't exist. " +
        "Items have 3 states: pending, completed, discarded. Use discard_item to mark an item as discarded without deleting it. " +
        "Duplicate detection: add_item checks for existing items (including discarded ones) before adding.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "The operation to perform",
            enum: [
              "create_list",
              "delete_list",
              "get_lists",
              "view_list",
              "add_item",
              "remove_item",
              "toggle_item",
              "discard_item",
            ],
          },
          list_name: {
            type: "string",
            description:
              "Name of the list (e.g. 'compras del super', 'libros pendientes', 'ideas para jarvis'). " +
              "Required for all actions except 'get_lists'.",
          },
          item_text: {
            type: "string",
            description:
              "Text of the item to add, remove, toggle, or discard. " +
              "For remove_item, toggle_item, and discard_item: partial match (case-insensitive) is used. " +
              "If multiple items match, the tool returns the candidates so you can ask the user to clarify.",
          },
          show_completed: {
            type: "string",
            description:
              "For view_list: 'true' to include completed items (default), 'false' for pending only.",
            enum: ["true", "false"],
          },
        },
        required: ["action"],
      },
    },

    async execute(args, context): Promise<ToolResult> {
      const action = args.action as string;
      const listName = args.list_name as string | undefined;
      const itemText = args.item_text as string | undefined;
      const showCompleted = (args.show_completed as string) !== "false";

      switch (action) {
        case "get_lists": {
          const lists = stmts.getAllLists.all(
            context.userId,
          ) as ListSummaryRow[];
          return {
            success: true,
            data: {
              count: lists.length,
              lists: lists.map((l) => ({
                name: l.name,
                total_items: l.total_items,
                pending: l.pending,
                completed: l.completed,
                discarded: l.discarded,
                updated_at: l.updated_at,
              })),
            },
          };
        }

        case "create_list": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for create_list",
            };
          }
          const { list, created } = getOrCreateList(context.userId, listName);
          return {
            success: true,
            data: {
              list_name: list.name,
              created,
              message: created
                ? `List "${list.name}" created`
                : `List "${list.name}" already exists`,
            },
          };
        }

        case "view_list": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for view_list",
            };
          }
          const list = stmts.getList.get(
            context.userId,
            normalizeName(listName),
          ) as ListRow | undefined;
          if (!list) {
            return {
              success: false,
              data: null,
              error: `List "${listName}" not found`,
            };
          }

          // Always get full counts for the summary
          const counts = stmts.countByStatus.get(list.id) as {
            total: number;
            pending: number;
            completed: number;
            discarded: number;
          };

          // Get filtered or full item list for display
          const items = (
            showCompleted
              ? stmts.getItems.all(list.id)
              : stmts.getItemsByStatus.all(list.id, "pending")
          ) as ListItemRow[];

          return {
            success: true,
            data: {
              list_name: list.name,
              items: items.map((i) => ({
                id: i.id,
                text: i.text,
                status: formatItemStatus(i),
              })),
              summary: formatSummary(counts),
              showing: showCompleted ? "all" : "pending only",
            },
          };
        }

        case "add_item": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for add_item",
            };
          }
          if (!itemText) {
            return {
              success: false,
              data: null,
              error: "item_text is required for add_item",
            };
          }

          const { list, created } = getOrCreateList(context.userId, listName);

          // Check for exact duplicate
          const duplicate = stmts.findDuplicate.get(list.id, itemText) as
            | ListItemRow
            | undefined;
          if (duplicate) {
            return {
              success: false,
              data: {
                existing_item: {
                  id: duplicate.id,
                  text: duplicate.text,
                  status: duplicate.status,
                },
                list_name: list.name,
              },
              error:
                duplicate.status === "discarded"
                  ? `"${duplicate.text}" already exists in "${list.name}" but was discarded. Use toggle_item to restore it to pending.`
                  : `"${duplicate.text}" already exists in "${list.name}" (status: ${duplicate.status}).`,
            };
          }

          // Check for similar items
          const similar = stmts.findSimilar.all(list.id, itemText) as ListItemRow[];
          const maxPos = stmts.maxPosition.get(list.id) as {
            max_pos: number;
          };
          stmts.addItem.run(list.id, itemText, maxPos.max_pos + 1);
          stmts.touchList.run(list.id);

          const counts = stmts.countByStatus.get(list.id) as {
            total: number;
            pending: number;
            completed: number;
            discarded: number;
          };

          const result: Record<string, unknown> = {
            list_name: list.name,
            added: itemText,
            list_created: created,
            total_items: counts.total,
          };

          if (similar.length > 0) {
            result.similar_existing = similar.map((s) => ({
              text: s.text,
              status: s.status,
            }));
            result.note =
              "Similar items already exist in this list. The new item was added, but review the similar items above.";
          }

          return { success: true, data: result };
        }

        case "remove_item": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for remove_item",
            };
          }
          if (!itemText) {
            return {
              success: false,
              data: null,
              error: "item_text is required for remove_item",
            };
          }

          const list = stmts.getList.get(
            context.userId,
            normalizeName(listName),
          ) as ListRow | undefined;
          if (!list) {
            return {
              success: false,
              data: null,
              error: `List "${listName}" not found`,
            };
          }

          const { item, ambiguous, candidates } = findItem(list.id, itemText);

          if (ambiguous) {
            return {
              success: false,
              data: {
                candidates: candidates.map((c) => ({
                  id: c.id,
                  text: c.text,
                  status: c.status,
                })),
              },
              error: `Multiple items match "${itemText}". Ask the user which one they mean: ${candidates.map((c) => `"${c.text}"`).join(", ")}`,
            };
          }

          if (!item) {
            const allItems = stmts.getItems.all(list.id) as ListItemRow[];
            return {
              success: false,
              data: {
                current_items: allItems.map((i) => i.text),
              },
              error: `No item matching "${itemText}" found in "${list.name}"`,
            };
          }

          stmts.removeItem.run(item.id);
          stmts.touchList.run(list.id);

          return {
            success: true,
            data: {
              list_name: list.name,
              removed: item.text,
            },
          };
        }

        case "toggle_item": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for toggle_item",
            };
          }
          if (!itemText) {
            return {
              success: false,
              data: null,
              error: "item_text is required for toggle_item",
            };
          }

          const list = stmts.getList.get(
            context.userId,
            normalizeName(listName),
          ) as ListRow | undefined;
          if (!list) {
            return {
              success: false,
              data: null,
              error: `List "${listName}" not found`,
            };
          }

          const { item, ambiguous, candidates } = findItem(list.id, itemText);

          if (ambiguous) {
            return {
              success: false,
              data: {
                candidates: candidates.map((c) => ({
                  id: c.id,
                  text: c.text,
                  status: c.status,
                })),
              },
              error: `Multiple items match "${itemText}". Ask the user which one they mean: ${candidates.map((c) => `"${c.text}"`).join(", ")}`,
            };
          }

          if (!item) {
            const allItems = stmts.getItems.all(list.id) as ListItemRow[];
            return {
              success: false,
              data: {
                current_items: allItems.map((i) => ({
                  text: i.text,
                  status: i.status,
                })),
              },
              error: `No item matching "${itemText}" found in "${list.name}"`,
            };
          }

          // Toggle: pending ↔ completed, discarded → pending
          let newStatus: ItemStatus;
          if (item.status === "pending") {
            newStatus = "completed";
          } else if (item.status === "completed") {
            newStatus = "pending";
          } else {
            // discarded → pending (restore)
            newStatus = "pending";
          }

          stmts.setStatus.run(newStatus, item.id);
          stmts.touchList.run(list.id);

          return {
            success: true,
            data: {
              list_name: list.name,
              item: item.text,
              previous_status: item.status,
              new_status: newStatus,
            },
          };
        }

        case "discard_item": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for discard_item",
            };
          }
          if (!itemText) {
            return {
              success: false,
              data: null,
              error: "item_text is required for discard_item",
            };
          }

          const list = stmts.getList.get(
            context.userId,
            normalizeName(listName),
          ) as ListRow | undefined;
          if (!list) {
            return {
              success: false,
              data: null,
              error: `List "${listName}" not found`,
            };
          }

          const { item, ambiguous, candidates } = findItem(list.id, itemText);

          if (ambiguous) {
            return {
              success: false,
              data: {
                candidates: candidates.map((c) => ({
                  id: c.id,
                  text: c.text,
                  status: c.status,
                })),
              },
              error: `Multiple items match "${itemText}". Ask the user which one they mean: ${candidates.map((c) => `"${c.text}"`).join(", ")}`,
            };
          }

          if (!item) {
            const allItems = stmts.getItems.all(list.id) as ListItemRow[];
            return {
              success: false,
              data: {
                current_items: allItems.map((i) => ({
                  text: i.text,
                  status: i.status,
                })),
              },
              error: `No item matching "${itemText}" found in "${list.name}"`,
            };
          }

          if (item.status === "discarded") {
            return {
              success: false,
              data: { item: item.text, status: item.status },
              error: `"${item.text}" is already discarded. Use toggle_item to restore it.`,
            };
          }

          stmts.setStatus.run("discarded", item.id);
          stmts.touchList.run(list.id);

          return {
            success: true,
            data: {
              list_name: list.name,
              item: item.text,
              previous_status: item.status,
              new_status: "discarded",
              note: "Item discarded (not deleted). Use toggle_item to restore it to pending.",
            },
          };
        }

        case "delete_list": {
          if (!listName) {
            return {
              success: false,
              data: null,
              error: "list_name is required for delete_list",
            };
          }

          const list = stmts.getList.get(
            context.userId,
            normalizeName(listName),
          ) as ListRow | undefined;
          if (!list) {
            return {
              success: false,
              data: null,
              error: `List "${listName}" not found`,
            };
          }

          const itemCount = (stmts.getItems.all(list.id) as ListItemRow[])
            .length;
          stmts.deleteList.run(context.userId, normalizeName(listName));

          return {
            success: true,
            data: {
              list_name: list.name,
              items_deleted: itemCount,
              message: `List "${list.name}" and ${itemCount} item(s) deleted`,
            },
          };
        }

        default:
          return {
            success: false,
            data: null,
            error: `Unknown action: ${action}. Valid actions: get_lists, create_list, view_list, add_item, remove_item, toggle_item, discard_item, delete_list`,
          };
      }
    },
  };
}
