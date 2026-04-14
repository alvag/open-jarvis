import { resolve, relative, sep } from "node:path";
import { realpathSync, existsSync } from "node:fs";

export interface PathValidation {
  valid: boolean;
  resolved: string;
  error?: string;
}

/**
 * Sensitive file patterns — always blocked regardless of config.
 * Matched against the filename (basename) only.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env/,               // .env, .env.local, .env.production, etc.
  /token/i,               // codex-tokens.json, etc.
  /secret/i,
  /credential/i,
  /\.key$/,               // private keys
  /\.pem$/,               // certificates
];

/**
 * Validate and resolve a user-provided path against the codebase root.
 *
 * Security checks (in order):
 * 1. Resolve path relative to codebaseRoot
 * 2. Jail check — resolved path must start with codebaseRoot (symlinks resolved)
 * 3. Ignore pattern check — path segments matched against configured patterns
 * 4. Sensitive file check — hardcoded safety net for secrets/keys
 */
export function validatePath(
  inputPath: string,
  codebaseRoot: string,
  ignorePatterns: string[],
): PathValidation {
  // Resolve to absolute path
  const resolved = resolve(codebaseRoot, inputPath);

  // Jail check: resolve symlinks and verify path stays within root
  let realResolved: string;
  try {
    // If the target exists, resolve symlinks
    if (existsSync(resolved)) {
      realResolved = realpathSync(resolved);
    } else {
      // For non-existent paths, check the parent exists and resolve that
      realResolved = resolved;
    }
  } catch {
    return { valid: false, resolved, error: "Cannot resolve path" };
  }

  const realRoot = existsSync(codebaseRoot) ? realpathSync(codebaseRoot) : codebaseRoot;

  if (!realResolved.startsWith(realRoot + sep) && realResolved !== realRoot) {
    return {
      valid: false,
      resolved,
      error: "Path is outside the codebase root. Only paths within the configured codebase are accessible.",
    };
  }

  // Get relative path for pattern matching
  const relPath = relative(realRoot, realResolved);
  const segments = relPath.split(sep);

  // Ignore pattern check — match each path segment against patterns
  for (const segment of segments) {
    for (const pattern of ignorePatterns) {
      if (matchesPattern(segment, pattern)) {
        return {
          valid: false,
          resolved,
          error: `Path contains ignored segment "${segment}" (pattern: ${pattern})`,
        };
      }
    }
  }

  // Sensitive file check — hardcoded safety net on the final filename
  const filename = segments[segments.length - 1];
  if (filename) {
    for (const re of SENSITIVE_PATTERNS) {
      if (re.test(filename)) {
        return {
          valid: false,
          resolved,
          error: `"${filename}" appears to be a sensitive file and cannot be read for security reasons.`,
        };
      }
    }
  }

  return { valid: true, resolved: realResolved };
}

/**
 * Simple glob-to-match: supports * as wildcard.
 * Examples: "node_modules" matches exactly, "*.db" matches any .db file.
 */
function matchesPattern(segment: string, pattern: string): boolean {
  if (pattern === segment) return true;

  // Convert glob pattern to regex: * → .*, escape the rest
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(segment);
}
