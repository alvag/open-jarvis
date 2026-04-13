import type { Tool, ToolResult } from "../tool-types.js";
import { runGws } from "../gws-executor.js";

export function createGwsSheetsTool(): Tool {
  return {
    definition: {
    name: "google_sheets",
    description:
      "Interact with Google Sheets. Can read cell values, write/update cells, append rows, and create new spreadsheets.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The action to perform: 'read', 'write', 'append', 'create', or 'info'",
          enum: ["read", "write", "append", "create", "info"],
        },
        spreadsheet_id: {
          type: "string",
          description: "The spreadsheet ID (required for all actions except 'create')",
        },
        range: {
          type: "string",
          description: "Cell range in A1 notation, e.g. 'Sheet1!A1:D10' (required for 'read', 'write', 'append')",
        },
        values: {
          type: "string",
          description:
            "JSON array of arrays with cell values, e.g. '[[\"Name\",\"Age\"],[\"Max\",30]]' (required for 'write' and 'append')",
        },
        title: {
          type: "string",
          description: "Spreadsheet title (required for 'create' action)",
        },
      },
      required: ["action"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const action = args.action as string;
    const spreadsheetId = args.spreadsheet_id as string;

    try {
      switch (action) {
        case "info": {
          if (!spreadsheetId) {
            return { success: false, data: null, error: "spreadsheet_id is required for 'info' action" };
          }
          const data = await runGws([
            "sheets", "spreadsheets", "get",
            "--params", JSON.stringify({ spreadsheetId, fields: "spreadsheetId,properties.title,sheets.properties" }),
          ]);
          return { success: true, data };
        }

        case "read": {
          if (!spreadsheetId) {
            return { success: false, data: null, error: "spreadsheet_id is required for 'read' action" };
          }
          const range = args.range as string;
          if (!range) {
            return { success: false, data: null, error: "range is required for 'read' action" };
          }
          const data = await runGws([
            "sheets", "spreadsheets", "values", "get",
            "--params", JSON.stringify({ spreadsheetId, range }),
          ]);
          return { success: true, data };
        }

        case "write": {
          if (!spreadsheetId) {
            return { success: false, data: null, error: "spreadsheet_id is required for 'write' action" };
          }
          const range = args.range as string;
          const valuesStr = args.values as string;
          if (!range || !valuesStr) {
            return { success: false, data: null, error: "range and values are required for 'write' action" };
          }
          let values: unknown[][];
          try {
            values = JSON.parse(valuesStr);
          } catch {
            return { success: false, data: null, error: "values must be a valid JSON array of arrays" };
          }
          const data = await runGws([
            "sheets", "spreadsheets", "values", "update",
            "--params", JSON.stringify({ spreadsheetId, range, valueInputOption: "USER_ENTERED" }),
            "--json", JSON.stringify({ range, values }),
          ]);
          return { success: true, data };
        }

        case "append": {
          if (!spreadsheetId) {
            return { success: false, data: null, error: "spreadsheet_id is required for 'append' action" };
          }
          const range = args.range as string;
          const valuesStr = args.values as string;
          if (!range || !valuesStr) {
            return { success: false, data: null, error: "range and values are required for 'append' action" };
          }
          let values: unknown[][];
          try {
            values = JSON.parse(valuesStr);
          } catch {
            return { success: false, data: null, error: "values must be a valid JSON array of arrays" };
          }
          const data = await runGws([
            "sheets", "spreadsheets", "values", "append",
            "--params", JSON.stringify({ spreadsheetId, range, valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" }),
            "--json", JSON.stringify({ range, values }),
          ]);
          return { success: true, data };
        }

        case "create": {
          const title = args.title as string;
          if (!title) {
            return { success: false, data: null, error: "title is required for 'create' action" };
          }
          const data = await runGws([
            "sheets", "spreadsheets", "create",
            "--json", JSON.stringify({ properties: { title } }),
          ]);
          return { success: true, data };
        }

        default:
          return { success: false, data: null, error: `Unknown action: ${action}` };
      }
    } catch (err) {
      return { success: false, data: null, error: (err as Error).message };
    }
  },
  };
}
