import type { Tool, ToolResult } from "../tool-types.js";
import { runGws } from "../gws-executor.js";
import { config } from "../../config.js";

const gwsDriveTool: Tool = {
  definition: {
    name: "google_drive",
    description:
      "Interact with Google Drive. Can list files, read file metadata, search for files, and upload files.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "The action to perform: 'list', 'read', 'search', or 'upload'",
          enum: ["list", "read", "search", "upload"],
        },
        file_id: {
          type: "string",
          description: "The file ID to read (required for 'read' action)",
        },
        query: {
          type: "string",
          description:
            "Search query for 'search' action. Searches by file name.",
        },
        max_results: {
          type: "string",
          description: "Maximum number of results to return (default: 10)",
        },
        file_name: {
          type: "string",
          description: "Name for the uploaded file in Drive (required for 'upload' action)",
        },
        file_path: {
          type: "string",
          description: "Local file path to upload (required for 'upload' action)",
        },
        folder_id: {
          type: "string",
          description: "Folder ID to list/search within, or target folder for upload. Defaults to configured folders.",
        },
      },
      required: ["action"],
    },
  },

  async execute(args): Promise<ToolResult> {
    const action = args.action as string;
    const pageSize = (args.max_results as string) || "10";
    const folderIds = config.google.driveFolderIds;

    try {
      switch (action) {
        case "list": {
          const parts = ["trashed = false"];
          const listFolderId = args.folder_id as string;
          if (listFolderId) {
            parts.push(`'${listFolderId}' in parents`);
          } else if (folderIds.length > 0) {
            const folderFilters = folderIds.map((id) => `'${id}' in parents`);
            parts.push(`(${folderFilters.join(" or ")})`);
          }
          const data = await runGws([
            "drive", "files", "list",
            "--params", JSON.stringify({ pageSize: parseInt(pageSize, 10), q: parts.join(" and "), fields: "files(id,name,mimeType,modifiedTime,size)" }),
          ]);
          return { success: true, data };
        }

        case "read": {
          const fileId = args.file_id as string;
          if (!fileId) {
            return { success: false, data: null, error: "file_id is required for 'read' action" };
          }
          const data = await runGws([
            "drive", "files", "get",
            "--params", JSON.stringify({ fileId, fields: "id,name,mimeType,modifiedTime,size,description,webViewLink" }),
          ]);
          return { success: true, data };
        }

        case "search": {
          const query = args.query as string;
          if (!query) {
            return { success: false, data: null, error: "query is required for 'search' action" };
          }
          const parts = [`name contains '${query}'`, "trashed = false"];
          const searchFolderId = args.folder_id as string;
          if (searchFolderId) {
            parts.push(`'${searchFolderId}' in parents`);
          } else if (folderIds.length > 0) {
            const folderFilters = folderIds.map((id) => `'${id}' in parents`);
            parts.push(`(${folderFilters.join(" or ")})`);
          }
          const data = await runGws([
            "drive", "files", "list",
            "--params", JSON.stringify({ pageSize: parseInt(pageSize, 10), q: parts.join(" and "), fields: "files(id,name,mimeType,modifiedTime,size)" }),
          ]);
          return { success: true, data };
        }

        case "upload": {
          const filePath = args.file_path as string;
          const fileName = args.file_name as string;
          if (!filePath || !fileName) {
            return { success: false, data: null, error: "file_path and file_name are required for 'upload' action" };
          }
          const targetFolder = (args.folder_id as string) || (folderIds.length > 0 ? folderIds[0] : "");
          const metadata: Record<string, unknown> = { name: fileName };
          if (targetFolder) {
            metadata.parents = [targetFolder];
          }
          const data = await runGws([
            "drive", "files", "create",
            "--json", JSON.stringify(metadata),
            "--upload", filePath,
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

export default gwsDriveTool;
