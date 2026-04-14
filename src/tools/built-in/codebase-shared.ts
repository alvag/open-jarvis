import { readdirSync, readFileSync, statSync, lstatSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { validatePath } from "../../security/path-validator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileInfo {
  relPath: string;
  absPath: string;
  size: number;
  extension: string;
  lineCount: number;
  lines: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_FILES = 2000;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Shared: file collector
// ---------------------------------------------------------------------------

export function collectFiles(
  rootDir: string,
  codebaseRoot: string,
  ignorePatterns: readonly string[],
  maxFileSize: number,
): { files: FileInfo[]; warnings: string[] } {
  const files: FileInfo[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  const seenInodes = new Set<number>();

  function walk(dir: string): void {
    if (files.length >= MAX_FILES) return;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      if (totalBytes >= MAX_TOTAL_BYTES) break;

      const fullPath = join(dir, entry.name);

      const validation = validatePath(
        fullPath,
        codebaseRoot,
        [...ignorePatterns],
      );
      if (!validation.valid) continue;

      // Symlink loop detection via inode
      try {
        const lst = lstatSync(fullPath);
        if (lst.isSymbolicLink()) {
          const ino = statSync(fullPath).ino;
          if (seenInodes.has(ino)) continue;
          seenInodes.add(ino);
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        try {
          const st = statSync(validation.resolved);
          if (st.size > maxFileSize) continue;
          if (st.size === 0) {
            files.push({
              relPath: relative(codebaseRoot, fullPath),
              absPath: validation.resolved,
              size: 0,
              extension: extname(entry.name).toLowerCase(),
              lineCount: 0,
              lines: [],
            });
            continue;
          }

          const buffer = readFileSync(validation.resolved);

          // Skip binary files
          const checkLen = Math.min(buffer.length, 512);
          let isBinary = false;
          for (let i = 0; i < checkLen; i++) {
            if (buffer[i] === 0) { isBinary = true; break; }
          }
          if (isBinary) continue;

          totalBytes += buffer.length;
          const content = buffer.toString("utf-8");
          const lines = content.split("\n");

          files.push({
            relPath: relative(codebaseRoot, fullPath),
            absPath: validation.resolved,
            size: st.size,
            extension: extname(entry.name).toLowerCase(),
            lineCount: lines.length,
            lines,
          });
        } catch {
          continue;
        }
      }
    }
  }

  walk(rootDir);

  if (files.length >= MAX_FILES) {
    warnings.push(`File limit reached (${MAX_FILES}). Some files were not analyzed.`);
  }
  if (totalBytes >= MAX_TOTAL_BYTES) {
    warnings.push("Total bytes cap reached (50 MB). Some file contents were skipped.");
  }

  return { files, warnings };
}

// ---------------------------------------------------------------------------
// Helper: format bytes
// ---------------------------------------------------------------------------

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
