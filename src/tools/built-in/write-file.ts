import { writeFileSync, mkdirSync, existsSync, statSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath, matchesPattern } from "../../security/path-validator.js";
import { config } from "../../config.js";
import type { CodebaseConfig } from "./read-file.js";

const MAX_WRITE_SIZE = 512 * 1024; // 512 KB

export function createWriteFileTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "write_file",
      description:
        "Write content to a file within the codebase or a worktree. Creates the file if it doesn't exist, overwrites if it does. Intermediate directories are created automatically. Blocked for sensitive files (.env, keys) and paths outside the allowed root. Use cwd to write inside a worktree.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "File path relative to the working directory (cwd or codebase root). E.g. 'src/utils/helper.ts' or 'README.md'.",
          },
          content: {
            type: "string",
            description:
              "The full content to write to the file. Replaces entire file content if the file already exists.",
          },
          cwd: {
            type: "string",
            description:
              "Working directory for the write operation. Use this to write inside a worktree (e.g. the worktree_path returned by git_worktree). Must be an absolute path within the codebase root. Defaults to the codebase root.",
          },
        },
        required: ["path", "content"],
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const filePath = args.path as string;
      const content = args.content as string;
      const cwd = args.cwd as string | undefined;

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

      // Determine effective root: cwd (if provided and valid) or codebase root
      let effectiveRoot = codebaseConfig.root;
      let ignorePatterns = [...codebaseConfig.ignorePatterns];

      if (cwd) {
        // Validate cwd is absolute and inside the codebase root
        const resolvedCwd = existsSync(cwd) ? realpathSync(resolve(cwd)) : resolve(cwd);
        const realRoot = realpathSync(codebaseConfig.root);

        if (!resolvedCwd.startsWith(realRoot + sep) && resolvedCwd !== realRoot) {
          return {
            success: false,
            data: null,
            error: "cwd must be an absolute path within the codebase root.",
          };
        }

        if (!existsSync(resolvedCwd) || !statSync(resolvedCwd).isDirectory()) {
          return {
            success: false,
            data: null,
            error: `cwd does not exist or is not a directory: ${cwd}`,
          };
        }

        // Validate cwd doesn't point inside a protected directory (except worktrees dir)
        const worktreesDir = config.workflow.worktreesDir;
        const cwdRelative = relative(realRoot, resolvedCwd);
        const cwdSegments = cwdRelative.split(sep);
        const protectedPatterns = ignorePatterns.filter((p) => p !== worktreesDir);
        for (const segment of cwdSegments) {
          for (const pattern of protectedPatterns) {
            if (matchesPattern(segment, pattern)) {
              return {
                success: false,
                data: null,
                error: `cwd points inside a protected directory: ${segment}`,
              };
            }
          }
        }

        effectiveRoot = resolvedCwd;
        // When writing inside a worktree, remove worktrees dir from ignore patterns
        // since the worktree itself is inside that directory
        ignorePatterns = ignorePatterns.filter((p) => p !== worktreesDir);
      }

      // Path validation (jail check, ignore patterns, sensitive files)
      const validation = validatePath(filePath, effectiveRoot, ignorePatterns);
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
      const realRootCheck = realpathSync(codebaseConfig.root);
      const realParent = realpathSync(parentDir);
      if (!realParent.startsWith(realRootCheck + sep) && realParent !== realRootCheck) {
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
          path: relative(effectiveRoot, validation.resolved),
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
