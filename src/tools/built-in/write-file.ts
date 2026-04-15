import { writeFileSync, mkdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";
import type { CodebaseConfig } from "./read-file.js";

const MAX_WRITE_SIZE = 512 * 1024; // 512 KB

export function createWriteFileTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "write_file",
      description:
        "Write content to a file within the codebase. Creates the file if it doesn't exist, overwrites if it does. Intermediate directories are created automatically. Blocked for sensitive files (.env, keys), paths outside the codebase root, and ignored directories (node_modules, .git, etc.).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path relative to codebase root, or absolute within the codebase. E.g. 'src/utils/helper.ts' or 'README.md'.",
          },
          content: {
            type: "string",
            description:
              "The full content to write to the file. Replaces entire file content if the file already exists.",
          },
        },
        required: ["path", "content"],
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const filePath = args.path as string;
      const content = args.content as string;

      if (!filePath) {
        return { success: false, data: null, error: "path is required" };
      }
      if (content == null) {
        return { success: false, data: null, error: "content is required" };
      }

      // Content size check
      const byteLength = Buffer.byteLength(content, "utf-8");
      if (byteLength > MAX_WRITE_SIZE) {
        return {
          success: false,
          data: null,
          error: `Content too large (${formatSize(byteLength)}, max ${formatSize(MAX_WRITE_SIZE)}). Split into smaller files or reduce content.`,
        };
      }

      // Path validation (jail check, ignore patterns, sensitive files)
      const validation = validatePath(
        filePath,
        codebaseConfig.root,
        [...codebaseConfig.ignorePatterns],
      );
      if (!validation.valid) {
        return { success: false, data: null, error: validation.error };
      }

      // Check if target is an existing directory
      if (existsSync(validation.resolved)) {
        try {
          const stats = statSync(validation.resolved);
          if (stats.isDirectory()) {
            return {
              success: false,
              data: null,
              error: `"${filePath}" is a directory, not a file. Provide a file path.`,
            };
          }
        } catch {
          // stat failed — proceed, writeFileSync will surface the real error
        }
      }

      const created = !existsSync(validation.resolved);

      // Create parent directories if needed
      const parentDir = dirname(validation.resolved);
      try {
        mkdirSync(parentDir, { recursive: true });
      } catch (err) {
        return {
          success: false,
          data: null,
          error: `Failed to create directory: ${(err as Error).message}`,
        };
      }

      // Re-validate jail after mkdir (defense against symlink attacks)
      const realRoot = realpathSync(codebaseConfig.root);
      const realParent = realpathSync(parentDir);
      if (!realParent.startsWith(realRoot + sep) && realParent !== realRoot) {
        return {
          success: false,
          data: null,
          error: "Path resolves outside the codebase root after directory creation.",
        };
      }

      // Write the file
      try {
        writeFileSync(validation.resolved, content, "utf-8");
      } catch (err) {
        return {
          success: false,
          data: null,
          error: `Failed to write file: ${(err as Error).message}`,
        };
      }

      return {
        success: true,
        data: {
          path: relative(codebaseConfig.root, validation.resolved),
          bytes_written: byteLength,
          created,
        },
      };
    },
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
