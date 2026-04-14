import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";
import type { CodebaseConfig } from "./read-file.js";

interface TreeEntry {
  name: string;
  isDir: boolean;
  size?: number;
  children?: TreeEntry[];
}

export function createListDirectoryTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "list_directory",
      description:
        "List files and directories within the codebase. Returns a tree structure with file types and sizes. Respects ignore patterns (node_modules, .git, dist, etc.). Use this to explore the codebase structure before reading specific files.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory path relative to codebase root. Defaults to root ('.').",
          },
          depth: {
            type: "string",
            description:
              "Maximum recursion depth. '1' for immediate children only, '2' for one level of subdirectories, etc. Default: '2'. Max: '5'.",
          },
          pattern: {
            type: "string",
            description:
              "Filter for file names. E.g. '*.ts' for TypeScript files, 'test*' for test files. Applied to filenames only, not directories.",
          },
        },
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const dirPath = (args.path as string) || ".";
      const maxDepth = Math.min(
        5,
        Math.max(1, parseInt((args.depth as string) || "2", 10) || 2),
      );
      const pattern = args.pattern as string | undefined;

      // Validate path
      const validation = validatePath(
        dirPath,
        codebaseConfig.root,
        [...codebaseConfig.ignorePatterns],
      );
      if (!validation.valid) {
        return { success: false, data: null, error: validation.error };
      }

      // Verify it's a directory
      let stats;
      try {
        stats = statSync(validation.resolved);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return {
            success: false,
            data: null,
            error: `Directory not found: ${dirPath}`,
          };
        }
        return { success: false, data: null, error: (err as Error).message };
      }

      if (!stats.isDirectory()) {
        return {
          success: false,
          data: null,
          error: `"${dirPath}" is a file, not a directory. Use read_file to read its contents.`,
        };
      }

      // Walk the directory tree
      const visitedInodes = new Set<number>();
      let totalFiles = 0;
      let totalDirs = 0;

      function walkDir(dirFullPath: string, currentDepth: number): TreeEntry[] {
        if (currentDepth > maxDepth) return [];

        let entries;
        try {
          entries = readdirSync(dirFullPath, { withFileTypes: true });
        } catch {
          return []; // Skip dirs we can't read
        }

        // Sort: directories first, then alphabetical
        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        const result: TreeEntry[] = [];

        for (const entry of entries) {
          const fullPath = join(dirFullPath, entry.name);

          // Full security validation on every child path (jail check, sensitive files, ignore patterns)
          const childValidation = validatePath(
            fullPath,
            codebaseConfig.root,
            [...codebaseConfig.ignorePatterns],
          );
          if (!childValidation.valid) continue;

          if (entry.isDirectory()) {
            // Symlink loop detection (using resolved real path from validator)
            try {
              const dirStat = statSync(childValidation.resolved);
              if (visitedInodes.has(dirStat.ino)) continue;
              visitedInodes.add(dirStat.ino);
            } catch {
              continue;
            }

            totalDirs++;
            const children = walkDir(childValidation.resolved, currentDepth + 1);
            result.push({
              name: entry.name,
              isDir: true,
              children,
            });
          } else {
            // Apply pattern filter to files
            if (pattern && !matchGlob(entry.name, pattern)) continue;

            let size = 0;
            try {
              size = statSync(childValidation.resolved).size;
            } catch {
              // Skip files we can't stat
            }
            totalFiles++;
            result.push({ name: entry.name, isDir: false, size });
          }
        }

        return result;
      }

      const tree = walkDir(validation.resolved, 1);

      // Format as indented tree string
      let treeStr = formatTree(tree, "");
      let truncated = false;

      if (treeStr.length > codebaseConfig.maxOutputChars) {
        treeStr =
          treeStr.slice(0, codebaseConfig.maxOutputChars) +
          `\n... [truncated — ${totalFiles} files, ${totalDirs} dirs total. Use a deeper path or pattern filter to narrow results.]`;
        truncated = true;
      }

      return {
        success: true,
        data: {
          path: relative(codebaseConfig.root, validation.resolved) || ".",
          total_files: totalFiles,
          total_dirs: totalDirs,
          tree: treeStr,
          truncated,
        },
      };
    },
  };
}

function formatTree(entries: TreeEntry[], indent: string): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.isDir) {
      const childCount = countDescendants(entry.children || []);
      lines.push(`${indent}${entry.name}/`);
      if (entry.children && entry.children.length > 0) {
        lines.push(formatTree(entry.children, indent + "  "));
      } else if (childCount === 0) {
        lines.push(`${indent}  (empty)`);
      }
    } else {
      const sizeStr = entry.size !== undefined ? ` (${formatSize(entry.size)})` : "";
      lines.push(`${indent}${entry.name}${sizeStr}`);
    }
  }

  return lines.join("\n");
}

function countDescendants(entries: TreeEntry[]): number {
  let count = entries.length;
  for (const e of entries) {
    if (e.children) count += countDescendants(e.children);
  }
  return count;
}

function matchGlob(name: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
