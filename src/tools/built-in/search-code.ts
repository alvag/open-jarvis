import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Tool, ToolResult } from "../tool-types.js";
import { validatePath } from "../../security/path-validator.js";
import type { CodebaseConfig } from "./read-file.js";

interface Match {
  file: string;
  line: number;
  content: string;
  context: string[];
}

export function createSearchCodeTool(codebaseConfig: CodebaseConfig): Tool {
  return {
    definition: {
      name: "search_code",
      description:
        "Search for text or patterns across codebase files. Returns matching lines with file paths, line numbers, and surrounding context. Useful for finding function definitions, imports, usages, and configuration values. Respects ignore patterns.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Search string or regex pattern. E.g. 'createMemoryManager', 'import.*config', 'TODO'.",
          },
          path: {
            type: "string",
            description:
              "Restrict search to this directory or file. Default: entire codebase root.",
          },
          file_pattern: {
            type: "string",
            description:
              "Filter by file extension. E.g. '*.ts' for TypeScript only, '*.md' for markdown. Default: all text files.",
          },
          context_lines: {
            type: "string",
            description:
              "Number of lines to show before and after each match. Default: '2'. Max: '5'.",
          },
          max_results: {
            type: "string",
            description:
              "Maximum number of matches to return. Default: '20'. Max: '50'.",
          },
        },
        required: ["query"],
      },
    },

    async execute(args, _context): Promise<ToolResult> {
      const query = args.query as string;
      if (!query) {
        return { success: false, data: null, error: "query is required" };
      }

      const searchPath = (args.path as string) || ".";
      const filePattern = args.file_pattern as string | undefined;
      const contextLines = Math.min(
        5,
        Math.max(0, parseInt((args.context_lines as string) || "2", 10) || 2),
      );
      const maxResults = Math.min(
        50,
        Math.max(1, parseInt((args.max_results as string) || "20", 10) || 20),
      );

      // Validate search root path
      const validation = validatePath(
        searchPath,
        codebaseConfig.root,
        [...codebaseConfig.ignorePatterns],
      );
      if (!validation.valid) {
        return { success: false, data: null, error: validation.error };
      }

      // Build regex
      let regex: RegExp;
      let isLiteral = false;
      try {
        regex = new RegExp(query, "i");
      } catch {
        // Invalid regex — escape and treat as literal
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, "i");
        isLiteral = true;
      }

      const matches: Match[] = [];
      let filesSearched = 0;

      function searchFile(filePath: string): void {
        if (matches.length >= maxResults) return;

        let rawBuffer: Buffer;
        try {
          rawBuffer = readFileSync(filePath);
        } catch {
          return;
        }

        // Skip binary files
        const checkLen = Math.min(rawBuffer.length, 512);
        for (let i = 0; i < checkLen; i++) {
          if (rawBuffer[i] === 0) return;
        }

        filesSearched++;
        const content = rawBuffer.toString("utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) return;

          if (regex.test(lines[i])) {
            // Build context window
            const ctxStart = Math.max(0, i - contextLines);
            const ctxEnd = Math.min(lines.length - 1, i + contextLines);
            const contextArr: string[] = [];

            for (let j = ctxStart; j <= ctxEnd; j++) {
              const lineNum = String(j + 1).padStart(4, " ");
              const prefix = j === i ? ">" : " ";
              let lineContent = lines[j];
              // Truncate very long lines (minified code)
              if (lineContent.length > 200) {
                lineContent = lineContent.slice(0, 200) + "...";
              }
              contextArr.push(`${prefix} ${lineNum} | ${lineContent}`);
            }

            matches.push({
              file: relative(codebaseConfig.root, filePath),
              line: i + 1,
              content: lines[i].length > 200 ? lines[i].slice(0, 200) + "..." : lines[i],
              context: contextArr,
            });
          }
        }
      }

      function walkAndSearch(dirPath: string): void {
        if (matches.length >= maxResults) return;

        let entries;
        try {
          entries = readdirSync(dirPath, { withFileTypes: true });
        } catch {
          return;
        }

        // Sort for deterministic results
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
          if (matches.length >= maxResults) break;

          const fullPath = join(dirPath, entry.name);

          // Full security validation on every child path (jail check, sensitive files, ignore patterns)
          const childValidation = validatePath(
            fullPath,
            codebaseConfig.root,
            [...codebaseConfig.ignorePatterns],
          );
          if (!childValidation.valid) continue;

          if (entry.isDirectory()) {
            walkAndSearch(fullPath);
          } else {
            // Apply file pattern filter
            if (filePattern && !matchGlob(entry.name, filePattern)) continue;

            // Skip files that are too large
            try {
              const st = statSync(childValidation.resolved);
              if (st.size > codebaseConfig.maxFileSize) continue;
            } catch {
              continue;
            }

            searchFile(childValidation.resolved);
          }
        }
      }

      // If the validated path is a file, search just that file
      const rootStat = statSync(validation.resolved);
      if (rootStat.isFile()) {
        searchFile(validation.resolved);
      } else {
        walkAndSearch(validation.resolved);
      }

      if (matches.length === 0) {
        return {
          success: true,
          data: {
            query,
            matches_found: 0,
            files_searched: filesSearched,
            results: `No matches found for "${query}".${isLiteral ? " (treated as literal text — original pattern was invalid regex)" : ""} Try a broader query or different file_pattern.`,
          },
        };
      }

      // Format results
      let formatted = matches
        .map((m) => `${m.file}:${m.line}\n${m.context.join("\n")}`)
        .join("\n\n");

      let truncated = false;
      if (formatted.length > codebaseConfig.maxOutputChars) {
        // Cut at last complete match block
        const cutoff = formatted.lastIndexOf(
          "\n\n",
          codebaseConfig.maxOutputChars,
        );
        if (cutoff > 0) {
          formatted = formatted.slice(0, cutoff);
        } else {
          formatted = formatted.slice(0, codebaseConfig.maxOutputChars);
        }
        formatted += `\n\n... [truncated — showing partial results. Use path or file_pattern to narrow the search.]`;
        truncated = true;
      }

      return {
        success: true,
        data: {
          query,
          matches_found: matches.length,
          files_searched: filesSearched,
          results: formatted,
          truncated,
        },
      };
    },
  };
}

function matchGlob(name: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}
