import { readFileSync, statSync } from "node:fs";
import { relative } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";

export interface CodebaseConfig {
  readonly root: string;
  readonly maxFileSize: number;
  readonly maxOutputChars: number;
  readonly ignorePatterns: readonly string[];
}

/**
 * Detect binary content by checking for null bytes in a buffer.
 */
function isBinary(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export function createReadFileTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "read_file",
      description:
        "Read the contents of a source file within the codebase. Returns file content with line numbers. Supports optional line range to read specific sections. Blocked for binary files, sensitive files (.env, keys), and files outside the codebase root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path relative to codebase root, or absolute within the codebase. E.g. 'src/index.ts' or 'package.json'.",
          },
          start_line: {
            type: "string",
            description:
              "First line to read (1-based). Omit to start from beginning.",
          },
          end_line: {
            type: "string",
            description:
              "Last line to read (inclusive). Omit to read to end (within size limits).",
          },
        },
        required: ["path"],
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const filePath = args.path as string;
      if (!filePath) {
        return { success: false, data: null, error: "path is required" };
      }

      // Validate path security
      const validation = validatePath(
        filePath,
        codebaseConfig.root,
        [...codebaseConfig.ignorePatterns],
      );
      if (!validation.valid) {
        return { success: false, data: null, error: validation.error };
      }

      // Check file exists and size
      let stats;
      try {
        stats = statSync(validation.resolved);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return {
            success: false,
            data: null,
            error: `File not found: ${filePath}. Use list_directory to explore available files.`,
          };
        }
        return { success: false, data: null, error: (err as Error).message };
      }

      if (stats.isDirectory()) {
        return {
          success: false,
          data: null,
          error: `"${filePath}" is a directory, not a file. Use list_directory instead.`,
        };
      }

      if (stats.size > codebaseConfig.maxFileSize) {
        return {
          success: false,
          data: null,
          error: `File is too large (${formatSize(stats.size)}, max ${formatSize(codebaseConfig.maxFileSize)}). Use start_line/end_line to read specific sections.`,
        };
      }

      // Read raw buffer for binary detection
      let rawBuffer: Buffer;
      try {
        rawBuffer = readFileSync(validation.resolved);
      } catch (err) {
        return { success: false, data: null, error: (err as Error).message };
      }

      if (isBinary(rawBuffer)) {
        return {
          success: false,
          data: null,
          error: "Binary file detected — cannot read. Only text/source files are supported.",
        };
      }

      const content = rawBuffer.toString("utf-8");
      const allLines = content.split("\n");
      const totalLines = allLines.length;

      // Handle empty file
      if (totalLines === 0 || (totalLines === 1 && allLines[0] === "")) {
        return {
          success: true,
          data: {
            path: relative(codebaseConfig.root, validation.resolved),
            total_lines: 0,
            content: "(empty file)",
            file_size: formatSize(stats.size),
          },
        };
      }

      // Parse line range
      const startLine = args.start_line
        ? Math.max(1, parseInt(args.start_line as string, 10))
        : 1;
      const endLine = args.end_line
        ? Math.min(totalLines, parseInt(args.end_line as string, 10))
        : totalLines;

      if (isNaN(startLine) || isNaN(endLine)) {
        return {
          success: false,
          data: null,
          error: "start_line and end_line must be valid numbers",
        };
      }

      // Extract requested lines (1-based to 0-based)
      const selectedLines = allLines.slice(startLine - 1, endLine);
      const lineNumWidth = String(endLine).length;

      // Format with line numbers
      let formatted = selectedLines
        .map((line, i) => {
          const num = String(startLine + i).padStart(lineNumWidth, " ");
          return `${num} | ${line}`;
        })
        .join("\n");

      // Truncate if needed
      let truncated = false;
      if (formatted.length > codebaseConfig.maxOutputChars) {
        // Find last complete line within the limit
        const cutoff = formatted.lastIndexOf(
          "\n",
          codebaseConfig.maxOutputChars,
        );
        const actualCut = cutoff > 0 ? cutoff : codebaseConfig.maxOutputChars;
        formatted = formatted.slice(0, actualCut);

        // Count how many lines we're showing
        const shownLines = formatted.split("\n").length;
        const lastShownLine = startLine + shownLines - 1;
        formatted += `\n... [truncated at line ${lastShownLine} of ${totalLines}. Use start_line/end_line to read remaining sections.]`;
        truncated = true;
      }

      return {
        success: true,
        data: {
          path: relative(codebaseConfig.root, validation.resolved),
          total_lines: totalLines,
          showing_lines: [startLine, Math.min(endLine, totalLines)],
          content: formatted,
          truncated,
          file_size: formatSize(stats.size),
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
